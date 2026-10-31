/**
 * 群聊记忆（`src/host/memory-group.ts`）的单元测试。
 *
 * 这里钉的都是**语义**，不是实现细节：
 *   1. 「只记得最近 N 个人」的 N 真的是 N（第 N+1 个人开口，最久没说话的那位被移出）
 *   2. 刚说话的人**不会**被当成要被淘汰的那个（淘汰必须排在 touch 之后）
 *   3. 群聊段里绝不出现「第一次见」却有事实、或「记得」却空卡这类自相矛盾的话
 *   4. 名册不泄漏被淘汰的人（否则「只记得 10 个人」这个设定当场穿帮）
 *   5. 单人模式（`scope` 无关）不产生 members 键
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MEMBERS,
  activeMembers,
  clampRecentN,
  groupOf,
  groupSection,
  membersOf,
  messagesOf,
  normalizeScope,
  ownerMirrorMessage,
  parseSender,
  planMemberEviction,
  shouldMirrorOwner,
  touchMember,
  userMessageFor,
  type GroupMemory,
} from './memory-group';

const mk = (): GroupMemory => ({ messages: [] });

test('clampRecentN 规整到 [1,100],非法值回落默认', () => {
  assert.equal(clampRecentN(10), 10);
  assert.equal(clampRecentN(0), 1, '0 夹到下限 1（不能"记得 0 个人"）');
  assert.equal(clampRecentN(-5), 1);
  assert.equal(clampRecentN(999), 100);
  assert.equal(clampRecentN(7.9), 7, '小数向下取整');
  assert.equal(clampRecentN('12'), 12, '数字字符串也认（HTTP query 常是字符串）');
  assert.equal(clampRecentN(undefined), 10, '缺省 10');
  assert.equal(clampRecentN('abc'), 10);
  assert.equal(clampRecentN(null), 10);
  assert.equal(clampRecentN(3, 5), 3, '自定义 fallback 不影响合法值');
});

test('normalizeScope:非法值回落 everyone（宁可多记不可误忘）', () => {
  assert.equal(normalizeScope('recent'), 'recent');
  assert.equal(normalizeScope('everyone'), 'everyone');
  assert.equal(normalizeScope('RECENT'), 'everyone', '大小写不宽容');
  assert.equal(normalizeScope(undefined), 'everyone');
  assert.equal(normalizeScope(123), 'everyone');
});

test('membersOf 对坏结构重建空对象（不抛、不返回数组）', () => {
  // 故意把 members 写坏成数组：成员表在磁盘上被手改成别的形状时不能抛异常。
  // 交叉类型收窄不到 unknown，所以走两次断言（只为了能塞进去这个非法值）
  const g = mk();
  (g as unknown as { members: unknown }).members = [1, 2, 3];
  const m = membersOf(g);
  assert.deepEqual(m, {});
  assert.equal(Array.isArray(m), false);
});

test('touchMember 建桶、更新 lastTs、抽事实', () => {
  const g = mk();
  const r1 = touchMember(g, 'u1', '张三', '我住在杭州。', 1000);
  assert.equal(r1.changed, true);
  const m = membersOf(g);
  assert.equal(m.u1.id, 'u1');
  assert.equal(m.u1.name, '张三');
  assert.equal(m.u1.lastTs, 1000);
  assert.ok((m.u1.facts ?? []).some((f) => f.value === '杭州'));

  // 同一秒内再说一句不含事实的话：lastTs 变了，facts 不变
  const r2 = touchMember(g, 'u1', '张三', '今天天气不错。', 2000);
  assert.equal(r2.changed, true, 'lastTs 变化也算 changed');
  assert.equal(membersOf(g).u1.lastTs, 2000);
});

test('touchMember 空 id 直接返回,不建桶', () => {
  const g = mk();
  const r = touchMember(g, '', '无名', '我住在杭州。', 1000);
  assert.equal(r.changed, false);
  assert.deepEqual(membersOf(g), {}, '空 id 不该凭空造出一个成员');
});

test('touchMember 改名跟着变,但不保留历史名字', () => {
  const g = mk();
  touchMember(g, 'u1', '张三', '你好', 1000);
  touchMember(g, 'u1', '张三阿', '你好', 2000);
  assert.equal(membersOf(g).u1.name, '张三阿');
  // 传空名字时保留旧名（不把名字抹成 undefined）
  touchMember(g, 'u1', '', '你好', 3000);
  assert.equal(membersOf(g).u1.name, '张三阿');
});

test('activeMembers 按 lastTs 降序;同毫秒用 id 兜底保证稳定', () => {
  const g = mk();
  touchMember(g, 'b', undefined, 'x', 1000);
  touchMember(g, 'a', undefined, 'x', 1000);
  touchMember(g, 'c', undefined, 'x', 3000);
  const order = activeMembers(g, 'everyone', 10);
  assert.deepEqual(order, ['c', 'a', 'b'], 'c 最新；a/b 同毫秒按 id 字典序');
});

test('activeMembers recent 档真的只留最近 N 个', () => {
  const g = mk();
  for (let i = 1; i <= 5; i += 1) touchMember(g, `u${i}`, undefined, 'x', i * 1000);
  assert.deepEqual(activeMembers(g, 'recent', 3), ['u5', 'u4', 'u3']);
  assert.equal(activeMembers(g, 'everyone', 3).length, 5, 'everyone 档不吃 N');
});

test('planMemberEviction:recent 档第 N+1 人开口,最久没说话的被挤出', () => {
  const g = mk();
  for (let i = 1; i <= 3; i += 1) touchMember(g, `u${i}`, undefined, 'x', i * 1000);
  // u4 开口（recent N=3）→ 应当挤出 u1（lastTs 最小，且不是刚说话的 u4）
  touchMember(g, 'u4', undefined, 'x', 4000);
  const evict = planMemberEviction(g, 'recent', 3);
  assert.deepEqual(evict, ['u1']);
  assert.deepEqual(activeMembers(g, 'recent', 3), ['u4', 'u3', 'u2']);
});

test('planMemberEviction:刚说话的人绝不会被选中（淘汰排在 touch 之后）', () => {
  const g = mk();
  touchMember(g, 'u1', undefined, 'x', 1000);
  touchMember(g, 'u2', undefined, 'x', 2000);
  // 若在 touch 之前算淘汰，u1（当时最旧）会被删；touch 之后 u1 变成最新之一
  touchMember(g, 'u1', undefined, 'x', 3000);
  const evict = planMemberEviction(g, 'recent', 2);
  assert.deepEqual(evict, [], 'N=2、只有 2 个人，一个都不淘汰');
});

test('planMemberEviction:everyone 档只在超过 MAX_MEMBERS 时淘汰', () => {
  const g = mk();
  const over = MAX_MEMBERS + 2;
  for (let i = 0; i < over; i += 1) touchMember(g, `u${i}`, undefined, 'x', (i + 1) * 1000);
  const evict = planMemberEviction(g, 'everyone', 10);
  assert.equal(evict.length, 2, '超出的 2 个被淘汰（N 在 everyone 档不生效）');
  assert.deepEqual(evict.toSorted(), ['u0', 'u1']);
});

test('messagesOf 只取某个人的成轮对话', () => {
  const g: GroupMemory = {
    messages: [
      { role: 'user', content: '我住杭州', ts: 1, sender: 'u1' },
      { role: 'assistant', content: '杭州好地方', ts: 1 },
      { role: 'user', content: '我也住杭州', ts: 2, sender: 'u2' },
      { role: 'assistant', content: '那你们是邻居', ts: 2 },
      { role: 'user', content: '是啊', ts: 3, sender: 'u1' },
      { role: 'assistant', content: '真巧', ts: 3 },
    ],
  };
  const mine = messagesOf(g, 'u1');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].ask, '我住杭州');
  assert.equal(mine[0].reply, '杭州好地方');
  assert.equal(mine[1].index, 4);
});

test('messagesOf 支持 range 左闭右开;半轮保留 reply 为空串', () => {
  const g: GroupMemory = {
    messages: [
      { role: 'user', content: 'a', ts: 1, sender: 'u1' },
      { role: 'assistant', content: 'A', ts: 1 },
      { role: 'user', content: 'b', ts: 2, sender: 'u1' },
    ],
  };
  assert.equal(messagesOf(g, 'u1', { start: 0, end: 2 }).length, 1);
  const tail = messagesOf(g, 'u1', { start: 2, end: 3 });
  assert.equal(tail.length, 1);
  assert.equal(tail[0].reply, '', '半轮不编造回复');
});

test('groupSection:第一次见的人明确说"没有印象,不要假装记得"', () => {
  const g = mk();
  const s = groupSection(g, 'everyone', 10, { id: 'u1', name: '张三' });
  assert.ok(s.includes('张三'));
  assert.ok(s.includes('没有任何印象'), '必须有这句，否则模型会瞎编');
  assert.ok(s.includes('不要假装记得'));
});

test('groupSection:认识的人给出事实卡,且复用单人模式渲染', () => {
  const g = mk();
  touchMember(g, 'u1', '张三', '我住在杭州。我喜欢喝无糖豆浆。', 1000);
  const s = groupSection(g, 'everyone', 10, { id: 'u1', name: '张三' });
  assert.ok(s.includes('你记得关于他的事'));
  assert.ok(s.includes('杭州'));
  assert.ok(s.includes('无糖豆浆'));
  assert.ok(!s.includes('没有任何印象'), '认识的人不该出现"没有印象"');
});

test('groupSection:名册只列活跃集,被淘汰的人不出现（防穿帮）', () => {
  const g = mk();
  touchMember(g, 'old', '老张', 'x', 1000);
  for (let i = 1; i <= 3; i += 1) touchMember(g, `u${i}`, `人${i}`, 'x', (i + 1) * 1000);
  // recent N=3 时 old 不在活跃集
  const s = groupSection(g, 'recent', 3, { id: 'u3', name: '人3' });
  // 只看名册那一行：当前说话人会出现在「现在跟你说话的是……」，那不算名册
  const rosterLine = s.split('\n').find((l) => l.includes('群里你认识的人还有')) ?? '';
  assert.ok(!s.includes('老张'), '被挤出记忆的人不该还在名册里');
  assert.ok(rosterLine.includes('人1') && rosterLine.includes('人2'));
  assert.ok(!rosterLine.includes('人3'), '名册不列当前说话人自己');
});

test('groupSection:没有当前说话人时只给名册,不给"你记得他什么"', () => {
  const g = mk();
  touchMember(g, 'u1', '张三', '我住在杭州', 1000);
  const s = groupSection(g, 'everyone', 10);
  assert.ok(!s.includes('现在跟你说话的是'));
  assert.ok(s.includes('群里你认识的人还有'));
});

test('groupSection:永远带上"这是群聊"的防串台提示', () => {
  const g = mk();
  const s1 = groupSection(g, 'everyone', 10, { id: 'u1' });
  const s2 = groupSection(g, 'recent', 5);
  for (const s of [s1, s2]) {
    assert.ok(s.includes('这是群聊'));
    assert.ok(s.includes('别把甲的事安到乙头上'));
  }
});

test('groupSection:名字为空时用 id 兜底,不出现空引号', () => {
  const g = mk();
  touchMember(g, 'u1', undefined, 'x', 1000);
  const s = groupSection(g, 'everyone', 10, { id: 'u1' });
  assert.ok(s.includes('「u1」'));
  assert.ok(!s.includes('「」'));
});

test('groupSection 以换行开头结尾（拼接时与前后段自然分隔）', () => {
  const g = mk();
  const s = groupSection(g, 'everyone', 10, { id: 'u1' });
  assert.ok(s.startsWith('\n'));
  assert.ok(s.endsWith('\n'));
});

// ── parseSender：宽容但不猜 ──────────────────────────────────────────

test('parseSender:字符串当成只有 id', () => {
  assert.deepEqual(parseSender('qq:1001'), { id: 'qq:1001' });
  assert.deepEqual(parseSender('  qq:1001  '), { id: 'qq:1001' }, '两端空白被裁');
});

test('parseSender:对象带 name', () => {
  assert.deepEqual(parseSender({ id: 'qq:1001', name: '张三' }), { id: 'qq:1001', name: '张三' });
  assert.deepEqual(parseSender({ id: 'qq:1001', name: '  ' }), { id: 'qq:1001' }, '空白名字当没有');
  assert.deepEqual(parseSender({ id: 'qq:1001' }), { id: 'qq:1001' });
});

test('parseSender:非法输入一律 undefined（绝不猜身份）', () => {
  assert.equal(parseSender(undefined), undefined);
  assert.equal(parseSender(null), undefined);
  assert.equal(parseSender(''), undefined);
  assert.equal(parseSender('   '), undefined);
  assert.equal(parseSender({}), undefined);
  assert.equal(parseSender({ id: '' }), undefined);
  assert.equal(parseSender({ id: 123 }), undefined, '数字 id 不当成字符串用');
  assert.equal(parseSender({ name: '张三' }), undefined, '只有名字没有 id → 不能用名字当 id（同名会并桶）');
  assert.equal(parseSender([1, 2]), undefined, '数组不是 sender');
  assert.equal(parseSender(42), undefined);
});

// ── userMessageFor：单人模式一个字段都不多加 ────────────────────────

test('userMessageFor:单人模式不带 sender（老文件形状不变）', () => {
  const m = userMessageFor('你好', 1000, { id: 'u1', name: '张三' }, 'single');
  assert.deepEqual(m, { role: 'user', content: '你好', ts: 1000 });
  assert.equal('sender' in m, false, '单人模式绝不能多出 sender 键');
});

test('userMessageFor:群聊模式带 sender 与 senderName', () => {
  const m = userMessageFor('你好', 1000, { id: 'u1', name: '张三' }, 'group');
  assert.deepEqual(m, { role: 'user', content: '你好', ts: 1000, sender: 'u1', senderName: '张三' });
});

test('userMessageFor:群聊模式没给 name 时不写 senderName 键', () => {
  const m = userMessageFor('你好', 1000, { id: 'u1' }, 'group');
  assert.equal('senderName' in m, false);
  assert.equal(m.sender, 'u1');
});

test('userMessageFor:群聊模式没给 sender → 退回单人形状（不编造身份）', () => {
  const m = userMessageFor('你好', 1000, undefined, 'group');
  assert.deepEqual(m, { role: 'user', content: '你好', ts: 1000 });
});

// ── parseSender 的 group / groupName（2026-10-30 任务1 新增）────────────

test('parseSender:群号与群名分别解析，不混用', () => {
  const s = parseSender({ id: 'qq:1001', group: '700123456', groupName: '须弥茶话会' });
  assert.deepEqual(s, { id: 'qq:1001', group: '700123456', groupName: '须弥茶话会' });
});

test('parseSender:群号/群名两端空白被裁，空串当没有', () => {
  assert.deepEqual(parseSender({ id: 'u1', group: '  700  ', groupName: '  ' }), { id: 'u1', group: '700' });
  assert.deepEqual(parseSender({ id: 'u1', group: '', groupName: '' }), { id: 'u1' });
});

// ── groupOf：按群分桶（2026-10-30 任务1 新增）───────────────────────────

test('groupOf:同一个群取回同一条记忆流', () => {
  const entry: { groups?: Record<string, GroupMemory> } = {};
  const a = groupOf(entry, '700');
  a.messages.push({ role: 'user', content: '群里的第一句', ts: 1 });
  const b = groupOf(entry, '700');
  assert.equal(b, a, '第二次取必须是同一个对象，不是重建');
  assert.equal(b.messages.length, 1);
});

test('groupOf:不同群互不干扰（换了群不串味）', () => {
  const entry: { groups?: Record<string, GroupMemory> } = {};
  groupOf(entry, '700').messages.push({ role: 'user', content: 'A 群的话', ts: 1 });
  const g2 = groupOf(entry, '800');
  assert.equal(g2.messages.length, 0, 'B 群看不到 A 群的话');
  assert.deepEqual(Object.keys(entry.groups ?? {}).sort(), ['700', '800']);
});

test('groupOf:结构坏掉时重建为空记忆并报错，不静默炸', () => {
  const bad = { groups: { '700': [1, 2, 3] as unknown as GroupMemory } };
  const errs: string[] = [];
  const g = groupOf(bad, '700', { error: (m) => errs.push(m) });
  assert.deepEqual(g.messages, []);
  assert.equal(errs.length, 1, '必须报一条错误——静默吞掉会让用户以为记录全丢了');
});

test('groupOf:没有 groups 键时自建，不打爆原对象', () => {
  const entry: { groups?: Record<string, GroupMemory> } = {};
  const g = groupOf(entry, 'default');
  assert.ok(entry.groups, 'groups 容器被建出来');
  assert.ok(entry.groups!['default']);
  assert.equal(g, entry.groups!['default']);
});

// ── shouldMirrorOwner：三条件全满足才镜像 ──────────────────────────────

test('shouldMirrorOwner:群聊开 + 记住主人开 + QQ 号对上 → 镜像', () => {
  const conf = { groupBotEnabled: true, ownerSyncEnabled: true, ownerQq: '10001' };
  assert.equal(shouldMirrorOwner(conf, '10001'), true);
  assert.equal(shouldMirrorOwner(conf, ' 10001 '), true, '两端空白不影响判定');
});

test('shouldMirrorOwner:任一条件不满足都不镜像', () => {
  const base = { groupBotEnabled: true, ownerSyncEnabled: true, ownerQq: '10001' };
  assert.equal(shouldMirrorOwner({ ...base, groupBotEnabled: false }, '10001'), false);
  assert.equal(shouldMirrorOwner({ ...base, ownerSyncEnabled: false }, '10001'), false);
  assert.equal(shouldMirrorOwner({ ...base, ownerQq: '' }, '10001'), false, '没填 QQ 号不能拿"空"当通配');
  assert.equal(shouldMirrorOwner(base, '20002'), false, '群里别人的话绝不进单人流');
  assert.equal(shouldMirrorOwner(base, undefined), false);
  assert.equal(shouldMirrorOwner({}, '10001'), false, '缺键一律不镜像（默认关）');
});

test('shouldMirrorOwner:ownerQq 不是字符串时不镜像（不隐式转数字）', () => {
  const conf = { groupBotEnabled: true, ownerSyncEnabled: true, ownerQq: 10001 };
  assert.equal(shouldMirrorOwner(conf, '10001'), false);
});

// ── ownerMirrorMessage：正文必须带群名标注 ─────────────────────────────

test('ownerMirrorMessage:正文前置群名标注（模型只看正文，看不到字段）', () => {
  const m = ownerMirrorMessage('今天好累', 5000, '须弥茶话会');
  assert.equal(m.role, 'user');
  assert.equal(m.content, '（在「须弥茶话会」里说的）今天好累');
  assert.equal(m.ts, 5000);
  assert.equal(m.origin, '须弥茶话会');
});

test('ownerMirrorMessage:没有群名时写"群里"，不写空引号', () => {
  const m = ownerMirrorMessage('今天好累', 5000, undefined);
  assert.equal(m.content, '（在群里说的）今天好累');
  assert.equal(m.origin, 'group');
});

test('ownerMirrorMessage:不带 sender 字段（这是单人流的消息，不是群消息）', () => {
  const m = ownerMirrorMessage('今天好累', 5000, '须弥茶话会');
  assert.equal('sender' in m, false, '带上 sender 会被群聊过滤当成群消息，进不了单人流');
});

test('ownerMirrorMessage:origin 缺群名时是 "group"（缺键=本窗口正常对话，不能跟它混淆）', () => {
  const m = ownerMirrorMessage('今天好累', 5000, '  ');
  assert.equal(m.origin, 'group', '空白群名不能当成名字，但 origin 仍要标出"这条来自群"');
  assert.equal(m.content, '（在群里说的）今天好累');
});
