/**
 * 回家合并：手机离线期间说的话，回到同一网络后**追加**进电脑的记忆（2026-11-01）。
 *
 * 用户拍板的方案只有一句话的骨架：「不在同一 WIFI 只有手机能写；回来是追加，不是两边各存一份」。
 * 由此推出一条铁律 —— **派生状态永远只有一个作者**：
 *
 *   - 消息（messages）可以追加：每条都有永久编号 `id`，重复上传按 id 去重，天然幂等。
 *   - 摘要 / 事实卡 / 摘要进度（summary、facts、summarized、summaryTs、factsUpto）**一律不动**：
 *     它们是从整段消息算出来的，手机那边算一遍、电脑再算一遍就是两个作者，越算越歪。
 *     手机离线期间**不做压缩**；回家后由电脑统一重算。
 *
 * 为什么不需要冲突合并算法：因为电脑在接管期间**一个字都不写**（见 paired-devices 的
 * `phoneTakeover`）。一边写、一边不写，回来就只剩"把缺的补上"，不存在两种版本打架。
 * 一旦有人给电脑加了"强制可写"的后门，这个前提就没了 —— 那时必须真的写 CRDT，别硬来。
 */

import type { ChatMemoryMessage } from './chat';
import type { ChatMemoryEntry } from './memory-summary';

export interface AppendCandidate {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  origin?: string;
  sender?: string;
  senderName?: string;
}

export interface AppendOutcome<T extends ChatMemoryEntry> {
  /** 改过的那份 entry（原地改，返回同一个对象便于链式校验） */
  entry: T;
  /** 真追加了几条 */
  added: number;
  /** 因为编号已存在而跳过几条（重复上传 / 重试） */
  skipped: number;
  /** 因为不合法被丢几条（无编号、无内容、时间不是数） */
  dropped: number;
}

/** 手机带上来的消息逐条校验：宁可丢一条坏数据，也不要把 undefined 写进记忆里 */
export function sanitizeCandidate(raw: unknown): AppendCandidate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const content = typeof o.content === 'string' ? o.content : '';
  const ts = typeof o.ts === 'number' && Number.isFinite(o.ts) ? o.ts : 0;
  const roleRaw = o.role;
  if (id === '') return undefined;
  if (content === '') return undefined;
  if (ts <= 0) return undefined;
  // 记忆流里只该有 user / assistant（system 是临时拼给模型的，不属于对话记录）
  if (roleRaw !== 'user' && roleRaw !== 'assistant') return undefined;
  const role: 'user' | 'assistant' = roleRaw;
  const out: AppendCandidate = { id, role, content, ts };
  if (typeof o.origin === 'string' && o.origin !== '') out.origin = o.origin;
  if (typeof o.sender === 'string' && o.sender !== '') out.sender = o.sender;
  if (typeof o.senderName === 'string' && o.senderName !== '') out.senderName = o.senderName;
  return out;
}

/**
 * 把候选消息追加进一个记忆流。
 *
 * 顺序：先按 `ts` 排（手机可能因为网络抖动把顺序传错），再逐条判重。
 * **不重排已有消息**：本机原本的顺序就是权威，只在末尾追加。
 */
export function appendMessages<T extends ChatMemoryEntry>(entry: T, incoming: unknown[]): AppendOutcome<T> {
  if (!Array.isArray(entry.messages)) entry.messages = [];
  const have = new Set<string>();
  for (const m of entry.messages) {
    const id = (m as ChatMemoryMessage).id;
    if (typeof id === 'string' && id !== '') have.add(id);
  }
  const clean: AppendCandidate[] = [];
  let dropped = 0;
  for (const raw of incoming) {
    const c = sanitizeCandidate(raw);
    if (!c) {
      dropped += 1;
      continue;
    }
    clean.push(c);
  }
  clean.sort((a, b) => a.ts - b.ts);
  let added = 0;
  let skipped = 0;
  for (const c of clean) {
    if (have.has(c.id)) {
      skipped += 1;
      continue;
    }
    have.add(c.id);
    const msg: ChatMemoryMessage = { role: c.role, content: c.content, ts: c.ts, id: c.id };
    if (c.origin !== undefined) msg.origin = c.origin;
    if (c.sender !== undefined) msg.sender = c.sender;
    if (c.senderName !== undefined) msg.senderName = c.senderName;
    entry.messages.push(msg);
    added += 1;
  }
  return { entry, added, skipped, dropped };
}

/**
 * 手机侧离线队列要用的编号。
 *
 * 与 `memory-io.ts` 的 `assignIds` 同一形状（`m-<宠物>-<ts36>-<序号36>`），因为回家合并时
 * 这两套编号必须在同一个命名空间里去重。手机端自己生成、自己保存，联网后整段上传。
 */
export function newMessageId(petId: string, ts: number, seq: number): string {
  const scope = petId.replace(/[^A-Za-z0-9_-]/g, '') || 'pet';
  return `m-${scope}-${Math.max(0, Math.floor(ts)).toString(36)}-q${Math.max(0, Math.floor(seq)).toString(36)}`;
}
