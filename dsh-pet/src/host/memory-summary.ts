/**
 * 对话记忆压缩（host 半侧，**纯逻辑**：不碰 IO、不调模型）——把「早期对话」压成一段摘要，
 * 实现长期记忆。
 *
 * 为什么需要：改造前 memory.json 只存消息、每次只截尾部 `chatMemoryRounds` 轮进上下文，
 * 于是「很久以前说过的事」一旦滑出窗口就**永久遗忘**（模型再也不知道用户叫什么、约定过什么、
 * 讨厌什么）。压缩把即将滑出窗口的那部分**提前总结**，摘要常驻 system 提示词，
 * 于是窗口外的历史仍以浓缩形式在场——这就是长期记忆。
 *
 * 分层（与 ./persona 同一条原则：拼装点必须唯一）：
 *   1. 本模块 = 「该不该压 / 压哪一段 / 提示词怎么写 / 摘要怎么归一」的纯计算，
 *      不读时钟、不读文件，故能在 node:test 里直接跑；
 *   2. 真正调模型的是 ./chat 的 `generateMemorySummary`（复用它的候选链与失败回落）；
 *   3. 落盘与读写锁在 host/index.ts 的 `withMemoryLock` 内完成（记忆唯一读写方 = 本进程）。
 *
 * 存储形状（memory.json 的每个叶子，**向后兼容**）：
 *   { messages: [...], summarized?: number, summary?: string, summaryTs?: number }
 *   - `messages` **全存不删**（与改造前一致：用户可随时翻原始记录，压缩绝不销毁数据）；
 *   - `summarized` = 前多少条已被摘要吃掉 → 进上下文时从这条之后开始取；
 *   - 老文件没有这三个字段 → 按 0 / 空串处理，等价于「还没压缩过」，**不需要迁移**。
 *
 * 为什么用「指针」而不是「删掉已压缩的消息」：
 *   删除是不可逆的，而摘要质量取决于模型。指针方案下压缩只是「换个读法」——摘要写得不好时，
 *   原始消息还在文件里，调低 `keepRounds` 重压一次即可，永远有退路。
 */

import type { ChatMemoryMessage } from './chat';
import type { MemoryFact } from './memory-facts';
import type { GroupMember } from './memory-group';

/**
 * memory.json 里一只宠物对应的叶子。
 *
 * 只有 `messages` 是必填（老文件的形状）；其余三个字段缺失即「尚未压缩」。
 * 这里显式声明为接口而不是内联对象类型，是因为它要在 readMemory / writeMemory /
 * chatWithPet / GET /chat 四处共用——内联写四遍必然漂移。
 */
export interface ChatMemoryEntry {
  messages: ChatMemoryMessage[];
  /** 前多少条消息已被 `summary` 覆盖（进上下文时跳过它们）；缺省 0 */
  summarized?: number;
  /** 早期对话的浓缩摘要（空串/缺失 = 没有摘要） */
  summary?: string;
  /** 摘要生成时刻（ms） */
  summaryTs?: number;
  /**
   * L0 稳定事实卡（见 `./memory-facts`）。
   *
   * 与 `summary` 的分工：摘要 = 往事的**叙述**（有损、会被重写）；事实卡 = **结构化事实**
   * （按 key 覆盖、永不压缩、不参与 `summarized` 游标）。
   * 缺键 = 旧数据（还没有回填过），由 `./memory-migrate` 补上。
   */
  facts?: MemoryFact[];
  /** 事实卡已经回填到第几条消息（迁移标记，防止重复回填） */
  factsUpto?: number;
  /**
   * 群聊成员桶（`memoryMode: 'group'` 才有；见 `./memory-group`）。
   *
   * 为什么和单人模式共用同一个条目类型而不是另起一套：两种模式的**消息流形状完全一样**
   * （都是 `messages` + 摘要游标），差别只在「要不要按人分桶」。共用同一个类型意味着
   * 切换模式不需要迁移数据结构——单人模式积累的消息，切到群聊后仍在那条流里（只是老消息
   * 没有 `sender`，会被当成「不知道是谁说的」，这是诚实的处理，不是丢数据）。
   */
  members?: Record<string, GroupMember>;
}

/** 未摘要轮数超过它 → 自动压缩（1 轮 = 1 问 1 答 = 2 条消息） */
export const DEFAULT_COMPRESS_ROUNDS = 20;

/** 压缩后保留多少轮原文（这部分仍逐字进上下文，保证近期对话的细节不失真） */
export const DEFAULT_KEEP_ROUNDS = 5;

/**
 * 摘要正文长度上限（字符）。
 *
 * 为什么要封顶：摘要每轮对话都会拼进 system 提示词，是**常驻成本**。不封顶时模型可能越写越长，
 * 几轮之后摘要本身就吃掉了预算——那就本末倒置了。1200 字对「身份 + 偏好 + 约定 + 待办」够用。
 */
