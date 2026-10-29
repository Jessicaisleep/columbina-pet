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
  groupSection,
  membersOf,
  messagesOf,
  normalizeScope,
  parseSender,
  planMemberEviction,
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
  const g = mk() as GroupMemory & { members: unknown };
  g.members = [1, 2, 3];
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
