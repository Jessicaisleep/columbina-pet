/**
 * 群聊记忆的**说话人归属**（2026-10-30 修）——三处洞的回归测试。
 *
 * 为什么单独一个文件：这三处都是「单人模式完全正常、群聊才暴露」的缺陷，
 * 而全量测试此前全绿，说明没人从群聊角度看过。钉死的是**语义**：
 *
 *   1. 群级事实卡不能跨人混合 —— `mergeFacts` 按 `kind|key` 覆盖，
 *      张三「住杭州」会被李四「住北京」顶掉；这份东西若以「关于对方的事实」
 *      的抬头进 prompt，就和每人一份的 `members[id].facts` 直接打架。
 *   2. 回填的往事必须标真人名 —— 写死「主人说」会让模型把张三的话记成主人说的。
 *   3. 摘要提示词里的 user 行也必须标真人名 —— 理由同上，而且这份摘要常驻。
 *
 * 单人模式的既有行为**一个字节都不能变**（缺 `senderName` 就退回「主人」/「用户」），
 * 所以每个断言都配了单人的对照。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docsOf, recallSection, traceSection } from './memory-retrieval';
import { buildSummaryUserText, renderTranscript } from './memory-summary';
import { touchMember } from './memory-group';
import type { ChatMemoryMessage } from './chat';

const T0 = new Date(2026, 9, 30, 10, 0, 0, 0).getTime();

/* ------------------------------------------------------------------ *
 * 1. 回填渲染：群聊用真名，单人仍写「主人」
 * ------------------------------------------------------------------ */

test('recallSection:群聊往事标真人名，不写死「主人说」', () => {
  const docs = docsOf([
    { role: 'user', content: '我住在杭州', ts: T0, senderName: '张三' },
    { role: 'assistant', content: '杭州好呀', ts: T0 },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].senderName, '张三', 'docsOf 必须把 senderName 透传下来');

  const out = recallSection([{ doc: docs[0], score: 1 }], { now: new Date(T0) });
  assert.ok(out.includes('张三说：我住在杭州'), '群里张三的话必须标张三：' + out);
  assert.ok(!out.includes('主人说：我住在杭州'), '绝不能说成主人说的：' + out);
  assert.ok(out.includes('你说：杭州好呀'), '宠物自己那句仍是「你说」');
});

test('recallSection:单人模式（无 senderName）仍写「主人说」——既有行为逐字不变', () => {
  const docs = docsOf([
    { role: 'user', content: '我住在杭州', ts: T0 },
    { role: 'assistant', content: '', ts: T0 },
  ]);
  const out = recallSection([{ doc: docs[0], score: 1 }], { now: new Date(T0) });
  assert.ok(out.includes('主人说：我住在杭州'), out);
});

test('traceSection:群里那一天的样子同样标真人名', () => {
  const docs = docsOf([
    { role: 'user', content: '今天天气不错', ts: T0, senderName: '李四' },
    { role: 'assistant', content: '对呀', ts: T0 },
    { role: 'user', content: '我明天考试', ts: T0 + 60_000, senderName: '王五' },
    { role: 'assistant', content: '加油', ts: T0 + 60_000 },
  ]);
  assert.equal(docs.length, 2);
  const out = traceSection(docs, '昨天', { now: new Date(T0) });
  assert.ok(out.includes('李四说：今天天气不错'), out);
  assert.ok(out.includes('王五说：我明天考试'), out);
  assert.ok(!out.includes('主人说：'), '群里不该出现「主人说」：' + out);
});

test('docsOf:senderName 为空串/空白时不落字段（避免渲染出「说：」）', () => {
  const docs = docsOf([
    { role: 'user', content: '嗯', ts: T0, senderName: '   ' },
    { role: 'assistant', content: '', ts: T0 },
  ]);
  assert.equal(docs[0].senderName, undefined);
  const out = recallSection([{ doc: docs[0], score: 1 }], { now: new Date(T0) });
  assert.ok(out.includes('主人说：嗯'), '空白名按单人兜底：' + out);
});

/* ------------------------------------------------------------------ *
 * 2. 摘要渲染：群聊用真名，单人仍写「用户」
 * ------------------------------------------------------------------ */

