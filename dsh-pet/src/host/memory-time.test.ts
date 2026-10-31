/**
 * 时间解析（`src/host/memory-time.ts`）与按时间检索的单元测试。
 *
 * 钉的是**语义**：
 *   1. 认不出的说法返回 undefined（绝不猜）——猜错会让检索结果被凭空篡改
 *   2. 「上周一」是**上周的周一**，不是"七天前的周一"（两者在周三问出来会差一周）
 *   3. 只有月日、且落在未来的日期 → 按去年理解
 *   4. 没有 ts 的老记录不参与时间查询（否则等于伪造发生时间）
 *   5. 时间查询按"越近越靠前"，且不回填只发生在窗口外的空档
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeRecall, parseTimeRange, stampLabel } from './memory-time';
import { dayTrace, docsOf, recallSection, searchByTime, traceSection } from './memory-retrieval';

const DAY = 86_400_000;

/** 2026-10-28（星期三）14:00 本地时间——固定参照点 */
const NOW = new Date(2026, 9, 28, 14, 0, 0, 0);
const startOf = (d: Date) => {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};
const TODAY0 = startOf(NOW);

test('parseTimeRange:认不出的说法返回 undefined（绝不猜）', () => {
  assert.equal(parseTimeRange('你好呀', NOW), undefined);
  assert.equal(parseTimeRange('', NOW), undefined);
  assert.equal(parseTimeRange('   ', NOW), undefined);
  assert.equal(parseTimeRange('我们聊点别的', NOW), undefined, '没有时间词就没有区间');
});

test('parseTimeRange 只认时间词，不猜意图（意图由 looksLikeRecall 管）', () => {
  // 「今天天气不错」确实含时间词 —— 解析层老实给出今天，这是**正确**的。
  // 拦住它的是 looksLikeRecall，不是解析层。两层职责分开，才不会有哪边漏判。
  const t = parseTimeRange('今天天气不错，我们聊点别的', NOW);
  assert.ok(t, '解析层该认出「今天」');
  assert.equal(t!.from, TODAY0);
  assert.equal(looksLikeRecall('今天天气不错，我们聊点别的'), false, '这不算回忆句');
});

test('looksLikeRecall:问过去的算，顺口提时间的不算', () => {
  // 算：有回忆动词 / 问过去
  assert.equal(looksLikeRecall('上周一我们聊了什么'), true);
  assert.equal(looksLikeRecall('昨天你说了啥'), true);
  assert.equal(looksLikeRecall('你还记得我养了什么吗'), true);
  assert.equal(looksLikeRecall('上次我们说到哪了'), true);
  assert.equal(looksLikeRecall('那天发生了什么'), true);
  assert.equal(looksLikeRecall('我之前跟你提过什么'), true);
  assert.equal(looksLikeRecall('当时你怎么说的'), true);
  // 不算：时间词只是个状语，真正要问的是别的事
  assert.equal(looksLikeRecall('今天天气不错'), false);
  assert.equal(looksLikeRecall('我明天要去杭州'), false);
  assert.equal(looksLikeRecall('现在几点了'), false);
  assert.equal(looksLikeRecall('今年我三十岁了'), false);
  assert.equal(looksLikeRecall(''), false);
});

test('looksLikeRecall:追悔语气提到过去某天也算（用户举的验收场景）', () => {
  // 「今天下雨，主人说：哎呀昨天应该出去玩的」——不是提问，但必须能接上"你昨天说天气不错"
  assert.equal(looksLikeRecall('哎呀昨天应该出去玩的'), true);
  assert.equal(looksLikeRecall('早知道前天就去了'), true);
  assert.equal(looksLikeRecall('本来上周该去看电影的'), true);
  // 两个条件缺一不可：只有时间词 / 只有情态词都不触发
  assert.equal(looksLikeRecall('今天应该早点睡'), false, '没提过去某天，不该查往事');
  assert.equal(looksLikeRecall('我该走了'), false);
});

