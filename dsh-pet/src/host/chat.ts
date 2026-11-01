/**
 * 对话生成（host 半侧）：用 DSH 的 LLM 统一抽象层（ctx.llm）按条目配置的 chatModel
 * （留空 = 当前对话用的 provider/model）生成一句回复。与碎碎念（generateWhisper）同构，区别是：
 *  - 输入带历史对话（memory.json 截取的最近 N 轮），历史以 user/assistant 消息进入请求；
 *  - user 消息 = 用户刚输入的话（不是"随便叨叨"指令）；
 *  - 回复放宽到 256 token（对话比碎碎念可说得稍多），超时放宽到 60s。
 *
 * 设计：
 *  - provider/model：条目配置的 chatModel 优先（留空 = 不指定），失败回落到
 *    agentDefaultModel.currentSelection()（当前对话的模型，与余额/碎碎念同源）重试一次——
 *    候选链见 model-selection.ts；
 *  - system = 用户配置的 whisperPrompt（人设：碎碎念与对话共用同一人设）；
 *  - reasoningEffort: 'off' —— 仅当模型声明支持 reasoning effort（含 "off"）时传，
 *    关闭深度思考：闲聊对话不需要推理。无 reasoning 元数据的模型（如
 *    reasoningEfforts: false）显式传 off 会被 dsh-llm 判为 UNSUPPORTED_REASONING_EFFORT
 *    并折叠成空流（表现为"模型未返回文本"），因此这类模型省略该字段（语义等价于不传）；
 *  - sessionId: PET_CALL_IDENTITY —— 调用身份（见 llm-call.ts）；
 *  - 无正文时读 BlockAssembler.finish 报真实失败原因（dsh-llm 把适配器抛错折进终止块）；
 *  - 历史 assistant 消息用 createAssistantMessage 构造（provider/model 记当前选择，
 *    仅作消息角色载体，不涉及适配器回放）；
 *  - 流式收集 + BlockAssembler 拼装文本；生成失败显式返回结构化原因，不伪造文案。
 *
 * 配图（可选，pool 非空时）：与碎碎念「随机抽」不同——对话有真实上下文（用户输入 + 历史），
 * 故把整张表情包清单交给模型由它**按语境选**一张；模型在末尾附标记 [图:名称]，
 * host 解析并**只在池内命中时**采纳（防幻觉出池外名称），未选/选错则不配图
 * （对话配图是点缀，不强制每句都带）。
 */

import { BlockAssembler, createAssistantMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call';
import { supportsReasoningOff } from './llm-reasoning';
import { defaultLog } from './log-file';
import { extractChatImage, memeCatalog, type MemeEntry } from './memes';
import { extractAiTags, tagInstruction, type MemoryTags } from './memory-tags';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection';
import { splitInstruction } from './split-reply';

/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构） */
export type ChatGenerateResult =
  | { ok: true; text: string; image?: string; tags?: MemoryTags }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 记忆中的一条消息（与 shared/chat.ts 的 ChatMessage 同构）
 *
 *  `sender` / `senderName`（2026-10-29 新增，群聊用）：**谁说的**。
 *  单人模式缺省不写（保持老文件的形状，`deepEqual` 断言与 /chat 消费端都不用改）；
 *  群聊模式下 user 消息必带 `sender`，assistant 消息不带（宠物就是宠物自己）。
 *  这两个字段只作**归属标记**，不参与送给模型的内容——模型看到的仍是 role+content。 */
export interface ChatMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /**
   * 永久编号（2026-11-01）：**一旦写进文件就不再变**，合并时唯一去重依据。
   *
   * 为什么需要：手机出门时在本地写消息、回家追加到电脑这份记忆里。没有编号就只能靠
   * 「第几条」判断重复，而两边各自的「第几条」根本不可比（一边多一条，后面全错位）。
   * 老文件没有这个字段 → 第一次写盘时由 `./memory-io` 的 `assignIds` 一次性补齐。
   */
  id?: string;
  sender?: string;
  senderName?: string;
  /**
   * 这条消息的来源标注（2026-10-30）：缺键 = 本窗口/单人正常对话。
   *
   * 目前只有一种取值来源：主人在 QQ 群里说的话被**镜像**进单人流时，写上群名（没有群名写
   * `'group'`）。用途是排查和统计（「这句话到底是从群里来的还是桌面上说的」），
   * 模型看到的是正文里那句「（在「XX群」里说的）」，不是这个字段。
   */
  origin?: string;
  /**
   * 模型打的标签（2026-10-30，用户质问「打标签不交给 AI？」之后加的）。
   *
   * 留空 = 只有词典标签可用（`memory-tags.ts` 现场算，不落盘）。
   * 有值 = AI 补标过，**以 AI 为准**：`topics` 会替换词典结果，`mood`/`kind` 也覆盖。
   *
   * 为什么不直接不存：AI 调用是异步的、可能失败、可能几个月后才补上，
   * 存下来才能"补过就不重补"。而词典那条路永远是现算的，
   * 所以即使这个字段一直是空的，检索也不会退化成完全捞不到。
   */
  aiTags?: {
    topics: string[];
    mood: 'pos' | 'neg' | 'neutral';
    kind: 'statement' | 'question' | 'plan' | 'emotion';
    /** 打标时间（用来判断要不要按新词表重标） */
    at: number;
  };
}

