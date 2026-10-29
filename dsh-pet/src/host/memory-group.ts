/**
 * 群聊记忆（`memoryMode: 'group'`）——**纯逻辑**，不碰 IO。
 *
 * ## 为什么群聊必须单独一套
 *
 * 单人模式的记忆形状是 `{ 条目: { 宠物: 记忆 } }`——**没有「谁在说话」这个维度**。
 * 实测过：`chatWithPet(petId, text)` 只有两个参数，`POST /chat` 的 body 只取 `parsed.text`，
 * `memoryEntryOf(mem, entryKey, petId)` 只有两维。也就是说群里 500 个人共用同一条记忆流：
 *
 *   - 张三说「我住在杭州」，李四问「我住哪」→ 宠物答「杭州」。
 *     这不是"记性好"，这是**认错人**。对陪伴型 AI 来说，认错人比忘记更伤。
 *   - 500 人 × 每人每天 1 句 40 字 × 365 天 = 730 万 token/年（1M 窗口的 696%）。
 *     单窗口根本装不下，压缩触发线每 48 分钟就要重写一次摘要——每次都是有损的。
 *
 * 所以群聊模式把「谁说的」提升成一等维度，并且按用户定的两档策略管理：
 *
 *   - `everyone`：每个说过话的人各一份记忆（上限 `MAX_MEMBERS`，防无限增长）
 *   - `recent`  ：只记得**最近说过话的 N 个人**（N = `groupMemoryRecentN`，用户可调）。
 *     第 N+1 个人开口时，最久没说话的那位被移出记忆——下次他再说话，宠物是真的不认得他。
 *     这个"真的忘掉"是**故意**的：用户要的就是这个语义，不是模拟。
 *
 * ## 为什么成员只存事实卡，不存消息
 *
 * 群聊的消息流是**共享**的（`entry.messages`，每条带 `sender`），成员桶里再存一份就是重复落盘。
 * 成员的 `messages` 想查随时能从共享流按 `sender` 过滤出来（见 `messagesOf`），不需要副本。
 * 成员桶只保留「关于这个人的稳定事实」（L0，见 `./memory-facts`）——这才是别处拿不到的东西。
 */

import {
  extractFacts,
  factsSection,
  mergeFacts,
  pruneFacts,
  type MemoryFact,
} from './memory-facts';
import type { ChatMemoryMessage } from './chat';

/** 群聊记忆策略：记得每个人 / 只记得最近说过话的 N 个人 */
export type GroupScope = 'everyone' | 'recent';

/** 一个群成员的记忆（只存事实卡，不存消息副本——消息在共享流里） */
export interface GroupMember {
  /** 发言者标识（调用方给的稳定 id；QQ 号 / 用户名 / 任何唯一串） */
  id: string;
  /** 展示名（最近一次见到的；改名了就跟着变，不必保留历史名字） */
  name?: string;
  /** 最近一次说话的时间（ms）——`recent` 档按它排序决定谁被挤出 */
  lastTs: number;
  /** 关于这个人的稳定事实（L0） */
  facts?: MemoryFact[];
}

/** 一个群的记忆 */
export interface GroupMemory {
  /** 共享消息流（每条消息带 `sender`），按时间正序 */
  messages: ChatMemoryMessage[];
  /** 前多少条已被 `summary` 覆盖 */
  summarized?: number;
  /** 群聊的滚动摘要（聊过什么话题，不是"谁是谁"） */
  summary?: string;
  summaryTs?: number;
  /** 成员桶：key = 发言者 id */
  members?: Record<string, GroupMember>;
}

/** 单个人最多保留多少条事实——与单人模式同口径（见 `./memory-facts` 的 `MAX_FACTS`） */
export const MAX_MEMBER_FACTS = 20;

/**
 * `everyone` 档的成员上限。
 *
 * 为什么要有上限：`everyone` 的语义是"谁都不忘"，但磁盘和上下文都不是无限的。
 * 200 是实测取的折中——200 人 × 每人 20 条事实 ≈ 4000 条事实，落盘几百 KB，
 * 而单轮上下文只加载**当前说话人**那一份（约 78 token），所以上限不影响每轮成本。
 * 超过 200 就按"最久没说话"淘汰，行为退化到 `recent` 档——但日志会明确写出来。
 */
export const MAX_MEMBERS = 200;

/** `recent` 档 N 的默认值与允许区间（配置层与设置页共用） */
export const DEFAULT_RECENT_N = 10;
export const MIN_RECENT_N = 1;
export const MAX_RECENT_N = 100;