test('recallSection:格式是「时间｜主人说｜你说」（用户要求的显式标签）', () => {
  const docs = docsOf([
    { role: 'user', content: '今天天气不错', ts: TODAY0 - DAY },
    { role: 'assistant', content: '对呀，适合出去走走', ts: 0 },
  ]);
  const out = recallSection([{ doc: docs[0], score: 1 }], { now: NOW });
  assert.ok(out.includes('时间：昨天'), out);
  assert.ok(out.includes('主人说：今天天气不错'), out);
  assert.ok(out.includes('你说：对呀，适合出去走走'), out);
  assert.ok(out.includes('｜'), '用竖线分隔，不用箭头连排');
  assert.ok(!out.includes('→'), '不再用箭头，否则时间和说话人容易混');
});

test('parseTimeRange:今天/昨天/前天/大前天', () => {
  const t = parseTimeRange('今天聊了什么', NOW)!;
  assert.equal(t.from, TODAY0);
  assert.equal(t.to, TODAY0 + DAY);
  const y = parseTimeRange('昨天', NOW)!;
  assert.equal(y.from, TODAY0 - DAY);
  const q = parseTimeRange('前天', NOW)!;
  assert.equal(q.from, TODAY0 - 2 * DAY);
  const d = parseTimeRange('大前天', NOW)!;
  assert.equal(d.from, TODAY0 - 3 * DAY);
});

test('parseTimeRange:口语的相对日说法（昨儿/今早/刚才/这两天）', () => {
  assert.equal(parseTimeRange('昨儿你说的', NOW)!.from, TODAY0 - DAY);
  assert.equal(parseTimeRange('昨晚聊的', NOW)!.from, TODAY0 - DAY);
  assert.equal(parseTimeRange('前日', NOW)!.from, TODAY0 - 2 * DAY);
  assert.equal(parseTimeRange('今早', NOW)!.from, TODAY0);
  assert.equal(parseTimeRange('今儿', NOW)!.from, TODAY0);
  // 「刚才」是最近两小时，不是一整天
  const just = parseTimeRange('刚才我说了什么', NOW)!;
  assert.equal(just.from, NOW.getTime() - 2 * 3_600_000);
  assert.ok(just.to > NOW.getTime());
  assert.ok(just.label.includes('刚才'));
  // 「这两天」跨昨天到今天
  const two = parseTimeRange('这两天', NOW)!;
  assert.equal(two.from, TODAY0 - DAY);
  assert.equal(two.to, TODAY0 + DAY);
  // 「这几天」最近一周
  const few = parseTimeRange('这几天', NOW)!;
  assert.equal(few.from, TODAY0 - 6 * DAY);
});

test('parseTimeRange:模糊的「前几天」给出区间并在标签里写明是按猜的', () => {
  const t = parseTimeRange('前几天我们聊过什么', NOW)!;
  assert.ok(t.label.includes('前几天'), '标签要让用户知道这是模糊区间');
  assert.ok(t.to <= TODAY0 - 3 * DAY, '至少是三天前');
  assert.ok(t.from < t.to);
});

test('parseTimeRange:裸「最近」不当作时间查询（防止顶掉关键词检索）', () => {
  // `我最近喜欢喝豆浆` 里的「最近」不是在问时间
  assert.equal(parseTimeRange('我最近喜欢喝豆浆', NOW), undefined);
});

test('parseTimeRange:今年/去年/前年 + 月日', () => {
  const t1 = parseTimeRange('去年12月25日', NOW)!;
  assert.equal(t1.from, new Date(2025, 11, 25).getTime(), '必须走带年词的分支，不能被「12月25日按去年」巧合掩盖');
  const t2 = parseTimeRange('今年10月20日', NOW)!;
  assert.equal(t2.from, new Date(2026, 9, 20).getTime());
  const t3 = parseTimeRange('前年3月1号', NOW)!;
  assert.equal(t3.from, new Date(2024, 2, 1).getTime());
});

test('parseTimeRange:今年/去年 + 整月', () => {
  const t1 = parseTimeRange('去年10月', NOW)!;
  assert.equal(t1.from, new Date(2025, 9, 1).getTime());
  assert.equal(t1.to, new Date(2025, 10, 1).getTime());
  const t2 = parseTimeRange('今年3月份', NOW)!;
  assert.equal(t2.from, new Date(2026, 2, 1).getTime());
});