export const MAX_SUMMARY_CHARS = 1200;

/** 一只宠物生效的压缩策略（由条目配置读来，缺省/非法一律回落内置默认） */
export interface CompressPolicy {
  /** 自动压缩开关（手动压缩不受它影响：用户主动点了就必须执行） */
  enabled: boolean;
  /** 未摘要轮数超过它 → 自动压缩 */
  compressRounds: number;
  /** 压缩后保留多少轮原文 */
  keepRounds: number;
}

/** 读非负整数配置（缺失/非法 → 默认值；不告警，合并器已保证成品字段合法） */
function nonNegInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * 从条目配置读出压缩策略。
 *
 * 边界：`keepRounds` 不允许 ≥ `compressRounds`——否则「保留区」比「触发线」还长，
 * 压缩永远没有可压的段落（planCompression 会一直返回 null），功能静默失效。
 * 这种情况按「保留区 = 触发线的一半」兜底，并在下面的注释里说清为什么不是直接报错：
 * 配置是用户手改的，报错会让整个宠物加载失败，代价远大于一个保守的兜底。
 */
export function compressPolicyOf(conf: Record<string, unknown>): CompressPolicy {
  const enabled = conf.memoryCompressEnabled !== false; // 缺省开启：长期记忆是默认体验
  const compressRounds = nonNegInt(conf.memoryCompressRounds, DEFAULT_COMPRESS_ROUNDS);
  let keepRounds = nonNegInt(conf.memoryKeepRounds, DEFAULT_KEEP_ROUNDS);
  // 保留区必须严格小于触发线，否则压不动（见上面注释）
  if (compressRounds > 0 && keepRounds >= compressRounds) {
    keepRounds = Math.max(0, Math.floor(compressRounds / 2));
  }
  return { enabled, compressRounds, keepRounds };
}

/** 一次压缩计划：把 messages 的 [from, to) 区间压进摘要 */
export interface CompressPlan {
  /** 要喂给模型的区间起点（= 当前已摘要的条数） */
  from: number;
  /** 区间终点（开区间）；之后的部分保留原文 */
  to: number;
  /** 压缩完成后应写回的 `summarized`（= to） */
  nextSummarized: number;
}

/** 当前已摘要条数（钳到 [0, total]：坏数据不至于让 slice 出诡异结果） */
export function summarizedOf(entry: ChatMemoryEntry): number {
  const total = Array.isArray(entry.messages) ? entry.messages.length : 0;
  const n = Number(entry.summarized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), total);
}

/**
 * 判定这次要不要压缩、压哪一段。返回 null = 不需要动。
 *
 * @param entry 记忆叶子
 * @param policy 压缩策略
 * @param opts.force 手动压缩：忽略 `enabled` 与触发线，只要有未摘要内容就压
 *
 * 关键边界（都是刻意的）：
 *   - `to = total - keepRounds*2`：保留区按**轮**算（1 轮 2 条），与 `chatMemoryRounds` 同口径；
 *   - `to <= from` → 返回 null：没有新内容可压（重复点手动压缩不该产生空摘要）；
 *   - 消息条数为奇数（用户消息写成功但回复失败的残留）时，保留区可能切在轮中间——
 *     这里不修正，因为 `messages` 本就允许出现半轮（生成失败时只写了 user 那条）。
 *     多压或少压半条不影响正确性，强行对齐反而要动已落盘数据。
 */
export function planCompression(
  entry: ChatMemoryEntry,
  policy: CompressPolicy,
  opts: { force?: boolean } = {},
): CompressPlan | null {
  const messages = Array.isArray(entry.messages) ? entry.messages : [];
  const total = messages.length;
  const from = summarizedOf(entry);
  const pending = total - from;
  if (pending <= 0) return null;

  if (!opts.force) {
    if (!policy.enabled) return null;
    // 未摘要轮数（向下取整）超过触发线才压：10 条 = 5 轮
    if (Math.floor(pending / 2) <= policy.compressRounds) return null;
  }

  const keepMsgs = policy.keepRounds * 2;
  const to = total - keepMsgs;
  if (to <= from) return null;
  return { from, to, nextSummarized: to };
}

/** 一条消息渲染成一行（摘要提示词用）：`用户：…` / `宠物：…` */
function renderLine(m: ChatMemoryMessage): string {
  const who = m.role === 'user' ? '用户' : '宠物';
  const text = typeof m.content === 'string' ? m.content.trim() : '';
  return text === '' ? '' : who + '：' + text;
}

/** 把一段消息渲染成纯文本记录（空消息跳过；上限 400 行防单次请求过大） */
export function renderTranscript(chunk: ChatMemoryMessage[]): string {
  const lines: string[] = [];
  for (const m of chunk) {
    const line = renderLine(m);
    if (line) lines.push(line);
    if (lines.length >= 400) break;
  }
  return lines.join('\n');
}