/** 把任意输入规整成合法的 N（设置页滑杆、手改配置、HTTP 参数都过这里） */
export function clampRecentN(value: unknown, fallback: number = DEFAULT_RECENT_N): number {
  // 先排掉「看起来像数字、其实该当缺省」的输入：`Number(null) === 0`、`Number('') === 0`、
  // `Number([]) === 0`。不排的话 `groupMemoryRecentN: null`（JSON 里写 null 很常见）
  // 会被当成"记得 0 个人"再夹到 1——用户明明没设，却得到最极端的值。
  if (value === null || value === undefined || value === '' || Array.isArray(value)) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RECENT_N, Math.max(MIN_RECENT_N, Math.floor(n)));
}

/** 规整策略名（非法值回落 `everyone`——宁可多记，不可误忘） */
export function normalizeScope(value: unknown): GroupScope {
  return value === 'recent' ? 'recent' : 'everyone';
}

/** 成员桶可能是坏结构（数组/标量/null），一律按空对象重建 */
export function membersOf(group: GroupMemory): Record<string, GroupMember> {
  const m = group.members;
  return m && typeof m === 'object' && !Array.isArray(m) ? m : (group.members = {});
}

/**
 * 按「最近说话时间」排序的活跃成员 id 列表（最新在前）。
 *
 * 排序不是纯按 `lastTs`：同一毫秒落盘时（同一条消息推两个人不可能，但迁移/导入可能造出来）
 * 用 id 字典序兜底，保证**结果稳定**——否则每次算出来的活跃集不同，淘汰的就不一定是同一个人。
 */