test('parseTimeRange:只给月份 → 取离现在最近的那个同月', () => {
  // 现在 10 月 28 日。「3月」今年的 3 月已过 → 今年
  const m3 = parseTimeRange('3月我们聊过', NOW)!;
  assert.equal(new Date(m3.from).getFullYear(), 2026);
  assert.equal(new Date(m3.from).getMonth(), 2);
  // 「12月」今年还没到 → 取去年
  const m12 = parseTimeRange('12月', NOW)!;
  assert.equal(new Date(m12.from).getFullYear(), 2025);
});

test('parseTimeRange:「前天」不会被「今天」规则抢走', () => {
  // 「前天」包含「天」字，如果规则顺序写反，会被当成"今天"
  const q = parseTimeRange('前天', NOW)!;
  assert.notEqual(q.from, TODAY0, '前天必须是前天');
});

test('parseTimeRange:N天前', () => {
  const t = parseTimeRange('3天前我们聊过', NOW)!;
  assert.equal(t.from, TODAY0 - 3 * DAY);
  assert.equal(t.to, TODAY0 - 2 * DAY);
  const cn = parseTimeRange('五天前', NOW)!;
  assert.equal(cn.from, TODAY0 - 5 * DAY);
});

test('parseTimeRange:上周三 = 上周的周三（不是七天前的周三）', () => {
  // 2026-10-28 是星期三。本周一 = 10-26；上周一 = 10-19；上周三 = 10-21
  const t = parseTimeRange('上周三我们聊了什么', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 21).getTime(), '上周三应是 10 月 21 日');
  assert.equal(t.to, new Date(2026, 9, 22).getTime());
  assert.ok(t.label.includes('上周'));
});

test('parseTimeRange:本周一 = 本周的周一（今天是周三，所以是前天）', () => {
  const t = parseTimeRange('这周一', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 26).getTime());
});

test('parseTimeRange:裸「周三」按本周理解', () => {
  const t = parseTimeRange('周三说过什么', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 28).getTime(), '本周三就是今天');
});

test('parseTimeRange:上上周X（两周前）', () => {
  const t = parseTimeRange('上上周一', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 12).getTime(), '上上周一 = 10月12日');
});

test('parseTimeRange:只给周不给天 → 整周一整段', () => {
  const t = parseTimeRange('上周', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 19).getTime());
  assert.equal(t.to, new Date(2026, 9, 26).getTime(), '一周七天');
});

test('parseTimeRange:完整日期', () => {
  const t = parseTimeRange('2026-10-20 那天', NOW)!;
  assert.equal(t.from, new Date(2026, 9, 20).getTime());
  assert.equal(t.to, new Date(2026, 9, 21).getTime());
  const slash = parseTimeRange('2026/03/05 聊的', NOW)!;
  assert.equal(slash.from, new Date(2026, 2, 5).getTime());
  const cn = parseTimeRange('2025年12月31日', NOW)!;
  assert.equal(cn.from, new Date(2025, 11, 31).getTime());
});

test('parseTimeRange:只有月日、落在未来 → 按去年理解', () => {
  // 现在是 10 月 28 日，「12月25日」还没到 → 指的必然是去年的圣诞节
  const t = parseTimeRange('12月25日', NOW)!;
  assert.equal(new Date(t.from).getFullYear(), 2025, '未来的日期要回退到去年');
  // 「10月20日」已经过去了 → 就是今年的
  const past = parseTimeRange('10月20日', NOW)!;
  assert.equal(new Date(past.from).getFullYear(), 2026);
});

test('parseTimeRange:上个月 / 本月 / 去年 / 今年', () => {
  const lm = parseTimeRange('上个月', NOW)!;
  assert.equal(lm.from, new Date(2026, 8, 1).getTime(), '9 月 1 日');
  assert.equal(lm.to, new Date(2026, 9, 1).getTime());
  const tm = parseTimeRange('这个月', NOW)!;
  assert.equal(tm.from, new Date(2026, 9, 1).getTime());
  const ly = parseTimeRange('去年', NOW)!;
  assert.equal(ly.from, new Date(2025, 0, 1).getTime());
  assert.equal(ly.to, new Date(2026, 0, 1).getTime());
});

