import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractAiTags, mergeTags, tagInstruction, tagOf, tagText, topicNames } from './memory-tags';

// ============================================================
// 这张测试文件保护的是**手写词典本身**。
// 为什么必须有：词表是手工维护的，改一个词可能悄悄打掉一整类，
// 而打错标签的后果会一路传到检索层（标错的往事召不回，无关的召回来）。
// 所以每加一批词，就加一条断言。
// ============================================================

test('词表：19 个类目都在，且每类都有触发词', () => {
  const all = topicNames();
  assert.equal(all.length, 19, '类目数变了就说明词表结构动了，同步改这条');
  for (const name of [
    '天气',
    '宠物',
    '吃饭',
    '饮品',
    '工作',
    '游戏',
    '睡眠',
    '出门',
    '身体',
    '学习',
    '家人',
    '朋友',
    '购物',
    '钱',
    '娱乐',
    '居住',
    '交通',
    '感情',
    '电脑',
  ]) {
    assert.ok(all.includes(name), '缺类目：' + name);
  }
});

test('词表：每类至少能被一句自然话说中（类目可用的最低标准）', () => {
  const cases: Array<[string, string]> = [
    ['今天天气不错啊', '天气'],
    ['晚上想吃火锅', '吃饭'],
    ['这个 bug 改了三遍了', '工作'],
    ['今天赢了三把', '游戏'],
    ['昨晚熬夜到三点', '睡眠'],
    ['周末想去爬山', '出门'],
    ['今天头疼得厉害', '身体'],
    ['下周要考试了', '学习'],
    ['我妈今天打电话来', '家人'],
    ['淘宝下单了两件衣服', '购物'],
    ['这个月工资还没发', '钱'],
    ['看了部电影挺好看的', '娱乐'],
    ['新买的沙发到了', '居住'],
    ['打车去机场堵了一路', '交通'],
    ['他跟我表白了', '感情'],
    ['电脑又蓝屏了', '电脑'],
    ['刚泡了杯拿铁', '饮品'],
    ['晚上和闺蜜吃饭', '朋友'],
  ];
  for (const [text, topic] of cases) {
    assert.ok(tagOf(text).topics.includes(topic), text + ' 应命中 ' + topic);
  }
});

test('词表：宠物品种名不吃「狗」这一层（金毛/泰迪本身不含"狗"字）', () => {
  for (const text of ['我家金毛又拆家了', '邻居家泰迪一直叫', '边牧太聪明了']) {
    assert.ok(tagOf(text).topics.includes('宠物'), text + ' 应命中 宠物');
  }
});

test('词表：游戏按具体作品也能认（原神/王者 不含"游戏"两字）', () => {
  for (const text of ['原神新版本抽卡出货了', '今晚打王者', '崩铁更新了']) {
    assert.ok(tagOf(text).topics.includes('游戏'), text + ' 应命中 游戏');
  }
});

test('词表：一句话可以有多个标签（用户要的核心行为）', () => {
  // 「今天出门看见一只狗狗好可爱」= 日期（时间轴）+ 出门 + 宠物 + 正面情绪
  // 用集合比较，不依赖类目在词表里的先后顺序
  const t = tagOf('今天出门看见一只狗狗好可爱');
  assert.deepEqual([...t.topics].sort(), ['出门', '宠物'].sort());
  assert.equal(t.mood, 'pos');
  // 「加班到十点，累死了」= 工作 + 身体 + 负面情绪
  const t2 = tagOf('今天加班到十点，累死了');
  assert.ok(t2.topics.includes('工作') && t2.topics.includes('身体'));
  assert.equal(t2.mood, 'neg');
});

test('词表：同一类目只记一次（不重复）', () => {
  const t = tagOf('下雨了，还打雷，雨很大，暴雨');
  const weather = t.topics.filter((x) => x === '天气');
  assert.equal(weather.length, 1);
});

// ============================================================
// 假朋友：单字触发词不能乱命中
// ============================================================
test('假朋友：「积累」不算累（身体）', () => {
  assert.ok(!tagOf('这个 bug 积累了三天').topics.includes('身体'));
});

test('假朋友：「大家/专家/作家」不算家人，也不算居住', () => {
  const t = tagOf('大家参考一下这个方案');
  assert.ok(!t.topics.includes('家人'));
  assert.ok(!t.topics.includes('居住'));
});

test('假朋友：「考虑/参考/思考」不算考（学习）', () => {
  for (const text of ['我考虑一下', '你参考一下', '让我思考下']) {
    assert.ok(!tagOf(text).topics.includes('学习'), text);
  }
});

