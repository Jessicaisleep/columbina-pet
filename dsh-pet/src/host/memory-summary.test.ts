/**
 * 记忆压缩纯逻辑单元测试 —— 钉住 `planCompression` 的边界，因为它是"要不要花一次模型调用、
 * 以及花完之后哪段对话会从上下文里消失"的唯一判定点。这里的每一条断言都对应一个
 * **会静默丢记忆或静默不压缩**的真实故障：
 *
 *   - 触发线判错 → 该压的时候不压（长期记忆永远建立不起来）；
 *   - 保留区算错 → 压得太狠（近期细节丢失）或压不动（功能形同虚设）；
 *   - `to <= from` 不拦 → 重复点手动压缩会拿空区间去调模型，产出空摘要并推进游标（真丢记忆）；
 *   - `keepRounds >= compressRounds` 不兜底 → 压缩永远没有可压段落，功能静默失效。
 *
 * 全部是纯函数，不碰磁盘、不调模型。
 *
 * 跑法：node --experimental-strip-types --test src/host/memory-summary.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSummaryPatchUserText,
  buildSummaryUserText,
  compressPolicyOf,
  DEFAULT_COMPRESS_ROUNDS,
  DEFAULT_KEEP_ROUNDS,
  MAX_SUMMARY_CHARS,
  memorySection,
  normalizeSummary,
  overviewOf,
  planCompression,
  renderTranscript,
  summarizedAfterChange,
  summarizedOf,
  SUMMARY_PATCH_SYSTEM_PROMPT,
  type ChatMemoryEntry,
} from './memory-summary.ts';
import type { ChatMemoryMessage } from './chat.ts';

/** 造 n 条消息（user/assistant 交替），内容带序号便于断言区间 */
function msgs(n: number): ChatMemoryMessage[] {
  const out: ChatMemoryMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm' + i, ts: i });
  }
  return out;
}

/** 造一个记忆叶子 */
function entry(n: number, extra: Partial<ChatMemoryEntry> = {}): ChatMemoryEntry {
  return { messages: msgs(n), ...extra };
}

const POLICY = { enabled: true, compressRounds: 20, keepRounds: 5 };

describe('compressPolicyOf —— 缺省与兜底', () => {
  test('空配置取内置默认，且自动压缩默认开启', () => {
    const p = compressPolicyOf({});
    assert.equal(p.enabled, true, '缺省应开启：长期记忆是默认体验');
    assert.equal(p.compressRounds, DEFAULT_COMPRESS_ROUNDS);
    assert.equal(p.keepRounds, DEFAULT_KEEP_ROUNDS);
  });

  test('显式 false 才关闭；任何非 false 值都算开启', () => {
    assert.equal(compressPolicyOf({ memoryCompressEnabled: false }).enabled, false);
    assert.equal(compressPolicyOf({ memoryCompressEnabled: true }).enabled, true);
    assert.equal(compressPolicyOf({ memoryCompressEnabled: 'no' }).enabled, true, '只有布尔 false 才关');
  });

  test('非法数字回落默认，不抛错', () => {
    const p = compressPolicyOf({ memoryCompressRounds: 'abc', memoryKeepRounds: -3 });
    assert.equal(p.compressRounds, DEFAULT_COMPRESS_ROUNDS);
    assert.equal(p.keepRounds, DEFAULT_KEEP_ROUNDS);
  });

  test('keepRounds >= compressRounds 时按触发线的一半兜底（否则永远压不动）', () => {
    const p = compressPolicyOf({ memoryCompressRounds: 10, memoryKeepRounds: 10 });
    assert.ok(p.keepRounds < p.compressRounds, '兜底后必须严格小于触发线');
    assert.equal(p.keepRounds, 5);
    // 兜底后 planCompression 真的能压（这条是"兜底有效"的证明，不只断言数字）
    const plan = planCompression(entry(40), p);
    assert.notEqual(plan, null);
  });

  test('compressRounds = 0 时不触发那条兜底（除零保护）', () => {
    const p = compressPolicyOf({ memoryCompressRounds: 0, memoryKeepRounds: 0 });
    assert.equal(p.keepRounds, 0, '触发线为 0 时保留区保持 0，不该被除零算成 NaN');
  });
});

