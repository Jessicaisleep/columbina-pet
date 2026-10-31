/**
 * 「正在对话」静默窗（2026-11-01 用户要求：对话模式下禁碎碎念，手机电脑端都是）。
 *
 * 为什么放在宿主、而不是各端自己藏气泡：
 * 碎碎念只有一个来源——宿主调度器（`src/host/index.ts` 的 tick → publishWhisper）。
 * 在源头不生成，两端就天然一致；要是改成「各端收到不显示」，AI 调用照旧发生、
 * 记忆/日志照旧被写，而且两端判定口径迟早会漂移。
 *
 * 判定口径故意做得**与端无关**：只看「这只宠物最近有没有说过话」。
 *   - 用户刚发过消息、或她刚回过一句 → 静默窗内不再自言自语；
 *   - 生成进行中（几秒到几十秒）也落在静默窗里，因为进入生成时就先记了一笔；
 *   - 于是「连续对话」「一口气聊十分钟」「手机和电脑交替聊」都不需要额外状态。
 *
 * 不采用「客户端上报弹窗开着」这条路：那要新增一条写接口（还要进 openapi 与鉴权），
 * 而弹窗开着却十分钟没打字的场景本来就该允许她自言自语一句。
 */

/** 静默窗长度：最后一条对话（用户或她）之后这么久内不碎碎念。 */
export const CHAT_QUIET_MS = 3 * 60_000;

/**
 * 这一拍要不要因为「正在对话」而跳过碎碎念。
 * `lastTalkAt` 为 undefined（这只宠物从没说过话）时返回 false —— 冷启动照常说。
 */
export function chatQuiet(lastTalkAt: number | undefined, now: number, quietMs: number = CHAT_QUIET_MS): boolean {
  if (!Number.isFinite(lastTalkAt)) return false;
  if (!Number.isFinite(now)) return false;
  // 时间回拨（系统对时）时 lastTalkAt 可能在未来：按「刚说过」处理，宁可不打扰
  const delta = now - (lastTalkAt as number);
  return delta < quietMs;
}

/** 每只宠物最后一次「对话」的时刻（内存态，重启即清空——重启后本来就该重新开始说话）。 */
export class ChatActivity {
  // 不用类字段初始化：es2020 目标会把「无初始化器的私有字段」降级成 _defineProperty(...)，
  // 进而把 @oxc-project/runtime 拖成一条裸 import（那个包不在本包依赖里，
  // 装好的用户跑起来会 ERR_MODULE_NOT_FOUND）。约定同 src/host/mobile-screen.ts。
  declare private last: Map<string, number>;

  constructor() {
    this.last = new Map();
  }

  /** 记一笔「刚刚有一轮对话」（用户发消息 / 她主动开口 / 开始生成时都记）。 */
  note(petId: string, now: number = Date.now()): void {
    if (!petId) return;
    this.last.set(petId, now);
  }

  /** 这只宠物此刻是否处于「正在对话」的静默窗内。 */
  quiet(petId: string, now: number = Date.now()): boolean {
    return chatQuiet(this.last.get(petId), now);
  }

  /** 仅测试用：读原始时刻（没有返回 undefined）。 */
  lastTalkAt(petId: string): number | undefined {
    return this.last.get(petId);
  }
}