test('假朋友：「困难/困扰」不算困（睡眠）', () => {
  assert.ok(!tagOf('遇到困难了').topics.includes('睡眠'));
});

test('假朋友：「爱好/可爱」不算爱（感情）', () => {
  assert.ok(!tagOf('我的爱好是画画').topics.includes('感情'));
});

test('假朋友：「包含/书包/钱包/打包」不算包（购物）', () => {
  for (const text of ['这个单词包含两个音节', '书包太重了', '钱包丢了', '帮我打包']) {
    assert.ok(!tagOf(text).topics.includes('购物'), text);
  }
});

test('假朋友：「剧烈/加剧」不算剧（娱乐）', () => {
  assert.ok(!tagOf('温度下降得很剧烈').topics.includes('娱乐'));
});

test('假朋友：「酒店」不算酒（饮品）', () => {
  assert.ok(!tagOf('订了个酒店').topics.includes('饮品'));
});

test('假朋友：「提醒/唤醒」不算醒（睡眠）', () => {
  assert.ok(!tagOf('提醒我一下').topics.includes('睡眠'));
});

test('假朋友：「国家/科学家」不算家（家人）', () => {
  assert.ok(!tagOf('国家出台新政策').topics.includes('家人'));
});

test('假朋友：已知误标「热搜」被算成热（刻意保留的取舍）', () => {
  // 把「热」列进误伤表会打掉「今天好热」这个最高频天气说法。
  // 两害相权保留「热」，宁可偶尔误标，交给后台 AI 补标纠正。
  // 这条断言的作用是**把取舍钉住**：以后谁想改，会先看到这段说明。
  assert.ok(tagOf('今天的热搜很有意思').topics.includes('天气'));
});

test('假朋友：为了挡误伤，绝不能把主要用例一起挡掉', () => {
  for (const text of ['今天好热', '天气好热啊', '外面热得要命']) {
    assert.ok(tagOf(text).topics.includes('天气'), text + ' 必须命中天气');
  }
  // 「我家」是真的家，不是"大家"那种误伤
  assert.ok(tagOf('我家金毛又拆家了').topics.includes('宠物'));
});

// ============================================================
// 情绪与语气
// ============================================================
test('情绪：否定词翻转极性', () => {
  assert.equal(tagOf('今天好开心').mood, 'pos');
  assert.equal(tagOf('今天不开心').mood, 'neg');
  assert.equal(tagOf('今天不累，挺好').mood, 'pos');
});

test('情绪：不收单独的「好」（应答词会污染整批）', () => {
  assert.equal(tagOf('好，我这就去').mood, 'neutral');
  assert.equal(tagOf('好的').mood, 'neutral');
});

test('语气：提问优先于约定，约定优先于情绪', () => {
  assert.equal(tagOf('今天天气怎么样').kind, 'question');
  assert.equal(tagOf('明天去爬山吧').kind, 'plan');
  assert.equal(tagOf('今天赢了三把').kind, 'emotion');
  assert.equal(tagOf('桌子上有个杯子').kind, 'statement');
});

test('空串/非字符串不崩', () => {
  assert.deepEqual(tagOf(''), { topics: [], mood: 'neutral', kind: 'statement' });
  assert.deepEqual(tagOf(undefined as unknown as string), {
    topics: [],
    mood: 'neutral',
    kind: 'statement',
  });
});

// ============================================================
// 标签文本与合并
// ============================================================
test('tagText：标签要变成可检索的词', () => {
  const t = tagText({ topics: ['宠物', '出门'], mood: 'pos', kind: 'emotion' });
  assert.ok(t.includes('宠物'));
  assert.ok(t.includes('开心'), '正面情绪要有能查的说法');
  assert.ok(!t.includes('难过'), '正面不要带负面词');
});

test('mergeTags：AI 能补上词典没有的主题', () => {
  const lex = { topics: [] as string[], mood: 'neutral' as const, kind: 'statement' as const };
  const merged = mergeTags(lex, { topics: ['宠物'], mood: 'pos', kind: 'emotion' });
  assert.deepEqual(merged.topics, ['宠物']);
  assert.equal(merged.mood, 'pos');
});

test('mergeTags：AI 留空时用词典兜住', () => {
  const lex = { topics: ['天气'], mood: 'pos' as const, kind: 'emotion' as const };
  const merged = mergeTags(lex, { topics: [], mood: 'neutral', kind: 'statement' });
  assert.deepEqual(merged.topics, ['天气']);
  assert.equal(merged.mood, 'pos', 'AI 说 neutral 时不能把词典的 pos 抹掉');
});