test('parseTimeRange:非法日期不返回区间', () => {
  assert.equal(parseTimeRange('13月40日', NOW), undefined);
  assert.equal(parseTimeRange('0月0日', NOW), undefined);
});

test('stampLabel:今天/昨天/前天/N天前/更远给日期', () => {
  assert.equal(stampLabel(NOW.getTime(), NOW), '今天');
  assert.equal(stampLabel(TODAY0 - DAY, NOW), '昨天');
  assert.equal(stampLabel(TODAY0 - 2 * DAY, NOW), '前天');
  assert.equal(stampLabel(TODAY0 - 5 * DAY, NOW), '5天前');
  assert.equal(stampLabel(new Date(2026, 0, 3).getTime(), NOW), '1月3日', '同年只给月日');
  assert.equal(stampLabel(new Date(2024, 0, 3).getTime(), NOW), '2024年1月3日', '跨年带年份');
  assert.equal(stampLabel(0, NOW), '', '无效时间不给标签，绝不编造');
  assert.equal(stampLabel(NaN, NOW), '');
});

test('docsOf:把 ts 带上（用户那句的时间）', () => {
  const docs = docsOf([
    { role: 'user', content: '我住在杭州', ts: 1000 },
    { role: 'assistant', content: '记下了', ts: 2000 },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].ts, 1000, '取用户那句的时间，不是回复那句');
});

test('docsOf:没有 ts 的文档不凭空造时间', () => {
  const docs = docsOf([
    { role: 'user', content: '老消息' },
    { role: 'assistant', content: '嗯' },
  ]);
  assert.equal(docs.length, 1);
  assert.equal('ts' in docs[0], false, '缺键就是缺，不写 0');
});

test('searchByTime:只捞区间内的，且回填按时间正序（截断仍留最近的）', () => {
  const docs = docsOf([
    { role: 'user', content: '周一的事', ts: new Date(2026, 9, 19, 10).getTime() },
    { role: 'assistant', content: '嗯', ts: 0 },
    { role: 'user', content: '周三的事', ts: new Date(2026, 9, 21, 10).getTime() },
    { role: 'assistant', content: '嗯', ts: 0 },
    { role: 'user', content: '周五的事', ts: new Date(2026, 9, 23, 10).getTime() },
    { role: 'assistant', content: '嗯', ts: 0 },
  ]);
  const span = parseTimeRange('上周', NOW)!;
  const hits = searchByTime(docs, span, 10);
  assert.equal(hits.length, 3, '上周三件事都在区间内');
  // 展示顺序必须是正序：读起来是"那天从早到晚发生了什么"，不是倒放
  assert.equal(hits[0].doc.ask, '周一的事', '最早的在最前');
  assert.equal(hits[2].doc.ask, '周五的事', '最新的在最后');
});

test('searchByTime:没有 ts 的老记录不纳入（不能伪造发生时间）', () => {
  const docs = docsOf([
    { role: 'user', content: '不知道什么时候的事' },
    { role: 'assistant', content: '嗯' },
  ]);
  const span = parseTimeRange('上周', NOW)!;
  assert.equal(searchByTime(docs, span, 10).length, 0);
});

test('searchByTime:limit 生效，且截断留的是「最近 N 条」（尽管展示是正序）', () => {
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: 'user' as const, content: `第${i}件事`, ts: new Date(2026, 9, 19, i).getTime() });
    msgs.push({ role: 'assistant' as const, content: '嗯', ts: 0 });
  }
  const docs = docsOf(msgs);
  const span = parseTimeRange('上周一', NOW)!;
  const hits = searchByTime(docs, span, 3);
  assert.equal(hits.length, 3);
  assert.equal(hits[2].doc.ask, '第9件事', '截断留下来的是最晚的 3 条，展示时它在最后');
  assert.equal(hits[0].doc.ask, '第7件事');
});

test('searchByTime:非法区间返回空', () => {
  const docs = docsOf([{ role: 'user', content: 'x', ts: 1000 }]);
  assert.equal(searchByTime(docs, { from: 100, to: 100 }, 5).length, 0, '空区间');
  assert.equal(searchByTime(docs, { from: 200, to: 100 }, 5).length, 0, '倒置区间');
});