/** 单次生成超时（ms）：对话等 LLM 回复，60s 足够 */
const TIMEOUT_MS = 60_000;

/** 配图指令：附在 user 正文之后（紧邻回答位置，模型更容易遵守） */
function imageInstruction(pool: MemeEntry[]): string {
  return (
    '\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n' +
    memeCatalog(pool) +
    '\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。'
  );
}

/**
 * 生成一句对话回复。
 * @param ctx 宿主上下文（注入 agentDefaultModel / llm）
 * @param system 人设提示词（whisperPrompt）
 * @param history 最近记忆（按时间正序；user/assistant 交替）
 * @param userText 用户刚输入的话
 * @param pool 表情包候选池（开启对话配图时传入；空/缺省 = 纯文本，指令与解析都不介入）
 * @param preferred 条目配置单独指定的模型（chatModel）；缺省 / 留空 = 只用当前对话的模型
 * @param wantTags 是否附打标指令（记忆标签；群聊/摘要等场合可关）
 * @param split 是否附「分条说话」指令（2026-11-01）：开启后模型会用 `[分]` 隔开几条短句，
 *   host 用 `./split-reply` 切开逐条发。只影响**指令**，切分与落盘由调用方做
 *   （同一份指令也要给主动聊天用，所以不在这里切）。
 * @returns 回复文本（+ 命中池内的配图名），或结构化失败（provider 缺失 / 生成错误）
 */
export async function generateChat(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  system: string,
  history: ChatMemoryMessage[],
  userText: string,
  pool: MemeEntry[] = [],
  preferred?: ModelRef,
  wantTags = true,
  split = false,
): Promise<ChatGenerateResult> {
  // 候选链：配置的模型优先 → 当前对话的模型兜底（chatModel 留空时链上只有后者，与旧版逐字一致）
  const candidates = modelCandidates(ctx, preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  // 依次尝试：配置的模型失败（凭据被删 / 模型下架 / 该服务商没配 key）时**回落到当前对话的模型
  // 重试一次**，仍失败才抛出失败原因——最后一次是用户当前真正在用的模型，报错更有意义。
  // 兜底文案与失败分支同源，避免两处字面量漂移
  let last: ChatGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateWith(ctx, llm, sel, system, history, userText, pool, wantTags, split);
    if (result.ok) return result;
    last = result;
    // 回落要留痕：配的模型没生效时能在日志里看到原因（否则"我明明配了 A，怎么还是用 B"没法查）
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `dsh-pet: 对话用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/**
 * 把上下文窗口裁到「以 user 消息开头」。
 *
 * 为什么需要（2026-10-31，主动聊天引入）：记忆流不再是严格的一问一答——
 * 宠物主动开口时追加的是一条 `assistant` 消息（见 ./proactive），于是
 * `sliceMemoryRounds` 截出的尾部窗口**可能以 assistant 开头**。
 *
 * 而独立模式的 `parseRequest`（standalone/ai-provider.ts）硬性要求
 * `messages[0].role === 'user'`，否则抛 `Standalone AI input is empty or exceeds limits.`
 * ——整轮对话直接失败，用户看到的是"发不出去"。
 *
 * 裁掉开头那几条 assistant 的代价是**少带一点历史**，比整个请求失败划算得多；
 * 而且被裁掉的通常是"她主动说的那句话"，它的上下文意义本来也最小。
 *
 * 只在开头裁：中间/结尾的 assistant 都是合法的（对话历史本来就该有）。
 */
export function trimToUserBoundary<T extends { role: 'user' | 'assistant' }>(messages: T[]): T[] {
  let i = 0;
  while (i < messages.length && messages[i].role !== 'user') i += 1;
  return i === 0 ? messages : messages.slice(i);
}

/** 摘要生成结果：与对话同构的失败形状（调用方据此决定是否保留旧摘要） */
export type SummaryGenerateResult =
  { ok: true; text: string } | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/**
 * 生成一段记忆摘要（长期记忆压缩用）。
 *
 * 与 `generateChat` 的关系：**共用**候选链（`modelCandidates`）与流式拼装口径，但**不复用**
 * `generateChat` 本身——对话生成会拼历史消息、附配图指令、解析 [图:名] 标记，这些对摘要都是污染。
 * 摘要只需要「system = 记忆整理员身份 + user = 待压缩的记录」，一次纯文本产出。
 *
 * 为什么不复用 `generateWith`：那个函数签名绑定 history/userText/pool 三段对话结构，
 * 硬塞成空数组会让调用点读起来像"一次没有历史的对话"，掩盖真实意图。这里单独写一遍
 * 流式循环只有十来行，比扭曲既有函数便宜。
 *
 * @param system 摘要身份提示词（`memory-summary.ts` 的 SUMMARY_SYSTEM_PROMPT）
 * @param userText 待压缩内容（含旧摘要时的合并指令）
 * @param preferred 条目配置的模型（chatModel）；留空 = 只用当前对话的模型
 */
export async function generateMemorySummary(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  system: string,
  userText: string,
  preferred?: ModelRef,
): Promise<SummaryGenerateResult> {
  const candidates = modelCandidates(ctx, preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  let last: SummaryGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await summarizeWith(ctx, llm, sel, system, userText);
    if (result.ok) return result;
    last = result;
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `dsh-pet: 记忆摘要用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/** 用**一个**确定的 provider/model 跑一次摘要生成 */
async function summarizeWith(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  system: string,
  userText: string,
): Promise<SummaryGenerateResult> {
  // 摘要比对话更耗输入（要吞下一大段记录），给两倍超时：60s 在长记录 + 慢模型下会掐断
  const deadline = AbortSignal.timeout(TIMEOUT_MS * 2);
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const options = {
    provider: sel.provider,
    model: sel.model,
    sessionId: PET_CALL_IDENTITY,
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'user' },
      }),
    ],
    system,
    temperature: 0.3, // 摘要要稳定可复现，不要发挥
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: deadline,
  };
  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  return { ok: true, text };
}

