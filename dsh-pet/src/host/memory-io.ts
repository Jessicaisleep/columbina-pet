/**
 * 记忆文件的写盘底座（2026-11-01，「双端记忆不要分叉」的地基）。
 *
 * 三件事，互相独立但必须同时成立，缺一条「回家合并」就不成立：
 *
 *  1. **原子写**：先写同目录临时文件、fsync、再 `rename` 覆盖。
 *     旧实现是 `writeFile(memoryPath, ...)` 直接截断重写 —— 掉电/进程被杀/两端同时写，
 *     用户看到的是「记忆全没了」或半截 JSON（parse 失败后宿主会当新会话，等于静默丢档）。
 *     rename 在同一分区上是原子的：要么旧文件完好，要么新文件完整，不存在中间态。
 *
 *  2. **每条消息一个永久编号**：`id` 一旦写进文件就不再变。
 *     手机出门时在本地写消息、回家要追加到电脑这份记忆里 —— 没有编号就只能靠「第几条」猜，
 *     而两边各自的「第几条」根本不可比。编号是合并时**唯一**的去重依据。
 *
 *  3. **只追加日志**（`memory-log.jsonl`，一行一条）：整份 memory.json 的 diff 不适合当同步通道
 *     （顺序、删除、压缩游标都在里面动）。日志只记「新的那条消息是什么」，按行追加，
 *     永远不改旧行 —— 回家合并只需把手机上没见过的那几行追加进来。
 *     它同时是**故障档案**：memory.json 万一坏了，日志还在。
 *
 * 刻意不做的事：
 *   - 不在日志里记压缩摘要与事实卡。派生状态**只能有一个作者**（见交接书 §37/§38），
 *     手机离线期间不压缩，回家由电脑统一重算。
 *   - 不做日志 compaction/轮转。一眼能数清的量级（一条消息一行，几万行也就几 MB），
 *     加轮转就要处理「轮转后编号还在不在」，反而引入新风险。
 */

import { randomBytes } from 'node:crypto';
import { open, rename, appendFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { ChatMemoryMessage } from './chat';
import type { ChatMemoryEntry } from './memory-summary';

/** 只追加日志的文件名（与 memory.json 同目录：`<userRoot>/memory-log.jsonl`） */
export const MEMORY_LOG_FILE = 'memory-log.jsonl';

/** `{ <种类桶>: { <实例 id>: ChatMemoryEntry } }` —— 与 readMemory/writeMemory 同形状 */
export type MemoryTree = Record<string, Record<string, ChatMemoryEntry>>;

/** 日志里的一行 */
export interface MemoryLogLine {
  id: string;
  /** 种类桶（assetRoot），例如 columbina */
  root: string;
  /** 实例 id，例如 columbina1 */
  pet: string;
  /** 群号；单人流的消息为空串 */
  group: string;
  role: string;
  content: string;
  ts: number;
  origin?: string;
  sender?: string;
  senderName?: string;
}

/**
 * 给一条消息发号。**编号里带 ts 与「同 ts 内的序号」**，因此在同一只宠物（或同一群）的流里唯一；
 * 跨宠物可能撞 ts，所以前缀也带上作用域。
 *
 * 序号用「消息在当前流里的下标」而不是随机数：同一份旧文件重复跑 assignIds
 * 得到的编号一致（幂等），不会每次启动都把没编号的老消息换个号 —— 换了号就等于新消息，
 * 回家合并会重复追加。
 */
function makeId(scope: string, ts: number, index: number): string {
  return 'm-' + scope + '-' + ts.toString(36) + '-' + index.toString(36);
}

/** 遍历一棵记忆树里的所有消息流：单人 `messages` + 每个群 `groups[群号].messages` */
function eachStream(
  mem: MemoryTree,
  visit: (info: { root: string; pet: string; group: string; messages: ChatMemoryMessage[] }) => void,
): void {
  for (const root of Object.keys(mem)) {
    const bucket = mem[root];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const pet of Object.keys(bucket)) {
      const entry = bucket[pet];
      if (!entry || typeof entry !== 'object') continue;
      if (Array.isArray(entry.messages)) visit({ root, pet, group: '', messages: entry.messages });
      const groups = entry.groups;
      if (groups && typeof groups === 'object') {
        for (const group of Object.keys(groups)) {
          const g = groups[group];
          if (g && typeof g === 'object' && Array.isArray(g.messages)) {
            visit({ root, pet, group, messages: g.messages });
          }
        }
      }
    }
  }
}

