import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendMessages, newMessageId, sanitizeCandidate } from './sync-append';
import type { ChatMemoryEntry } from './memory-summary';

/**
 * 钉住「回家合并」的三条不变量（2026-11-01，用户拍板）：
 *   ① 只追加、按编号去重（幂等）：手机网络抖一下就重传很常见；
 *   ② 绝不碰派生状态（summary / facts / summarized / summaryTs / factsUpto）——
 *      派生状态只有一个作者（电脑），手机离线期间不许压缩；
 *   ③ 坏数据丢弃，不把 undefined / NaN 写进记忆。
 */

function entry(messages: ChatMemoryEntry['messages'] = []): ChatMemoryEntry {
  return { messages };
}

test('空流追加两条：按 ts 排序进入末尾，返回 added=2', () => {
  const e = entry();
  const r = appendMessages(e, [
    { id: 'b', role: 'assistant', content: '第二句', ts: 2000 },
    { id: 'a', role: 'user', content: '第一句', ts: 1000 },
  ]);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 0);
  assert.equal(r.dropped, 0);
  assert.deepEqual(
    e.messages.map((m) => m.content),
    ['第一句', '第二句'],
  );
  assert.deepEqual(
    e.messages.map((m) => m.id),
    ['a', 'b'],
  );
});

test('★ 按编号去重：同一条传两遍只进一条（重试幂等）', () => {
  const e = entry();
  const one = [{ id: 'x', role: 'user', content: '出门前那句', ts: 1000 }];
  const r1 = appendMessages(e, one);
  const r2 = appendMessages(e, one);
  assert.equal(r1.added, 1);
  assert.equal(r2.added, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(e.messages.length, 1, '重复上传不能让记忆变长');
});

test('★ 只追加：已有消息的顺序与内容一个字都不动', () => {
  const e = entry([
    { role: 'user', content: '电脑上的旧话', ts: 100, id: 'old-1' },
    { role: 'assistant', content: '电脑上的旧回答', ts: 200, id: 'old-2' },
  ]);
  appendMessages(e, [{ id: 'new-1', role: 'user', content: '手机上的新话', ts: 300 }]);
  assert.deepEqual(
    e.messages.map((m) => m.content),
    ['电脑上的旧话', '电脑上的旧回答', '手机上的新话'],
  );
});

test('★ 派生状态绝不动（摘要/事实卡/进度只有电脑能写）', () => {
  const e: ChatMemoryEntry = {
    messages: [{ role: 'user', content: '旧', ts: 100, id: 'a' }],
    summary: '电脑算出来的摘要',
    summarized: 1,
    summaryTs: 12_345,
    facts: [{ kind: 'preference', key: 'like:安静', value: '主人喜欢安静', firstTs: 1, lastTs: 1 }],
    factsUpto: 1,
  };
  appendMessages(e, [{ id: 'b', role: 'user', content: '新增一句', ts: 200 }]);
  assert.equal(e.summary, '电脑算出来的摘要');
  assert.equal(e.summarized, 1);
  assert.equal(e.summaryTs, 12_345);
  assert.equal(e.factsUpto, 1);
  assert.equal(e.facts?.length, 1);
});

test('坏数据一律丢弃：缺编号 / 空内容 / 时间非法 / 角色非法 / 非对象', () => {
  const e = entry();
  const r = appendMessages(e, [
    { id: '', role: 'user', content: '无编号', ts: 1 },
    { id: 'no-content', role: 'user', content: '', ts: 2 },
    { id: 'bad-ts', role: 'user', content: '时间非法', ts: Number.NaN },
    { id: 'zero-ts', role: 'user', content: '时间 0', ts: 0 },
    { id: 'sys', role: 'system', content: 'system 不属于对话记录', ts: 3 },
    { id: 'bad-role', role: 'tool', content: 'x', ts: 4 },
    null,
    'str',
    42,
    { id: 'good', role: 'user', content: '这条该留下', ts: 5 },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.dropped, 9);
  assert.deepEqual(
    e.messages.map((m) => m.id),
    ['good'],
  );
});

test('原样保留 origin / sender / senderName（群里说话的人不能丢）', () => {
  const e = entry();
  appendMessages(e, [
    { id: 'g1', role: 'user', content: '群里说的', ts: 10, origin: 'proactive', sender: 'u1', senderName: '小明' },
  ]);
  const m = e.messages[0];
  assert.equal(m.origin, 'proactive');
  assert.equal(m.sender, 'u1');
  assert.equal(m.senderName, '小明');
});

test('缺省字段不写空键（避免 json 里出现 origin:undefined 的脏形状）', () => {
  const e = entry();
  appendMessages(e, [{ id: 'p1', role: 'assistant', content: '她说', ts: 10 }]);
  assert.deepEqual(Object.keys(e.messages[0]).sort(), ['content', 'id', 'role', 'ts']);
});

test('sanitizeCandidate 单独用也对（路由层先粗筛时同一个口径）', () => {
  assert.equal(sanitizeCandidate(null), undefined);
  assert.equal(sanitizeCandidate({ id: 'a', role: 'user', content: 'x', ts: 1 })?.id, 'a');
  assert.equal(sanitizeCandidate({ id: 'a', role: 'user', content: 'x', ts: 1 })?.role, 'user');
  assert.equal(sanitizeCandidate({ id: '  ', role: 'user', content: 'x', ts: 1 }), undefined);
});

test('newMessageId：带宠物名与时间，且两次不同序号不同号（手机离线也能自己编号）', () => {
  const a = newMessageId('columbina1', 1_700_000_000_000, 0);
  const b = newMessageId('columbina1', 1_700_000_000_000, 1);
  assert.match(a, /^m-columbina1-[0-9a-z]+-q[0-9a-z]+$/);
  assert.notEqual(a, b);
  // 宠物名里的怪字符被清掉，不会拼出非法编号
  assert.match(newMessageId('纳西妲 1', 1, 0), /^m-1-[0-9a-z]+-q[0-9a-z]+$/);
});