describe('summarizedOf —— 坏数据钳位', () => {
  test('缺失 / 负数 / 非数字 → 0', () => {
    assert.equal(summarizedOf({ messages: msgs(4) }), 0);
    assert.equal(summarizedOf({ messages: msgs(4), summarized: -1 }), 0);
    assert.equal(summarizedOf({ messages: msgs(4), summarized: Number.NaN }), 0);
  });

  test('超过消息总数时钳到总数（防 slice 越界读出怪结果）', () => {
    assert.equal(summarizedOf({ messages: msgs(4), summarized: 99 }), 4);
  });

  test('messages 不是数组时按 0（调用方会另行修复结构）', () => {
    assert.equal(summarizedOf({ messages: null as unknown as ChatMemoryMessage[] }), 0);
  });
});

describe('planCompression —— 触发线与区间', () => {
  test('未摘要轮数未超触发线 → 不压', () => {
    // 20 轮 = 40 条，policy 触发线 20 轮：恰好等于不算"超过"
    assert.equal(planCompression(entry(40), POLICY), null);
  });

  test('超过触发线 → 压到只剩 keepRounds 轮', () => {
    // 25 轮 = 50 条，触发线 20 轮 → 该压；保留 5 轮 = 10 条 → to = 40
    const plan = planCompression(entry(50), POLICY);
    assert.deepEqual(plan, { from: 0, to: 40, nextSummarized: 40 });
  });

  test('已压过一段时从游标继续，不重复压老内容', () => {
    // 已摘要 40 条，总 80 条 → 未摘要 20 轮，等于触发线不压
    assert.equal(planCompression(entry(80, { summarized: 40 }), POLICY), null);
    // 总 84 条 → 未摘要 22 轮 > 20，压到 to = 84 - 10 = 74
    const plan = planCompression(entry(84, { summarized: 40 }), POLICY);
    assert.deepEqual(plan, { from: 40, to: 74, nextSummarized: 74 });
  });

  test('to <= from（保留区吃掉全部未摘要内容）→ 不压，避免空区间调用', () => {
    // 已摘要 40，总 44 → 未摘要 4 条 = 2 轮；force 也压不动（to = 44-10 = 34 < from）
    assert.equal(planCompression(entry(44, { summarized: 40 }), POLICY, { force: true }), null);
  });

  test('enabled=false 时不自动压，但 force 仍然压（手动不受开关限制）', () => {
    const off = { ...POLICY, enabled: false };
    assert.equal(planCompression(entry(100), off), null);
    const plan = planCompression(entry(100), off, { force: true });
    assert.deepEqual(plan, { from: 0, to: 90, nextSummarized: 90 });
  });

  test('空消息列表 → 不压', () => {
    assert.equal(planCompression(entry(0), POLICY, { force: true }), null);
  });

  test('奇数条消息（生成失败残留半轮）不崩，仍按条数算', () => {
    const plan = planCompression(entry(51), POLICY);
    assert.deepEqual(plan, { from: 0, to: 41, nextSummarized: 41 });
  });
});

describe('renderTranscript / buildSummaryUserText', () => {
  test('按角色渲染，空内容跳过', () => {
    const text = renderTranscript([
      { role: 'user', content: '你好', ts: 1 },
      { role: 'assistant', content: '   ', ts: 2 },
      { role: 'assistant', content: '在的', ts: 3 },
    ]);
    assert.equal(text, '用户：你好\n宠物：在的');
  });

  test('无旧摘要时只有新记录段', () => {
    const text = buildSummaryUserText('', msgs(2));
    assert.ok(!text.includes('更早的摘要'));
    assert.ok(text.includes('【新的对话记录】'));
  });

  test('有旧摘要时要求合并（不是简单拼接）', () => {
    const text = buildSummaryUserText('用户喜欢下雨天', msgs(2));
    assert.ok(text.includes('【更早的摘要】'));
    assert.ok(text.includes('用户喜欢下雨天'));
    assert.ok(text.includes('合并成一份新摘要'));
  });
});

describe('normalizeSummary —— 归一与封顶', () => {
  test('剥掉整体包裹的代码围栏', () => {
    assert.equal(normalizeSummary('```markdown\n用户喜欢猫\n```'), '用户喜欢猫');
    assert.equal(normalizeSummary('```\n用户喜欢猫\n```'), '用户喜欢猫');
  });

  test('连续空行压成一个', () => {
    assert.equal(normalizeSummary('A\n\n\n\nB'), 'A\n\nB');
  });

  test('超长按句末截断，不留半句', () => {
    const long = '甲'.repeat(MAX_SUMMARY_CHARS - 10) + '。' + '乙'.repeat(200);
    const out = normalizeSummary(long);
    assert.ok(out.length <= MAX_SUMMARY_CHARS);
    assert.ok(out.endsWith('。'), '应切在句末而不是硬截');
  });

  test('非字符串 / 空白 → 空串', () => {
    assert.equal(normalizeSummary('   '), '');
    assert.equal(normalizeSummary(undefined as unknown as string), '');
  });
});

