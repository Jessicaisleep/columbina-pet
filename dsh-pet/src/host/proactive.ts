/**
 * 主动聊天（2026-10-31）：宠物**不等你说话**，按自己的节奏找你聊。
 *
 * 与碎碎念的分水岭（两者共用同一条气泡展示链路 `state.writePet(petId,'say',…)`，
 * 所以从用户视角看都是"她突然说了句话"，但语义完全不同）：
 *
 *   · 碎碎念 = 自言自语，**不进记忆**。下次对话时她不知道自己刚才嘀咕过什么。
 *   · 主动聊天 = 真的开启一轮对话，**写进记忆**。你回一句「哈哈」时她接得上，
 *     而且电脑聊完手机接着聊时也能看到"她昨天主动找过我"。
 *
 * 本文件只放**纯函数**（判定 + 文案 + 记忆条目构造），调度器在 host/index.ts ——
 * 与 whisper-policy.ts 同一个分工：判定逻辑要能单测，起宿主的测试跑一次要几秒。
 */

import type { ChatMemoryMessage } from './chat';

/** 间隔秒数的硬边界：下限 120s、上限 1 天。与 config.ts 的 topFieldValid 同口径。 */
export const MIN_PROACTIVE_SEC = 120;
export const MAX_PROACTIVE_SEC = 86_400;

/** 缺省间隔：30 分钟。比碎碎念的 300s 长得多，因为它会**写记忆 + 烧一次对话 token**。 */
export const DEFAULT_PROACTIVE_SEC = 1_800;

/**
 * 主动消息在记忆里的来源标记。
 *
 * 用途有两个，都很具体：
 *   ① **防连发**：`last.origin === 'proactive'` 表示"她刚开口、还没人接"，
 *      此时不该再开口第二次（否则她会对空气连说三句）。
 *   ② 排查：日志/记忆里一眼看出这条不是对话产物。
 *
 * 为什么不复用 `origin: 'group'`（那是主人发言镜像进单人流用的）：两者语义相反——
 * 那个标的是"这句话是从群里来的"，这个标的是"这句话是她主动说的"，混用会让
 * `shouldMirrorOwner` 那套逻辑的排查彻底失去意义。
 */
export const PROACTIVE_ORIGIN = 'proactive';

/**
 * 间隔秒数（已合并配置 → 一个可用的数字）。
 *
 * 非法值一律回落缺省而不是夹紧：配置层 `topFieldValid` 已经把越界值拒在门外，
 * 能走到这里的非法值只可能来自手改文件——此时按缺省跑比按 120s 疯狂刷屏安全。
 */
export function proactivePeriodSec(conf: Record<string, unknown>): number {
  const v = Number(conf.proactiveChatSec);
  if (!Number.isFinite(v) || v < MIN_PROACTIVE_SEC || v > MAX_PROACTIVE_SEC) return DEFAULT_PROACTIVE_SEC;
  return Math.floor(v);
}

/** 开关：只有显式 `true` 才算开（缺键 / 非法 / 字符串 'true' 一律当关）。 */
export function proactiveEnabled(conf: Record<string, unknown>): boolean {
  return conf.proactiveChatEnabled === true;
}

/** 跳过原因（写进每拍汇总日志，也是单测的断言对象） */
export type ProactiveSkip =
  /** 全局开关没开 */
  | 'disabled'
  /** 还没到间隔 */
  | 'not-due'
  /** 这只宠物正被占用（对话 / 助手动作进行中） */
  | 'locked'
  /** AI 不可用（独立模式未配置密钥 / 被降级成 createDisabledStandaloneAi） */
  | 'ai-unavailable'
  /** 不在成对边界上：上一条是 user 消息 = 她还欠着一个回复，不该另起话头 */
  | 'not-at-boundary'
  /** 她刚主动说过、还没人接 */
  | 'unanswered'
  /** 这只宠物当前不显示（display: 'none'），说了也没人看得见 */
  | 'hidden';

