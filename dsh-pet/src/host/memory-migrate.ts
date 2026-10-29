/**
 * 记忆框架迁移（旧 → 新）——**纯逻辑**，不碰 IO。
 *
 * ## 为什么要迁移
 *
 * 旧框架的问题（实测自真实 `memory.json`）：
 *   46 条消息，`summarized = 8`，摘要只有 60 字，`chatMemoryRounds = 5`（最后 10 条）。
 *   进上下文的只有「摘要(覆盖 0..7) + 最近 10 条」，**middle 的 28 条（61%）完全不可见**。
 *   而那 28 条里正好有用户明确要求记住的三件事：
 *     `[12] 记住我住在杭州`  `[14] 我养了一只猫叫团子`  `[16] 我喜欢喝无糖豆浆`
 *   用户切换框架后，如果不做回填，这些事**仍然是看不到的**——等于升级把人弄失忆了。
 *
 * ## 迁移做什么
 *
 * 1. **从历史消息里回填事实卡**：逐条跑 `extractFacts`，按 `mergeFacts` 覆盖合并。
 *    这是本次迁移最重要的部分——它把「黑洞里的稳定事实」救成常驻。
 * 2. **保留原 `messages` 不动**：原文是唯一真相，任何压缩都必须能回溯到这里。
 *    （旧框架也是这么做的：`summarized` 只是游标，不删数据。）
 * 3. **摘要位置修正**：旧摘要若覆盖的区间有空洞（`summarized` 之后到窗口之前还有没被摘要
 *    覆盖的内容），标记出来，让上层选择是重写摘要还是交给检索。本模块只给判定，不改写摘要
 *    文本——摘要重写要调模型，属于上层。
 *
 * ## 为什么迁移是幂等的
 *
 * 归档里同时可能有新旧两种形状。迁移必须能重复跑（导入 → 校验 → 再导入），
 * 所以判定全用「有没有这个键」而不是「版本号是多少」：事实卡有了就不重建，
 * 已经从消息回填过的事实不会被重复追加（`mergeFacts` 按 key 覆盖，天然幂等）。
 */

import { extractFacts, mergeFacts, type MemoryFact } from './memory-facts';

/** 旧形状（v1）：只有 messages/摘要游标 */
export interface LegacyChatMemoryEntry {
  messages: Array<{ role: 'user' | 'assistant'; content: string; ts?: number }>;
  summarized?: number;
  summary?: string;
  summaryTs?: number;
}

/** 新形状（v2）：在旧形状上叠加事实卡与群聊分桶 */
export interface ChatMemoryEntryV2 extends LegacyChatMemoryEntry {
  /** L0 常驻事实卡（由 `./memory-facts` 维护） */
  facts?: MemoryFact[];
  /** 事实卡最后一次更新的消息下标；迁移时用来判断「回填过没有」 */
  factsUpto?: number;
  /** 群聊模式下的成员分桶（单人模式没有这个键） */
  members?: Record<string, LegacyChatMemoryEntry>;
}

/** 迁移结果 */
export interface MigrationResult {
  entry: ChatMemoryEntryV2;
  /** 本次回填了几条事实 */
  factsAdded: number;
  /** 回填后的事实卡总条数 */
  factsTotal: number;
  /** 旧数据是否存在「摘要与窗口之间的黑洞」——存在则升级后仍需上层处理 */
  hasHole: boolean;
  /** 黑洞区间（消息下标，左闭右开）；无洞时为 null */
  hole: { start: number; end: number } | null;
  /** 是否真的做了改动（false → 调用方不必写盘） */
  changed: boolean;
}

/** 迁移时的默认窗口轮数：与 `assets/config.jsonc` 的 `chatMemoryRounds` 保持一致 */
const DEFAULT_KEEP_ROUNDS = 5;

/**
 * 检查旧数据里是否存在「摘要没覆盖、又不在近期窗口」的黑洞。
 *
 * 这个判定**独立于迁移**保留下来，因为它是旧框架的固有缺陷：
 * 即便回填了事实卡，那 28 条里的**非事实内容**（比如当时的心情、说过的琐事）仍然不可见。
 * 上层可以选择：把黑洞区间交给检索（默认，零成本）、或用模型重写一次摘要（有成本）。
 */
export function findMemoryHole(
  entry: LegacyChatMemoryEntry,
  keepRounds: number = DEFAULT_KEEP_ROUNDS,
): { start: number; end: number } | null {
  const total = Array.isArray(entry.messages) ? entry.messages.length : 0;
  if (total === 0) return null;
  const summarized = Math.max(0, Math.floor(Number(entry.summarized ?? 0)) || 0);
  const rounds = Math.max(0, Math.floor(Number(keepRounds)) || 0);
  const windowStart = Math.max(summarized, total - rounds * 2);
  // 摘要与窗口之间还有内容 → 就是黑洞
  if (windowStart > summarized) return { start: summarized, end: windowStart };
  return null;
}