describe('memorySection —— 空摘要必须零影响', () => {
  test('空摘要返回空串（保证未压缩的宠物 system 与改造前逐字一致）', () => {
    assert.equal(memorySection(''), '');
    assert.equal(memorySection('   '), '');
    assert.equal(memorySection(undefined as unknown as string), '');
  });

  test('非空摘要带出正文且要求不复述', () => {
    const s = memorySection('用户叫小明');
    assert.ok(s.includes('用户叫小明'));
    assert.ok(s.includes('不要复述'));
  });
});

describe('overviewOf —— GET /chat 的回执字段', () => {
  test('空记忆全零', () => {
    assert.deepEqual(overviewOf({ messages: [] }), {
      summary: '',
      summaryTs: 0,
      summarized: 0,
      total: 0,
      pendingRounds: 0,
    });
  });

  test('有摘要时给出游标与待压缩轮数', () => {
    const o = overviewOf({ messages: msgs(30), summarized: 10, summary: '摘要', summaryTs: 123 });
    assert.equal(o.summarized, 10);
    assert.equal(o.total, 30);
    assert.equal(o.pendingRounds, 10, '(30-10)/2 = 10 轮');
    assert.equal(o.summaryTs, 123);
  });

  test('summaryTs 非法 → 0（前端按"没有摘要时间"处理）', () => {
    assert.equal(overviewOf({ messages: msgs(2), summaryTs: -5 }).summaryTs, 0);
  });
});

describe('summarizedAfterChange —— 改/删一条后的摘要游标（2026-10-30 任务2）', () => {
  test('改一条不动游标（条数没变）', () => {
    assert.equal(summarizedAfterChange(6, 10, 2, 'edit'), 6);
  });

  test('删掉覆盖区内的一条 → 游标退一格', () => {
    // 为什么必须退：messages[0..summarized) 少了一条但游标还说"这些都被摘要吃掉"，
    // 下一条本该进上下文的原文就会被永久跳过 = 静默丢记忆。
    assert.equal(summarizedAfterChange(6, 10, 3, 'delete'), 5);
  });

  test('删掉覆盖区外的一条 → 游标不动', () => {
    assert.equal(summarizedAfterChange(6, 10, 7, 'delete'), 6, 'index 7 在 [0,6) 之外');
  });

  test('删掉游标正上方那条（index === summarized）→ 不动', () => {
    // index 6 是"第一条还没进摘要的"，它不在覆盖区内，删它不会少一封被摘要吃掉的信
    assert.equal(summarizedAfterChange(6, 10, 6, 'delete'), 6);
  });

  test('每次删都退一格，连删三次退三格', () => {
    let s = 6;
    for (let i = 0; i < 3; i += 1) s = summarizedAfterChange(s, 10 - i, 0, 'delete');
    assert.equal(s, 3);
  });

  test('游标不会退成负数', () => {
    assert.equal(summarizedAfterChange(0, 1, 0, 'delete'), 0);
  });

  test('越界 / 非法入参一律夹到 [0, len]，不抛错', () => {
    assert.equal(summarizedAfterChange(6, 10, -1, 'delete'), 6, '负数 index 不认');
    assert.equal(summarizedAfterChange(6, 10, 99, 'delete'), 6, '越界 index 不认');
    // 2.5 会被 Math.floor 成 2 —— 落在覆盖区内，按"删了第 2 条"处理。
    // 路由层已经先用 Number.isInteger 挡掉了非整数，这里的 floor 只是防御性兜底（不让 NaN 漏过去）。
    assert.equal(summarizedAfterChange(6, 10, 2.5, 'delete'), 5, '非整数向下取整');
    assert.equal(summarizedAfterChange(-3, 10, 2, 'delete'), 0);
    assert.equal(summarizedAfterChange(99, 10, 2, 'delete'), 10, '超过总数时钳到总数');
    assert.equal(summarizedAfterChange(NaN, 10, 2, 'delete'), 0, 'summarized 非法 → 0');
    // total 非法时 len=0，游标被钳到 0——不存在"删了一条但总数是 NaN"的世界，钳到 0 比留着 6 安全
    assert.equal(summarizedAfterChange(6, NaN, 2, 'delete'), 0, 'total 非法 → 钳到 0');
  });
});