/**
 * 摘要提示词（system）。
 *
 * 为什么单独立一个「记忆整理员」身份而不是沿用宠物人设：摘要是**事实记录**，不该带语气、
 * 不该用第一人称卖萌——否则下次拼进 system 时模型会把摘要当成"自己在说话"，
 * 把第三人称的事实读成对话历史，反而污染人设。
 */
export const SUMMARY_SYSTEM_PROMPT = [
  '你是一个对话记忆整理员。你的任务是把一段人与桌宠的对话压缩成一份长期记忆摘要。',
  '',
  '要求：',
  '1. 只保留有长期价值的信息：用户的身份/称呼/偏好/习惯/忌讳、约定过的事、重要事实与结论、未完成的待办。',
  '2. 丢弃寒暄、重复内容、语气词、一次性的闲聊与情绪表达。',
  '3. 用第三人称陈述（例如「用户喜欢下雨天」「用户提过下周三要考试」），不要写成对话，不要用第一人称。',
  '4. 不要编造：只写记录里明确出现过的内容；不确定的宁可不写。',
  '5. 只输出摘要正文，不要标题、不要分点符号、不要任何解释或前后缀。',
].join('\n');

/**
 * 拼出这次摘要请求的 user 正文。
 *
 * 有旧摘要时把它和新对话一起给模型，让它**合并**成一份新摘要（而不是简单拼接）——
 * 拼接会让摘要线性膨胀，几轮之后就撞上 MAX_SUMMARY_CHARS，最后只能截断丢信息。
 */
export function buildSummaryUserText(prevSummary: string, chunk: ChatMemoryMessage[]): string {
  const prev = prevSummary.trim();
  const transcript = renderTranscript(chunk);
  const parts: string[] = [];
  if (prev) {
    parts.push('【更早的摘要】（请与下面的新对话合并成一份新摘要，不要简单拼接）');
    parts.push(prev);
    parts.push('');
  }
  parts.push('【新的对话记录】');
  parts.push(transcript === '' ? '（无有效内容）' : transcript);
  return parts.join('\n');
}

/**
 * 归一模型产出的摘要：去代码围栏、压空行、封顶长度。
 *
 * 为什么要剥 ``` 围栏：模型偶尔会把整段摘要包进 markdown 代码块，直接拼进 system 时
 * 那三个反引号会变成提示词的一部分，让模型以为后面是代码。
 */
export function normalizeSummary(text: string): string {
  let s = typeof text === 'string' ? text.trim() : '';
  // 剥掉整体包裹的代码围栏（``` 或 ```markdown，结尾可有可无）
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/;
  const m = fence.exec(s);
  if (m) s = m[1].trim();
  // 连续空行压成一个（摘要里不需要视觉留白）
  s = s.replace(/\n{3,}/g, '\n\n');
  if (s.length > MAX_SUMMARY_CHARS) {
    // 截断优先切在句末，避免半句话；切不到就硬截
    const head = s.slice(0, MAX_SUMMARY_CHARS);
    const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('\n'));
    s = cut > MAX_SUMMARY_CHARS * 0.6 ? head.slice(0, cut + 1) : head;
  }
  return s;
}

/**
 * 拼进 system 提示词的记忆段（空摘要 → 空串，调用方直接字符串相加即可）。
 *
 * 措辞要点：明确要求「当作已发生的事实参考」+「不要复述、不要提摘要二字」——
 * 不写这两句时，模型常会开口说「根据我们的记忆摘要…」，出戏。
 */
export function memorySection(summary: string): string {
  const s = typeof summary === 'string' ? summary.trim() : '';
  if (!s) return '';
  return (
    '\n\n【长期记忆】以下是你和用户过去对话的浓缩记录，' +
    '回答时把它当作已经发生的事实来参考。不要复述这份记录，也不要提到"记忆""摘要"这类字眼：\n' +
    s
  );
}

/** 供 GET /chat 与前端展示用的记忆概览 */
export interface MemoryOverview {
  /** 摘要正文（无摘要 = 空串） */
  summary: string;
  /** 摘要生成时刻（无 = 0） */
  summaryTs: number;
  /** 已摘要的消息条数 */
  summarized: number;
  /** 消息总条数 */
  total: number;
  /** 尚未摘要的轮数（向下取整） */
  pendingRounds: number;
}

/** 汇总一只宠物的记忆状态（GET /chat 与手动压缩回执共用） */
export function overviewOf(entry: ChatMemoryEntry): MemoryOverview {
  const messages = Array.isArray(entry.messages) ? entry.messages : [];
  const summarized = summarizedOf(entry);
  const ts = Number(entry.summaryTs);
  return {
    summary: typeof entry.summary === 'string' ? entry.summary : '',
    summaryTs: Number.isFinite(ts) && ts > 0 ? ts : 0,
    summarized,
    total: messages.length,
    pendingRounds: Math.max(0, Math.floor((messages.length - summarized) / 2)),
  };
}