test('dayTrace:给整段而不是抽样（用户场景的核心）', () => {
  // 昨天聊了 6 轮，其中第 3 轮是「天气不错」。用户那句话和它一个字都不重合。
  const H = 3_600_000;
  const base = TODAY0 - 24 * H;
  const rows = [
    ['早上好', '早'],
    ['写代码', '加油'],
    ['今天天气不错啊', '适合出去走走'],
    ['开会', '安静待着'],
    ['赢了', '厉害'],
    ['睡了', '晚安'],
  ];
  const msgs: Array<{ role: 'user' | 'assistant'; content: string; ts: number }> = [];
  rows.forEach(([a, r], i) => {
    msgs.push({ role: 'user', content: a, ts: base + (i + 1) * H });
    msgs.push({ role: 'assistant', content: r, ts: base + (i + 1) * H + 3000 });
  });
  const docs = docsOf(msgs);
  const span = parseTimeRange('昨天', NOW)!;
  const t = dayTrace(docs, span, { max: 40, clip: 60, query: '哎呀昨天应该出去玩的' });
  assert.equal(t.lines.length, 6, '6 轮全给，不抽样');
  assert.ok(
    t.lines.some((d) => /天气不错/.test(d.ask)),
    '「天气不错」必须在里面',
  );
  assert.equal(t.truncated, false);
});

test('dayTrace:上限压得很紧时，靠相关度保住该保的那条', () => {
  const H = 3_600_000;
  const base = TODAY0 - 24 * H;
  const rows = [
    ['早上好', '早'],
    ['写代码', '加油'],
    ['今天天气不错啊', '适合出去走走'],
    ['开会', '安静待着'],
    ['赢了', '厉害'],
    ['睡了', '晚安'],
    ['明天见', '明天见'],
    ['晚安啦', '好梦'],
  ];
  const msgs: Array<{ role: 'user' | 'assistant'; content: string; ts: number }> = [];
  rows.forEach(([a, r], i) => {
    msgs.push({ role: 'user', content: a, ts: base + (i + 1) * H });
    msgs.push({ role: 'assistant', content: r, ts: base + (i + 1) * H + 3000 });
  });
  const docs = docsOf(msgs);
  const span = parseTimeRange('昨天', NOW)!;
  // 只留 3 条、且问句和往事没有关键词重合 → 纯按新旧会丢掉「天气」
  // 这里给一个**带关键词**的 query，验证相关度确实参与选择
  const t = dayTrace(docs, span, { max: 4, clip: 60, query: '昨天说天气不错' });
  assert.equal(t.truncated, true);
  assert.equal(t.total, 8, '总数照实报');
  assert.ok(t.lines.length <= 4);
  assert.ok(
    t.lines.some((d) => /天气/.test(d.ask)),
    '带「天气」的 query 要能把它保下来',
  );
});

test('dayTrace:空区间/倒置区间返回空', () => {
  const docs = docsOf([{ role: 'user', content: 'x', ts: 1000 }]);
  assert.equal(dayTrace(docs, { from: 100, to: 100 }).lines.length, 0);
  assert.equal(dayTrace(docs, { from: 200, to: 100 }).lines.length, 0);
});

test('dayTrace:没有 ts 的记录不进轨迹（不能伪造时间）', () => {
  const docs = docsOf([
    { role: 'user', content: '不知道什么时候' },
    { role: 'assistant', content: '嗯' },
  ]);
  const span = parseTimeRange('昨天', NOW)!;
  assert.equal(dayTrace(docs, span).lines.length, 0);
});