test('mergeTags：没有 AI 标签时原样返回词典结果', () => {
  const lex = { topics: ['工作'], mood: 'neg' as const, kind: 'emotion' as const };
  assert.deepEqual(mergeTags(lex, undefined), lex);
});

// ============================================================
// 同轮搭车：`[标:话题|情绪|语气]` 的解析
//
// 这条路的成败全在**解析器不吞回复**上。它是模型自由生成的尾巴，
// 格式一定会歪（少一段、全角冒号、只给中文、忘了写），
// 而它剥的是用户即将看到的那句话——剥错就是把回复吃掉半句。
// ============================================================
test('extractAiTags：标准三段标记要被剥离并解析', () => {
  const r = extractAiTags('好可爱呀，我也想摸摸它。\n[标:宠物|pos|emotion]');
  assert.equal(r.text, '好可爱呀，我也想摸摸它。');
  assert.deepEqual(r.tags?.topics, ['宠物']);
  assert.equal(r.tags?.mood, 'pos');
  assert.equal(r.tags?.kind, 'emotion');
});

test('extractAiTags：话题可以多个（顿号/逗号/斜杠都认）', () => {
  for (const sep of ['、', ',', '，', '/', ' ']) {
    const r = extractAiTags('今天出门遛狗，晒了会儿太阳。\n[标:宠物' + sep + '出门|pos|statement]');
    assert.deepEqual(r.tags?.topics, ['宠物', '出门'], '分隔符：' + sep);
  }
});

test('extractAiTags：全角冒号与竖线也认（中文输入法很常见）', () => {
  const r = extractAiTags('嗯嗯。\n[标：天气｜neg｜emotion]');
  assert.equal(r.text, '嗯嗯。');
  assert.deepEqual(r.tags?.topics, ['天气']);
  assert.equal(r.tags?.mood, 'neg');
});

test('extractAiTags：情绪/语气写中文也认', () => {
  const r = extractAiTags('明天一起吃饭吧。\n[标:吃饭|正面|计划]');
  assert.equal(r.tags?.mood, 'pos');
  assert.equal(r.tags?.kind, 'plan');
});

test('extractAiTags：少写一段时按缺省补齐，不丢整条', () => {
  const r = extractAiTags('哦这样啊。\n[标:工作]');
  assert.equal(r.text, '哦这样啊。');
  assert.deepEqual(r.tags?.topics, ['工作']);
  assert.equal(r.tags?.mood, 'neutral');
  assert.equal(r.tags?.kind, 'statement');
});

test('extractAiTags：模型说拿不准（[标:||]）→ 不返回标签，让词典兜底', () => {
  const r = extractAiTags('嗯。\n[标:||]');
  assert.equal(r.text, '嗯。', '标记还是得剥掉，否则用户会看到一行 [标:||]');
  assert.equal(r.tags, undefined, '不能返回空标签去覆盖词典结果');
});

test('extractAiTags：标记不在结尾 → 不动正文（回复里可能真在讲这个格式）', () => {
  const src = '[标:宠物|pos|emotion] 这个标记是这么写的，你记住了吗？';
  const r = extractAiTags(src);
  assert.equal(r.text, src);
  assert.equal(r.tags, undefined);
});

test('extractAiTags：只回标记没有正文 → 原样返回，交给上层判空', () => {
  const r = extractAiTags('[标:宠物|pos|emotion]');
  assert.equal(r.text, '[标:宠物|pos|emotion]');
});

test('extractAiTags：没有标记时一个字节都不改', () => {
  const src = '今天天气不错，适合出去走走。';
  const r = extractAiTags(src);
  assert.equal(r.text, src);
  assert.equal(r.tags, undefined);
});

test('extractAiTags：空串 / 非字符串不崩', () => {
  assert.equal(extractAiTags('').text, '');
  // 上游可能把 undefined 塞进来（生成失败路径），不能让它抛
  const r = extractAiTags(undefined as unknown as string);
  assert.equal(r.text, '');
});

test('extractAiTags：话题最多 3 个，超出的丢掉（防模型刷一长串）', () => {
  const r = extractAiTags('乱七八糟。\n[标:甲、乙、丙、丁、戊|neutral|statement]');
  assert.equal(r.tags?.topics.length, 3);
});

test('tagInstruction：类目表与词典同源，且明说不要展示给用户', () => {
  const ins = tagInstruction();
  for (const name of topicNames()) assert.ok(ins.includes(name), '指令里缺类目：' + name);
  assert.ok(ins.includes('[标:'), '要给格式样例');
  assert.ok(ins.includes('不要猜'), '要明确禁止瞎编');
  assert.ok(ins.includes('不会展示给用户'), '要说清这是内部标记');
});