/** 群记忆与单人记忆的形状一样（`messages` 字段），这里只要这一件事 */
interface GroupMemoryLike {
  messages?: ChatMemoryMessage[];
}

/**
 * 给缺编号的消息补号（**原地改**），返回补了几条。
 *
 * 幂等：已经有 id 的一律不动。老用户的 memory.json 没编号，第一次写盘时一次性补齐并落盘，
 * 之后编号永远不变。
 */
export function assignIds(mem: MemoryTree): number {
  let assigned = 0;
  eachStream(mem, ({ pet, group, messages }) => {
    const scope = group === '' ? pet : pet + '/' + group;
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (!m || typeof m !== 'object') continue;
      if (typeof m.id === 'string' && m.id !== '') continue;
      m.id = makeId(scope, typeof m.ts === 'number' ? m.ts : 0, i);
      assigned += 1;
    }
  });
  return assigned;
}

/**
 * 找出「日志里还没有的」消息，按出现顺序返回日志行。
 *
 * 只认有 id 的消息（先跑 `assignIds`）；`loggedIds` 由 `readLoggedIds` 从日志文件恢复，
 * 所以进程重启后不会把整份记忆重灌一遍日志。
 */
export function collectNewLines(mem: MemoryTree, loggedIds: Set<string>): MemoryLogLine[] {
  const lines: MemoryLogLine[] = [];
  eachStream(mem, ({ root, pet, group, messages }) => {
    for (const m of messages) {
      if (!m || typeof m !== 'object') continue;
      const id = typeof m.id === 'string' ? m.id : '';
      if (id === '' || loggedIds.has(id)) continue;
      const line: MemoryLogLine = {
        id,
        root,
        pet,
        group,
        role: String(m.role ?? ''),
        content: String(m.content ?? ''),
        ts: typeof m.ts === 'number' ? m.ts : 0,
      };
      if (typeof m.origin === 'string' && m.origin !== '') line.origin = m.origin;
      if (typeof m.sender === 'string' && m.sender !== '') line.sender = m.sender;
      if (typeof m.senderName === 'string' && m.senderName !== '') line.senderName = m.senderName;
      lines.push(line);
    }
  });
  return lines;
}

/** 从日志文件文本里恢复已记录的编号集合（坏行跳过，不让一行脏数据卡死整个写入） */
export function readLoggedIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    try {
      const obj = JSON.parse(line) as { id?: unknown };
      if (typeof obj.id === 'string' && obj.id !== '') ids.add(obj.id);
    } catch {
      /* 半截行（上次写到一半被杀）——跳过；这条消息下次还会被判成新消息，代价只是重复一行 */
    }
  }
  return ids;
}

/** 日志行的文本块（一行一条 + 结尾换行），便于测试与批量追加 */
export function formatLogLines(lines: MemoryLogLine[]): string {
  if (lines.length === 0) return '';
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** 追加日志（`appendFile` 在 O_APPEND 下写，不会覆盖已有行） */
export async function appendLogLines(path: string, lines: MemoryLogLine[]): Promise<void> {
  const text = formatLogLines(lines);
  if (text === '') return;
  await appendFile(path, text, 'utf8');
}

/**
 * 原子写一个文本文件：临时文件 → fsync → rename 覆盖。
 *
 * 临时文件放在**同目录**（跨分区 rename 会退化成复制，就不是原子了），
 * 名字以 `.` 开头且带随机后缀，避免和 `portable` 的导出扫描撞上。
 */
export async function atomicWriteText(path: string, text: string): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, '.' + basename(path) + '.tmp-' + randomBytes(4).toString('hex'));
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(text, 'utf8');
    // 先落盘再改名：少这一步，rename 之后掉电仍可能得到空文件（NTFS/ext4 都会）
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

// `GroupMemoryLike` 只用于说明群记忆形状与单人一致；声明在这里避免 import 循环
export type { GroupMemoryLike };