/**
 * 把一条旧记忆条目升级到新形状。
 *
 * @param entry 读出来的原始条目（可能已经是新形状——此时等价于幂等返回）
 * @param now 回填事实时用的时间戳（由调用方给，保持纯函数）
 * @param keepRounds 当前配置的窗口轮数（用于算黑洞）
 */
export function migrateEntry(
  entry: LegacyChatMemoryEntry,
  now: number,
  keepRounds: number = DEFAULT_KEEP_ROUNDS,
): MigrationResult {
  const src: LegacyChatMemoryEntry = entry && typeof entry === 'object' ? entry : { messages: [] };
  const messages = Array.isArray(src.messages) ? src.messages : [];

  const hole = findMemoryHole(src, keepRounds);

  // 已经是新形状（有 facts 键）→ 不再回填，避免重复抽取把 explicit 标记覆盖掉
  const already = (src as ChatMemoryEntryV2).facts;
  if (Array.isArray(already)) {
    const v2 = src as ChatMemoryEntryV2;
    return {
      entry: v2,
      factsAdded: 0,
      factsTotal: already.length,
      hasHole: hole !== null,
      hole,
      changed: false,
    };
  }

  // 逐条回填：只回填用户说的话（宠物的话里不会出现「我叫 X」这类关于用户的陈述，
  // 而且宠物的自称「我叫哥伦比娅」会被 name 规则抽成用户叫哥伦比娅 —— 这是必须避开的坑）
  let facts: MemoryFact[] = [];
  let added = 0;
  for (const m of messages) {
    if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
    const extracted = extractFacts(m.content);
    if (extracted.length === 0) continue;
    // 用消息自带的时间戳（有的话）保留「这事他提了很久」的语气信息
    const ts = Number.isFinite(Number(m.ts)) ? Number(m.ts) : now;
    const r = mergeFacts(facts, extracted, ts);
    if (r.changed) added += extracted.length;
    facts = r.facts;
  }

  const out: ChatMemoryEntryV2 = { ...src, facts, factsUpto: messages.length };

  return {
    entry: out,
    factsAdded: added,
    factsTotal: facts.length,
    hasHole: hole !== null,
    hole,
    // 走到这里就意味着「这条要补 facts / factsUpto 两个键」，哪怕一条事实都没抽到也是改动：
    // 不写这两个键的话，下次导出会再扫一遍、而且磁盘上永远看起来像「没迁移过」。
    changed: true,
  };
}

/**
 * 批量迁移整个 memory.json 结构。
 *
 * 形状是 `{ <kind>/<petId>: LegacyEntry | { <petId>: LegacyEntry } }` 的两层还是三层，
 * 取决于旧文件是「按宠物」还是「按群+成员」。这里**不假设层级**：
 * 递归走到叶子（有 `messages` 数组的才是叶子），其余继续下潜。
 * 这样新加的群聊分桶（`群 → 宠物 → 成员`）在同一份代码里也能被正确迁移。
 */
export function migrateMemoryFile(
  raw: unknown,
  now: number,
  keepRounds: number = DEFAULT_KEEP_ROUNDS,
): {
  value: Record<string, unknown>;
  migrated: number;
  factsAdded: number;
  holes: Array<{ path: string; start: number; end: number }>;
} {
  let migrated = 0;
  let factsAdded = 0;
  const holes: Array<{ path: string; start: number; end: number }> = [];

  const walk = (node: unknown, path: string, depth: number): unknown => {
    if (depth > 6 || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node;

    const obj = node as Record<string, unknown>;
    // 叶子判定：有 messages 数组就是记忆条目
    if (Array.isArray(obj.messages)) {
      const r = migrateEntry(obj as unknown as LegacyChatMemoryEntry, now, keepRounds);
      // 只数**真的改了**的条目。已经迁移过的条目也会被走一遍（migrateEntry 幂等返回副本），
      // 若在这里无条件 +1，导入 v2 包时就会谎报「又迁移了一次」。
      if (r.changed) migrated += 1;
      factsAdded += r.factsAdded;
      if (r.hole) holes.push({ path, start: r.hole.start, end: r.hole.end });
      return r.entry;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v, path === '' ? k : path + '/' + k, depth + 1);
    return out;
  };

  const value = (walk(raw, '', 0) ?? {}) as Record<string, unknown>;
  return { value, migrated, factsAdded, holes };
}