test('renderTranscript:群聊 user 行标真人名，assistant 仍是「宠物」', () => {
  const chunk: ChatMemoryMessage[] = [
    { role: 'user', content: '我住在杭州', ts: T0, sender: 'u1', senderName: '张三' },
    { role: 'assistant', content: '杭州好呀', ts: T0 },
    { role: 'user', content: '我住在北京', ts: T0 + 1000, sender: 'u2', senderName: '李四' },
  ];
  const text = renderTranscript(chunk);
  assert.equal(text, '张三：我住在杭州\n宠物：杭州好呀\n李四：我住在北京');
  assert.ok(!text.includes('用户：'), '群里不该把所有人当成「用户」：' + text);
});

test('renderTranscript:单人消息没有 senderName 时仍是「用户：」（既有断言不变）', () => {
  const text = renderTranscript([
    { role: 'user', content: '你好', ts: T0 },
    { role: 'assistant', content: '在的', ts: T0 },
  ]);
  assert.equal(text, '用户：你好\n宠物：在的');
});

test('摘要提示词要求把群聊里的事归到具体人头上', () => {
  const text = buildSummaryUserText('', [{ role: 'user', content: '我住杭州', ts: T0, senderName: '张三' }]);
  // user 正文里带真名
  assert.ok(text.includes('张三：我住杭州'), text);
  // 而归属规则写在 system 里——这里只钉住「正文不再一律叫用户」这一半，
  // system 那一半由下面的常量断言兜住。
});

test('SUMMARY_SYSTEM_PROMPT 明确禁止把别人的事写成「用户」的事', async () => {
  const { SUMMARY_SYSTEM_PROMPT } = await import('./memory-summary');
  assert.ok(SUMMARY_SYSTEM_PROMPT.includes('绝不能把某个人的事写成"用户"的事'), SUMMARY_SYSTEM_PROMPT);
});

/* ------------------------------------------------------------------ *
 * 3. 群级事实卡：不再跨人混合（touchMember 只写成员桶）
 * ------------------------------------------------------------------ */

test('touchMember:每人一份事实卡，张三的事不会出现在李四的卡里', () => {
  const group: Parameters<typeof touchMember>[0] = { messages: [] } as never;
  // 用真实数据里的原句（`memory-facts.ts` 顶部注释举的就是这一句）。
  // 注意规则要求「我养了<一只|一个|一只小>？<物种>」，「养了只猫」少一个「一」匹配不上——
  // 这是规则自己的边界，不在本文件的钉测范围内。
  touchMember(group, 'u1', '张三', '我住在杭州，我养了一只猫叫团子', T0);
  touchMember(group, 'u2', '李四', '我住在北京', T0 + 1000);

  const raw = group as unknown as Record<string, unknown>;
  assert.equal(raw.facts, undefined, '群级条目上不该有 facts（跨人混合的那份已废弃）');

  const members = raw.members as Record<string, { facts?: Array<{ key: string; value: string }> }>;
  const zhang = members.u1.facts ?? [];
  const li = members.u2.facts ?? [];
  const val = (list: Array<{ key: string; value: string }>, key: string) => list.find((f) => f.key === key)?.value;

  assert.equal(val(zhang, 'city'), '杭州', '张三的 city 必须是杭州：' + JSON.stringify(zhang));
  assert.equal(val(li, 'city'), '北京', '李四的 city 必须是北京：' + JSON.stringify(li));
  // pet 的取值是「物种·名字」（见 memory-facts.ts 的 pet 规则：渲染时再拼成
  // 「养了一只猫，叫团子」），不是光一个名字。
  assert.equal(val(zhang, 'pet'), '猫·团子', '张三的猫不能跑到李四身上');
  assert.equal(val(li, 'pet'), undefined, '李四没有猫');
});

test('touchMember:顺手清掉旧版本残留在群级条目上的 facts 键', () => {
  // 模拟旧数据：群级条目上被 learnFacts 写过一份跨人混合的 facts
  const group = {
    messages: [],
    facts: [{ kind: 'identity', key: 'city', value: '北京', lastTs: T0, hits: 1 }],
  } as unknown as Parameters<typeof touchMember>[0];
  touchMember(group, 'u1', '张三', '我住在杭州', T0 + 1000);

  const raw = group as unknown as Record<string, unknown>;
  assert.equal(raw.facts, undefined, '残留的群级 facts 必须被删掉，否则它会一直被导出带走');
  const members = raw.members as Record<string, { facts?: Array<{ key: string; value: string }> }>;
  assert.equal(members.u1.facts?.find((f) => f.key === 'city')?.value, '杭州', '本人那份照常写入');
});