/** 用**一个**确定的 provider/model 跑一次对话生成（候选链的一环；失败原样返回结构化原因，不吞） */
async function generateWith(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  system: string,
  history: ChatMemoryMessage[],
  userText: string,
  pool: MemeEntry[],
  wantTags: boolean,
  split: boolean,
): Promise<ChatGenerateResult> {
  // 历史 → dsh-llm 消息：user 经 createUserMessage（plugin 来源），assistant 经 createAssistantMessage
  const historyMessages = history.map((m) =>
    m.role === 'user'
      ? createUserMessage({
          content: [{ type: 'text', text: m.content }],
          source: { kind: 'user' },
        })
      : createAssistantMessage({
          content: [{ type: 'text', text: m.content }],
          source: { provider: sel.provider, model: sel.model },
        }),
  );

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  // 仅当模型声明支持 reasoning effort（含 "off"）时才传，否则省略：
  // 无 reasoning 元数据的模型（如 reasoningEfforts: false）显式传 off 会被
  // dsh-llm 判为 UNSUPPORTED_REASONING_EFFORT 并折叠成空流（表现为"模型未返回文本"）。
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  // 配图：池非空才把清单与指令附进 user 正文（空池 = 关闭配图，正文与旧行为逐字一致）
  const wantImage = pool.length > 0;
  // 打标指令：与配图指令同一位置（紧邻回答处，模型最容易遵守）。
  // 两条指令互不干扰——配图要求模型挑图，打标要求它描述用户那句话，是两件事。
  let userBody = userText;
  if (wantImage) userBody += imageInstruction(pool);
  if (wantTags) userBody += tagInstruction();
  // 分条指令（2026-11-01）：与上面两条同一位置（紧邻回答处）。关掉时正文与旧行为逐字一致，
  // 「分条回复」这个开关因此是**纯增量**：关掉 = 回到一句话一条。
  if (split) userBody += splitInstruction();
  const options = {
    provider: sel.provider,
    model: sel.model,
    // 调用身份（见 llm-call.ts）：缺它时 opencode-go 回 400
    sessionId: PET_CALL_IDENTITY,
    messages: [
      ...historyMessages,
      createUserMessage({
        content: [{ type: 'text', text: userBody }],
        source: { kind: 'user' },
      }),
    ],
    system,
    // 不显式限 maxTokens：与碎碎念同因——推理模型把思考计入预算，显式小上限会截断正文；
    // 不传由 dsh-llm 按适配器 defaultMaxTokens 兜底，对话短回复输出仍短。
    temperature: 1,
    // 统一关闭深度思考：闲聊对话不需要推理（与碎碎念同一约束；仅模型声明支持时传）
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: deadline,
  };

  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'generate-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  // 末尾标记解析：打标 `[标:…]` 与配图 `[图:…]` 都在结尾，谁在前由模型决定，
  // 所以**先剥一个再看另一个是否露到结尾**（最多两轮必然收敛）。
  // 两条都容错：解析失败一律原样保留正文，绝不吞回复（配图那条已验证过的口径）。
  let body = text;
  let image: string | undefined;
  let tags: MemoryTags | undefined;
  for (let round = 0; round < 3; round++) {
    let changed = false;
    if (wantTags) {
      const t = extractAiTags(body);
      if (t.text !== body) {
        body = t.text;
        changed = true;
      }
      if (t.tags) tags = t.tags;
    }
    if (wantImage) {
      const picked = extractChatImage(body, pool);
      if (picked.text !== body) {
        body = picked.text;
        changed = true;
      }
      if (picked.image) image = picked.image;
    }
    if (!changed) break;
  }
  return { ok: true, text: body, ...(image ? { image } : {}), ...(tags ? { tags } : {}) };
}