test('traceSection:同一天用时刻，跨天带日期', () => {
  const H = 3_600_000;
  const base = TODAY0 - 24 * H;
  const same = docsOf([
    { role: 'user', content: '早', ts: base + H },
    { role: 'assistant', content: '早', ts: base + H + 1000 },
    { role: 'user', content: '晚', ts: base + 10 * H },
    { role: 'assistant', content: '晚安', ts: base + 10 * H + 1000 },
  ]);
  const s1 = traceSection(same, '昨天', { clip: 60 });
  assert.ok(/\d{2}:\d{2}/.test(s1), '同一天给时刻：' + s1.slice(0, 200));
  assert.ok(!/月\d+日/.test(s1), '同一天不重复写日期');

  // 跨多天（比如「上周」整周）才带日期
  const multi = docsOf([
    { role: 'user', content: '周一', ts: TODAY0 - 9 * 24 * H },
    { role: 'assistant', content: '嗯', ts: TODAY0 - 9 * 24 * H + 1000 },
    { role: 'user', content: '周五', ts: TODAY0 - 5 * 24 * H },
    { role: 'assistant', content: '嗯', ts: TODAY0 - 5 * 24 * H + 1000 },
  ]);
  const s2 = traceSection(multi, '上周', { clip: 60 });
  assert.ok(/\d+月\d+日/.test(s2), '跨天要带日期：' + s2.slice(0, 200));
});

test('traceSection:超长正文会截断，且带省略号', () => {
  const long = '这是一句非常长的往事'.repeat(20);
  const docs = docsOf([
    { role: 'user', content: long, ts: TODAY0 - DAY },
    { role: 'assistant', content: '嗯', ts: TODAY0 - DAY + 1000 },
  ]);
  const s = traceSection(docs, '昨天', { clip: 20 });
  assert.ok(s.includes('…'), '长句要截断加省略号');
  // 不能拿整段（含说明文字）比长短，要断言**那句原文没有整份出现**
  assert.ok(!s.includes(long), '原文不该整份塞进去');
  const line = s.split('\n').find((l) => l.includes('主人说：')) ?? '';
  const body = line.split('主人说：')[1]?.split(' ｜ ')[0] ?? '';
  assert.ok(body.replace('…', '').length <= 20, '截到 clip 字：' + body);
});

test('traceSection:节选时写明总数', () => {
  const H = 3_600_000;
  const base = TODAY0 - 24 * H;
  const msgs: Array<{ role: 'user' | 'assistant'; content: string; ts: number }> = [];
  for (let i = 0; i < 5; i++) {
    msgs.push({ role: 'user', content: '第' + i + '件事', ts: base + (i + 1) * H });
    msgs.push({ role: 'assistant', content: '嗯', ts: base + (i + 1) * H + 1000 });
  }
  const docs = docsOf(msgs);
  const s = traceSection(docs, '昨天', { clip: 60, total: 20, truncated: true });
  assert.ok(s.includes('共 20 轮'), '节选要报出总数：' + s.slice(0, 120));
});

test('traceSection:措辞是「你挑」而不是「你复述」', () => {
  const docs = docsOf([
    { role: 'user', content: '今天天气不错啊', ts: TODAY0 - DAY },
    { role: 'assistant', content: '适合出去走走', ts: TODAY0 - DAY + 1000 },
  ]);
  const s = traceSection(docs, '昨天');
  assert.ok(s.includes('挑'), '要让模型自己挑一句接上');
  assert.ok(s.includes('不要一条条复述'), '明确禁止逐条复述');
  assert.ok(/别.*安到.*头上/.test(s) || s.includes('别把'), '明确别把"你说"的安到用户头上');
});

test('recallSection:每条往事都带时间标注', () => {
  const docs = docsOf([
    { role: 'user', content: '我养了一只猫叫团子', ts: TODAY0 - 3 * DAY },
    { role: 'assistant', content: '团子真可爱', ts: 0 },
  ]);
  const out = recallSection([{ doc: docs[0], score: 1 }], { now: NOW });
  assert.ok(out.includes('3天前'), '必须写出时间：' + out);
  assert.ok(out.includes('团子'));
});

test('recallSection:没有 ts 时不写假的「今天」', () => {
  const docs = docsOf([
    { role: 'user', content: '老消息' },
    { role: 'assistant', content: '嗯' },
  ]);
  const out = recallSection([{ doc: docs[0], score: 1 }], { now: NOW });
  assert.ok(out.includes('主人说：老消息'), '无时间时省掉「时间：」这节，其余照常：' + out);
  assert.ok(!out.includes('时间：'), '不能凭空造一个时间节');
  assert.ok(!out.includes('今天'), '不能凭空标今天');
});
