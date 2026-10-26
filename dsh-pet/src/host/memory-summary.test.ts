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
  summarizedOf,
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