describe('buildSummaryPatchUserText —— 让模型只改摘要里相关的那点', () => {
  test('改：给出原内容与改成，并要求没提到就原样返回', () => {
    const s = buildSummaryPatchUserText('用户住在杭州。', {
      kind: 'edit',
      oldText: '我住在杭州',
      newText: '我搬到成都了',
    });
    assert.ok(s.includes('用户住在杭州。'), '旧摘要要原样带上，模型才知道哪些不能动');
    assert.ok(s.includes('我住在杭州'));
    assert.ok(s.includes('我搬到成都了'));
    assert.ok(s.includes('原样返回'), '摘要没提过的改动必须明确要求不动');
  });

  test('改：新内容含长期信息时要求补进摘要（2026-10-30 实机抓到的漏记）', () => {
    // 实机读数：把已压缩的「你是谁」改成「我叫小明，我住在成都，养了一只叫团子的猫」后，
    // 模型严格照旧提示词「摘要根本没提到就原样返回」→ 摘要 60 字一个字没变。
    // 那条原文已经被压缩掉了，摘要不写下来就**彻底消失**，这正是最该记住的东西。
    const s = buildSummaryPatchUserText('用户称呼桌宠为哥伦比娅。', {
      kind: 'edit',
      oldText: '你是谁',
      newText: '我叫小明，我住在成都，养了一只叫团子的猫。',
    });
    assert.ok(s.includes('长期'), '要明确区分「值得长期记住」与「不值得」');
    assert.ok(s.includes('补进去'), '摘要里原本没有的新长期信息必须要求补写');
    assert.ok(
      SUMMARY_PATCH_SYSTEM_PROMPT.includes('身份') && SUMMARY_PATCH_SYSTEM_PROMPT.includes('宠物'),
      '系统提示要列出哪些算长期信息，否则模型只认「住址」这一个例子',
    );
    assert.ok(SUMMARY_PATCH_SYSTEM_PROMPT.includes('寒暄'), '反例也要写：寒暄/一次性动作不补，否则摘要会被灌水');
  });

  test('删：给出被删内容，并要求去掉只能由它支撑的说法', () => {
    const s = buildSummaryPatchUserText('用户养了一只猫叫团子。', {
      kind: 'delete',
      oldText: '我养了一只猫叫团子',
    });
    assert.ok(s.includes('用户养了一只猫叫团子。'));
    assert.ok(s.includes('我养了一只猫叫团子'));
    assert.ok(s.includes('删'));
    assert.ok(s.includes('一个字都不要动'), '其余内容必须明确禁止重写（重写=有损）');
  });

  test('两种都要求"只输出摘要正文"（否则模型会回一段解释，被当成摘要存下去）', () => {
    const a = buildSummaryPatchUserText('旧', { kind: 'edit', oldText: 'a', newText: 'b' });
    const b = buildSummaryPatchUserText('旧', { kind: 'delete', oldText: 'a' });
    assert.ok(a.includes('只输出'));
    assert.ok(b.includes('只输出'));
  });

  test('超长原文被截断（避免几百字一条把 prompt 撑爆）', () => {
    const long = '啊'.repeat(2000);
    const s = buildSummaryPatchUserText('旧摘要', { kind: 'delete', oldText: long });
    assert.ok(s.length < 2000, '应被截断');
    assert.ok(s.includes('…'), '截断留省略号，让模型知道后面还有');
  });

  test('空摘要也不崩（覆盖区外为空的兜底路径）', () => {
    const s = buildSummaryPatchUserText('', { kind: 'edit', oldText: '', newText: 'x' });
    assert.ok(s.length > 0);
  });

  test('系统提示钉住"只输出正文、不解释、不提改动/删除"', () => {
    // 模型若回一段「好的，我已把摘要更新为：…」，normalizeSummary 拦不住，那段元话术会被当成摘要存下去
    assert.ok(SUMMARY_PATCH_SYSTEM_PROMPT.includes('只输出更新后的摘要正文'));
    assert.ok(SUMMARY_PATCH_SYSTEM_PROMPT.includes('不要提到'));
    assert.ok(SUMMARY_PATCH_SYSTEM_PROMPT.includes('第三人称'), '人称错了摘要会变成"我在跟用户说话"');
  });
});