export function activeMembers(group: GroupMemory, scope: GroupScope, recentN: number): string[] {
  const all = Object.values(membersOf(group));
  const sorted = all
    .filter((m) => m && typeof m.id === 'string' && m.id !== '')
    .sort((a, b) => {
      const d = (Number(b.lastTs) || 0) - (Number(a.lastTs) || 0);
      return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const limit = scope === 'recent' ? clampRecentN(recentN) : MAX_MEMBERS;
  return sorted.slice(0, limit).map((m) => m.id);
}

/**
 * 算出「这次写完之后应当被移出记忆」的成员 id。
 *
 * 调用方在**写入新发言之后**调用它，拿到列表再 `delete members[id]`。
 * 为什么不在写入前算：新发言本身就改变了排序，写入前算会把刚说话的人当成要被淘汰的那个。
 *
 * `everyone` 档同样会淘汰（超过 `MAX_MEMBERS` 时），行为见 `MAX_MEMBERS` 注释。
 */
export function planMemberEviction(
  group: GroupMemory,
  scope: GroupScope,
  recentN: number,
): string[] {
  const keep = new Set(activeMembers(group, scope, recentN));
  return Object.keys(membersOf(group)).filter((id) => !keep.has(id));
}

/**
 * 记一次发言：更新成员桶的 `lastTs`/`name`，并把这条发言里的事实并进他的人设卡。
 *
 * 只抽**这个人自己说的话**（调用方保证传进来的 `text` 就是该发言者的原话）——
 * 宠物的话不能喂给 `extractFacts`，否则宠物自称「我叫哥伦比娅」会被抽成"用户叫哥伦比娅"。
 *
 * @returns 该成员的事实卡是否发生变化（调用方据此决定要不要写盘）
 */
export function touchMember(
  group: GroupMemory,
  senderId: string,
  senderName: string | undefined,
  text: string,
  now: number,
): { changed: boolean; factsAdded: number } {
  if (!senderId) return { changed: false, factsAdded: 0 };
  const members = membersOf(group);
  const prev = members[senderId];
  const existingFacts = prev && Array.isArray(prev.facts) ? prev.facts : [];
  const extracted = extractFacts(text);
  const merged = extracted.length > 0 ? mergeFacts(existingFacts, extracted, now) : null;
  const facts = merged ? pruneFacts(merged.facts, MAX_MEMBER_FACTS) : existingFacts;
  const name = senderName && senderName.trim() !== '' ? senderName.trim() : prev?.name;
  const next: GroupMember = {
    id: senderId,
    lastTs: now,
    ...(name !== undefined ? { name } : {}),
    ...(facts.length > 0 ? { facts } : {}),
  };
  const changed =
    prev === undefined ||
    prev.lastTs !== next.lastTs ||
    prev.name !== next.name ||
    JSON.stringify(prev.facts ?? []) !== JSON.stringify(next.facts ?? []);
  members[senderId] = next;
  return { changed, factsAdded: merged ? merged.facts.length : existingFacts.length };
}

/**
 * 从共享流里取出某个人说过的话（成轮：他问 + 宠物答）。
 *
 * 用途：回答「上次我跟你说过什么」这类问题。不做成常驻（那是 `range` 的事），
 * 只在需要时按 `sender` 过滤，避免给每个人的每句话都建索引。
 *
 * @param range 消息下标区间（左闭右开）；不传 = 全流
 */
export function messagesOf(
  group: GroupMemory,
  senderId: string,
  range?: { start: number; end: number },
): Array<{ ask: string; reply: string; index: number }> {
  const messages = Array.isArray(group.messages) ? group.messages : [];
  const start = Math.max(0, Math.floor(range?.start ?? 0));
  const end = Math.min(messages.length, Math.floor(range?.end ?? messages.length));
  const out: Array<{ ask: string; reply: string; index: number }> = [];
  for (let i = start; i < end; i += 1) {
    const m = messages[i];
    if (!m || m.role !== 'user' || m.sender !== senderId) continue;
    const next = messages[i + 1];
    const reply = next && next.role === 'assistant' ? next.content : '';
    out.push({ ask: m.content, reply, index: i });
  }
  return out;
}

/** 渲染时用的姓名：优先展示名，没有就用 id（绝不出现空串让人设里冒出「」） */
function displayName(member: GroupMember | undefined, senderId: string, fallbackName?: string): string {
  const n = member?.name ?? fallbackName;
  return n && n.trim() !== '' ? n.trim() : senderId;
}

/**
 * 拼群聊的 system 附加段（`memoryMode: 'group'` 时接到人设后面）。
 *
 * 这一段要解决的就一件事：**让宠物知道"现在跟谁说话、我记得他什么"**。
 * 所以顺序是：先点明当前说话人 → 再给关于他的事实 → 最后给个极简名册（群里还有谁）。
 *
 * 成本控制：当前说话人的事实卡约 78 token（实测单人模式同口径）；名册只列名字、上限 20 个。
 * 不把所有人的事实都塞进来——那是 200 倍的成本，而且没有用（这一轮只跟一个人说话）。
 *
 * @param currentSender 现在说话的这个人（没有则只给名册，用于"群里有人在聊但不是对我说"的场景）
 */
export function groupSection(
  group: GroupMemory,
  scope: GroupScope,
  recentN: number,
  currentSender?: { id: string; name?: string },
): string {
  const members = membersOf(group);
  const active = activeMembers(group, scope, recentN);

  // 名册：只列名字。全部成员都算进来会让「只记得 10 个人」这个设定穿帮——按活跃集列。
  const roster = active
    .filter((id) => id !== currentSender?.id)
    .slice(0, 20)
    .map((id) => displayName(members[id], id));

  const parts: string[] = [];

  if (currentSender && currentSender.id) {
    const me = members[currentSender.id];
    const name = displayName(me, currentSender.id, currentSender.name);
    const facts = me && Array.isArray(me.facts) ? me.facts : [];
    const known = facts.length > 0;
    parts.push(
      `现在跟你说话的是「${name}」。` +
        (known
          ? '你记得关于他的事：'
          : '你对他还没有任何印象（第一次见他，或者你已经不记得他了）——不要假装记得。'),
    );
    if (known) {
      // 复用单人模式的渲染，措辞完全一致（同一种事实不该有两套说法）
      const body = factsSectionInner(facts);
      if (body !== '') parts.push(body);
    }
  }

  if (roster.length > 0) {
    parts.push(`群里你认识的人还有：${roster.join('、')}。`);
  }

  parts.push(
    '这是群聊：你看到的是群里最近的对话，不要把它当成一对一的私聊；' +
      '不同人说的话要分开归属，别把甲的事安到乙头上。',
  );

  return '\n' + parts.join('\n') + '\n';
}

/** 内部复用：从 `./memory-facts` 的渲染结果里去掉外层换行，保持拼接可控 */
function factsSectionInner(facts: MemoryFact[]): string {
  const text = factsSection(facts);
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

/**
 * 群聊发言者 + 所在群（2026-10-30 加 `group`/`groupName`）。
 *
 * `group` 是**分桶键**（哪个群），`groupName` 只用于正文里的可读标注
 * （「（在「XX群」里说的）」）。两者分开是因为：群号会变（换群/迁移）而名字给人看，
 * 混用一个字段会让「改了群名」变成「认不出这是同一个群」。
 */
export interface Sender {
  id: string;
  name?: string;
  /** 群标识（QQ 群号）——记忆按它分桶 */
  group?: string;
  /** 群名（可读名字，只用于给模型看的标注） */
  groupName?: string;
}

/**
 * 解析 HTTP body 里的 `sender`：要么是字符串（只给 id），要么是 `{id, name, group, groupName}`。
 *
 * 宽容但**不猜**：id 为空/非字符串就当没带（返回 undefined），由调用侧按单人处理并记日志。
 * 不做「用 name 当 id」的兜底——那样同名的两个人会被并成一份记忆，比不认人更糟。
 */
export function parseSender(raw: unknown): Sender | undefined {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id === '' ? undefined : { id };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (id === '') return undefined;
    const name = typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : undefined;
    const group = typeof o.group === 'string' && o.group.trim() !== '' ? o.group.trim() : undefined;
    const groupName =
      typeof o.groupName === 'string' && o.groupName.trim() !== '' ? o.groupName.trim() : undefined;
    return {
      id,
      ...(name !== undefined ? { name } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(groupName !== undefined ? { groupName } : {}),
    };
  }
  return undefined;
}

/**
 * 造一条用户消息，**只在群聊模式带 sender**。
 *
 * 为什么单人模式不写：写了就是给老文件里每条消息多两个字段，所有 `deepEqual`
 * 断言的期望值都要跟着改，而它一点用都没有（单人模式没有第二个人，归属恒定）。
 * 「缺键 = 单人/未标注」是最准确的表达。
 *
 * 群聊里老消息（切模式之前攒的）没有 sender，检索/归属时按「不知道是谁说的」处理——
 * 这是诚实的结果：那些话确实没法可靠归到某个人头上，猜一个反而是造假。
 */
export function userMessageFor(
  text: string,
  ts: number,
  sender: { id: string; name?: string } | undefined,
  mode: 'single' | 'group',
): ChatMemoryMessage {
  if (mode !== 'group' || !sender || !sender.id) return { role: 'user', content: text, ts };
  const name = sender.name && sender.name.trim() !== '' ? sender.name.trim() : undefined;
  return {
    role: 'user',
    content: text,
    ts,
    sender: sender.id,
    ...(name !== undefined ? { senderName: name } : {}),
  };
}

/**
 * 取（或新建）一个群的记忆流（2026-10-30，任务1「单人/群聊并存」）。
 * 为什么要按群分开：用户原话「单人是单人，群聊是群聊，单人是对一个人的陪伴，群聊是Q群机器人」。
 * 一个群里的聊天不该污染一对一的上下文——否则主人在群里说了句话，回桌面聊时桌宠会
 * 带上整个群的气氛。所以每个群号一份独立的消息流 + 摘要 + 成员桶。
 *
 * 结构坏了（数组/标量/没有 messages 数组）一律按空记忆重建，并记 error——
 * 静默吞掉会让用户以为「聊天记录全没了」，至少日志里要能查到。
 */
export function groupOf(
  entry: { groups?: Record<string, GroupMemory> },
  groupId: string,
  log?: { error: (msg: string) => void },
): GroupMemory {
  if (!entry.groups || typeof entry.groups !== 'object' || Array.isArray(entry.groups)) {
    entry.groups = {};
  }
  const bucket = entry.groups;
  const existing = bucket[groupId];
  if (existing !== undefined && (!existing || !Array.isArray(existing.messages))) {
    log?.error(`[dsh-pet] 群记忆结构异常（messages 不是数组）group=${groupId}，按新群处理`);
  }
  if (!existing || !Array.isArray(existing.messages)) {
    bucket[groupId] = { messages: [] };
  }
  return bucket[groupId];
}

/**
 * 判断这次发言要不要镜像进单人流（2026-10-30，修「主人在群里说完回桌面桌宠不记得」）。
 *
 * 三个条件全满足才镜像：① 群机器人开着 ② 主人同步开着 ③ 说话的人就是主人（QQ 号相等）。
 *
 * 为什么必须限定「主人」：群里别人说的话进单人流，就等于把陌生人的话当成一对一私聊的
 * 上下文——那正是用户要分开的东西。只有主人是「同一个人在两处说话」，镜像才成立。
 */
export function shouldMirrorOwner(
  conf: Record<string, unknown>,
  senderId: string | undefined,
): boolean {
  if (conf.groupBotEnabled !== true) return false;
  if (conf.ownerSyncEnabled !== true) return false;
  const owner = typeof conf.ownerQq === 'string' ? conf.ownerQq.trim() : '';
  if (owner === '' || !senderId) return false;
  return owner === senderId.trim();
}

/**
 * 把主人在群里的发言包装成单人流里的一条用户消息。
 *
 * 为什么在正文里加「（在「XX群」里说的）」而不是只加一个 `origin` 字段：
 * 模型只看得到 role + content，字段它看不见。用户的原话要求「这里需要标注是在哪个群里的
 * 互动」——只有写进正文，桌宠回桌面聊时才会知道「这句话是刚才在群里说的」，而不是把它
 * 当成桌面上刚说的话。`origin` 仍然写一份给程序看（统计/排查/将来做按群过滤）。
 */
export function ownerMirrorMessage(
  text: string,
  ts: number,
  groupName: string | undefined,
): ChatMemoryMessage {
  const g = groupName && groupName.trim() !== '' ? groupName.trim() : '';
  const head = g === '' ? '（在群里说的）' : `（在「${g}」里说的）`;
  return { role: 'user', content: `${head}${text}`, ts, origin: g === '' ? 'group' : g };
}