export interface ProactiveDecisionInput {
  /** 全局开关（conf.proactiveChatEnabled === true） */
  enabled: boolean;
  /** 间隔秒（proactivePeriodSec 的结果） */
  periodSec: number;
  /** 上次主动开口的时刻；0 = 本进程内从未开口 */
  lastAt: number;
  now: number;
  /** 该宠物被占用锁持有 */
  locked: boolean;
  /** AI 可用（宿主模式下恒 true；独立模式看 isReady/canWhisper） */
  aiReady: boolean;
  /** 目标记忆流（单人 = entry.messages，群聊 = 该群的 messages）的最后一条 */
  last: ChatMemoryMessage | undefined;
  /** 该宠物是否可见（display !== 'none'） */
  visible: boolean;
}

/**
 * 这一拍该不该让某只宠物主动开口。
 *
 * 判定顺序有讲究：**先判便宜的、再判贵的**。`disabled` / `not-due` / `hidden` 只用
 * 内存里的数字，`locked` / `ai-ready` 也便宜；只有 `last` 需要读记忆（调用方已读）。
 * 顺序本身不影响正确性，但决定了日志里出现的是哪一个原因——用户排查时看到的
 * 应该是**最根本的那个**（开关没开就别告诉他是"还没到点"）。
 */
export function proactiveDecision(input: ProactiveDecisionInput): { go: boolean; reason?: ProactiveSkip } {
  if (!input.enabled) return { go: false, reason: 'disabled' };
  if (!input.visible) return { go: false, reason: 'hidden' };
  if (!input.aiReady) return { go: false, reason: 'ai-unavailable' };
  if (input.locked) return { go: false, reason: 'locked' };
  if (input.now - input.lastAt < input.periodSec * 1000) return { go: false, reason: 'not-due' };
  // 记忆为空（全新宠物）时允许开口——这正是"她第一次主动找你"的场合。
  if (input.last) {
    // 上一条是她自己刚主动说的：等人接，别连发。
    if (input.last.role === 'assistant' && input.last.origin === PROACTIVE_ORIGIN) {
      return { go: false, reason: 'unanswered' };
    }
    // 上一条是用户消息 = 她还欠一个回复。此时另起话头会变成"你问了她，她却聊别的"。
    // 那个回复由正常对话链路负责（用户说话那一刻就触发了），不归这里管。
    if (input.last.role === 'user') return { go: false, reason: 'not-at-boundary' };
  }
  return { go: true };
}

/**
 * 主动开口时给模型的"用户指令"。
 *
 * **这条指令不写进记忆**——它只是这一次调用的脚手架。写进记忆的只有模型的回复
 * （见 `proactiveMessage`）。若把指令也存了，用户翻历史时会看到自己从没说过的话。
 *
 * 为什么仍然要包成一条 user 消息：独立模式的 `parseRequest`（standalone/ai-provider.ts）
 * 硬性要求 `messages[0].role === 'user'` **且** `messages[last].role === 'user'`，
 * 否则直接抛 `Standalone AI input is empty or exceeds limits.`。也就是说
 * "让模型只产出一条 assistant 消息"在协议层就不可能——必须有一句 user 收尾。
 */
export function proactiveInstruction(groupName?: string): string {
  const where = groupName && groupName.trim() !== '' ? `群里（「${groupName.trim()}」）` : '这里';
  return (
    `（${where}现在没有人说话。你想主动搭一句话——可以问问对方刚才在忙什么、` +
    '说说你刚注意到的小事，或者接着你们上次聊的话题往下聊。' +
    '一两句就好，像平常说话那样；不要解释你在做什么，不要提你是 AI，也不要重复上次说过的话。）'
  );
}

/**
 * 构造要写进记忆的那一条。
 *
 * 为什么是 `role: 'assistant'` 而不是伪造一条 user 消息：记忆是**事实记录**，
 * 她说的话就是她说的话。伪造一条"用户说"会让模型下次以为自己被问过，
 * 也会让用户翻历史时看到自己从没打过的字。
 *
 * 代价（已知、已处理）：这会在记忆流里造成两条连续的 assistant 消息，
 * 破坏"严格一问一答"的形状。两处依赖该形状的地方已各自兜住：
 *   · `sliceMemoryRounds` 截出的窗口可能以 assistant 开头 → `chatWithPet` 会裁掉开头的
 *     assistant（否则独立模式那条 `messages[0]==='user'` 的断言会抛）；
 *   · `summarized` 游标只认索引、只追加不动中间，追加不会让它错位。
 */
export function proactiveMessage(text: string, ts: number): ChatMemoryMessage {
  return { role: 'assistant', content: text, ts, origin: PROACTIVE_ORIGIN };
}
