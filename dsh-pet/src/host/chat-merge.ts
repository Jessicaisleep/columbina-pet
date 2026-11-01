/**
 * 接收端合并（2026-11-01，与 `./split-reply` 一对）：用户连发几条时，
 * 先攒一个静默窗口，再把这几句当成一轮交出去，**只回一次**。
 *
 * 为什么放在 host 而不是每个前端各做一遍：电脑对话弹窗、手机页、独立端窗口是三条
 * 独立的发送路径，只有 host 是它们共同的收口点。放这里，三端自动一致，也不用改协议。
 *
 * 两条安全阀（缺了任意一条都会出现「一直打字 → 永远不回复」）：
 *  · maxTexts —— 一直发也不会把一批攒成十句；
 *  · maxWaitMs —— 从第一条起算的硬上限，窗口被反复重置也一定会发出。
 *
 * 合并的是**同一只宠物**的对话：不同宠物各有各的会话，混在一起会把主人跟 A 说的话
 * 端给 B 回答（越界而且离谱）。所以每只宠物一个实例（见 index.ts 的 chatMergers）。
 *
 * 纯逻辑、只用 setTimeout，可在 node:test 里直接跑（窗口给几十毫秒即可）。
 */

/** 合并静默窗口默认值（毫秒） */
export const MERGE_WINDOW_DEFAULT_MS = 800;

/** 合并静默窗口上限：再长用户会以为程序卡住了 */
export const MERGE_WINDOW_MAX_MS = 3000;

/** 一批最多合并几条 */
export const MERGE_MAX_TEXTS = 6;

/** 从第一条到强制发出最长等多久（毫秒） */
export const MERGE_MAX_WAIT_MS = 5000;

export interface ChatMergerOptions<P, R> {
  /** 一批凑齐时怎么跑。**一批只调一次**，所有等待者共享同一个结果 */
  run: (items: P[]) => Promise<R>;
  /** 从第一条到强制发出，最长等多久（默认 5000ms） */
  maxWaitMs?: number;
  /** 最多合并几条（默认 6） */
  maxTexts?: number;
}

interface Waiter<P, R> {
  item: P;
  resolve: (value: R) => void;
  reject: (err: unknown) => void;
}

export class ChatMerger<P, R> {
  // 字段一律 declare + 构造器赋值（与 src/host/helper-process.ts 同一约定）：
  // 带初始值的类字段会让 tsdown/oxc 注入 @oxc-project/runtime 的辅助函数，
  // 而 scripts/prepack-check.js 要求发布包里不能出现未声明的运行时依赖。
  declare private readonly run: (items: P[]) => Promise<R>;
  declare private readonly maxWaitMs: number;
  declare private readonly maxTexts: number;
  declare private pending: Waiter<P, R>[];
  declare private timer: ReturnType<typeof setTimeout> | null;
  declare private firstAt: number;

  constructor(opts: ChatMergerOptions<P, R>) {
    this.run = opts.run;
    this.maxWaitMs = opts.maxWaitMs ?? MERGE_MAX_WAIT_MS;
    this.maxTexts = opts.maxTexts ?? MERGE_MAX_TEXTS;
    this.pending = [];
    this.timer = null;
    this.firstAt = 0;
  }

  /** 当前攒着几条（排错与测试用） */
  get size(): number {
    return this.pending.length;
  }

  /**
   * 交一条输入，等这一批生成完拿结果。
   *
   * `windowMs <= 0` = 用户关了合并：立刻把手里这条（以及此前攒着的）发出去，
   * 不做任何等待——关掉开关就必须是「关掉」的行为，不能偷偷还攒 800ms。
   */
  submit(item: P, windowMs: number): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const now = Date.now();
      if (this.pending.length === 0) this.firstAt = now;
      this.pending.push({ item, resolve, reject });

      const waitedEnough = now - this.firstAt >= this.maxWaitMs;
      if (windowMs <= 0 || this.pending.length >= this.maxTexts || waitedEnough) {
        this.flush();
        return;
      }
      if (this.timer !== null) clearTimeout(this.timer);
      // 等 min(窗口, 剩余硬上限)：两条阀同时生效，不会因为不断有输入而把上限推后
      const wait = Math.min(windowMs, Math.max(0, this.maxWaitMs - (now - this.firstAt)));
      this.timer = setTimeout(() => this.flush(), wait);
    });
  }

  /** 立刻把攒着的这批发出去（停服/退出/测试收尾都可以直接调） */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending;
    if (batch.length === 0) return;
    this.pending = [];
    this.firstAt = 0;
    this.run(batch.map((b) => b.item)).then(
      (value) => {
        for (const b of batch) b.resolve(value);
      },
      (err: unknown) => {
        for (const b of batch) b.reject(err);
      },
    );
  }
}

/**
 * 合并窗口（毫秒）：缺键 / 非法 → 默认 800；0 = 关闭合并；上限夹到 3000。
 *
 * 与 `chatMergeWindowMs` 的校验侧（config.ts 的 topFieldValid）同口径：那边非有限数
 * 或越界直接拒（不静默夹紧），这里只兜「老配置没有这个键」与「读到的值被手改坏了」。
 */
export function mergeWindowMsOf(conf: Record<string, unknown> | undefined): number {
  const raw = conf?.chatMergeWindowMs;
  if (raw === undefined) return MERGE_WINDOW_DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return MERGE_WINDOW_DEFAULT_MS;
  return Math.min(MERGE_WINDOW_MAX_MS, Math.floor(n));
}
