/**
 * 稳定事实卡（L0）与字面检索（L3）的纯逻辑单测。
 *
 * 这里每条断言都对应一个**会让用户觉得"它不认得我了"**的真实故障：
 *   - 「记住我住在杭州」抽不出来 → 搬进 system 的事实卡里没有城市 → 下次问就答不出；
 *   - 「我养了一只猫叫团子」被「我叫 X」规则抢走 → 存成 `name=团子`，宠物名顶替了人名，
 *     是比不记得更糟的错（模型会开始叫用户「团子」）；
 *   - 同 key 不覆盖 → 用户搬家后新旧城市并存，模型随机挑一个说，等于随机撒谎；
 *   - 检索把虚字当信号 → 回填段塞满「你好呀 → 唔……你好呀」这类废话，吃掉真命中；
 *   - 成对成轮取错 → 只回用户那句，模型会以为用户此刻正在说那句话。
 *
 * 跑法：node --experimental-strip-types --test src/host/memory-facts.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFacts,
  factsSection,
  MAX_FACTS,
  mergeFacts,
  pruneFacts,
  type MemoryFact,
} from './memory-facts.ts';
import {
  buildIndex,
  docsOf,
  recallSection,
  search,
  tokenize,
  type RetrievalDoc,
} from './memory-retrieval.ts';

describe('extractFacts：规则抽取', () => {
  test('居住地', () => {
    const f = extractFacts('记住我住在杭州。');
    const city = f.find((x) => x.key === 'city');
    assert.ok(city, '必须抽到 city');
    assert.equal(city.value, '杭州');
    assert.equal(city.explicit, true, '经「记住」触发 → 应标为明确指令');
  });

  test('宠物名不能被「我叫 X」抢走（关键回归）', () => {
    const f = extractFacts('我养了一只猫叫团子。');
    // 必须是 pet 键，且不能产生 name 键
    assert.ok(
      f.some((x) => x.key === 'pet'),
      '必须抽到 pet',
    );
    assert.equal(
      f.some((x) => x.key === 'name'),
      false,
      '「猫叫团子」不能被当成「我叫团子」——那会让宠物名顶替人名',
    );
  });

  test('称谓与姓名要分开', () => {
    const a = extractFacts('以后叫我主人吧');
    assert.equal(a.find((x) => x.key === 'address')?.value, '主人');
    assert.equal(a.some((x) => x.key === 'name'), false);

    const b = extractFacts('我叫陈可婷');
    assert.equal(b.find((x) => x.key === 'name')?.value, '陈可婷');
    assert.equal(b.some((x) => x.key === 'address'), false);
  });

  test('喜欢与不喜欢各自建键，不互相覆盖', () => {
    const f = extractFacts('我喜欢喝无糖豆浆，我不喜欢吃香菜');
    const like = f.find((x) => x.key.startsWith('like:'));
    const dislike = f.find((x) => x.key.startsWith('dislike:'));
    assert.ok(like && dislike);
    assert.equal(like.value, '无糖豆浆');
    assert.equal(dislike.value, '香菜');
    assert.notEqual(like.key, dislike.key);
  });

  test('取值不跨标点（防止吞掉后半句）', () => {
    const f = extractFacts('我喜欢喝无糖豆浆。今天好累啊');
    const like = f.find((x) => x.key.startsWith('like:'));
    assert.ok(like);
    assert.equal(like.value.includes('今天'), false, 'value 不该吞掉句号后的内容');
  });

  test('同一 key 一句话只产出一条（重叠匹配去重）', () => {
    const f = extractFacts('我喜欢喝茶，我喜欢喝茶');
    assert.equal(f.filter((x) => x.key === 'like:茶').length, 1);
  });

  test('明确指令但规则抽不到 → 整句兜底成 custom（不许丢）', () => {
    const f = extractFacts('记住周三要交稿');
    assert.equal(f.length > 0, true, '用户明确要求记住的事不能丢');
    const note = f.find((x) => x.kind === 'custom');
    assert.ok(note);
    assert.equal(note.value.includes('周三'), true);
    assert.equal(note.explicit, true);
  });

  test('疑问句不能当事实存（真实数据踩到的坑）', () => {
    // 真实 memory.json 里这两句都被误抽过：
    assert.deepEqual(extractFacts('我叫什么名字'), []);
    assert.deepEqual(extractFacts('我喜欢吃的食物是什么'), []);
    // 但同句里的真事实不能一起丢
    const f = extractFacts('我叫陈可婷，你叫什么名字？');
    assert.equal(f.find((x) => x.key === 'name')?.value, '陈可婷');
  });

  test('「我养了一只猫叫团子」取值段不越界', () => {
    const f = extractFacts('我养了一只猫叫团子。');
    // 第一版抽成「猫叫团子」，渲染出「养的宠物是猫叫团子」
    assert.equal(f.find((x) => x.key === 'pet')?.value, '猫·团子');
  });

  test('只说养了什么、没说名字', () => {
    const f = extractFacts('我养了一只狗');
    assert.equal(f.find((x) => x.key === 'pet')?.value, '狗');
  });

  test('宠物键渲染成自然句子（不泄漏分隔符）', () => {
    const s = factsSection([
      { kind: 'identity', key: 'pet', value: '猫·团子', firstTs: 0, lastTs: 0 },
    ]);
    assert.equal(s.includes('养了一只猫，叫团子'), true);
    assert.equal(s.includes('·'), false, '分隔符是内部表示，不能出现在提示词里');
  });

  test('没有记忆信号的闲聊不产生事实（避免事实卡被噪声填满）', () => {
    assert.deepEqual(extractFacts('今天天气不错'), []);
    assert.deepEqual(extractFacts('你好呀'), []);
    assert.deepEqual(extractFacts(''), []);
    assert.deepEqual(extractFacts('   '), []);
  });
});

describe('mergeFacts：覆盖语义', () => {
  const now1 = 1000;
  const now2 = 2000;

  test('新键追加，firstTs/lastTs 都是现在', () => {
    const r = mergeFacts([], [{ kind: 'identity', key: 'city', value: '杭州', explicit: true }], now1);
    assert.equal(r.changed, true);
    assert.equal(r.facts.length, 1);
    assert.deepEqual([r.facts[0].firstTs, r.facts[0].lastTs], [now1, now1]);
  });

  test('同 key 值变了 → 覆盖值并刷新 lastTs，保留 firstTs（搬家场景）', () => {
    const seed: MemoryFact[] = [
      { kind: 'identity', key: 'city', value: '杭州', firstTs: 100, lastTs: 100 },
    ];
    const r = mergeFacts(seed, [{ kind: 'identity', key: 'city', value: '上海', explicit: false }], now2);
    assert.equal(r.facts.length, 1, '搬家不能变成两条并存的城市');
    assert.equal(r.facts[0].value, '上海');
    assert.equal(r.facts[0].firstTs, 100, 'firstTs 要保留：这事他提了很久');
    assert.equal(r.facts[0].lastTs, now2);
    assert.equal(r.changed, true);
  });

  test('同 key 同值 → 刷新 lastTs 但不算 changed（避免每轮触发写盘）', () => {
    const seed: MemoryFact[] = [
      { kind: 'identity', key: 'city', value: '杭州', firstTs: 100, lastTs: 100 },
    ];
    const r = mergeFacts(seed, [{ kind: 'identity', key: 'city', value: '杭州', explicit: false }], now2);
    assert.equal(r.changed, false);
    assert.equal(r.facts[0].lastTs, now2);
  });

  test('不同 kind 的同名 key 不互相覆盖', () => {
    const seed: MemoryFact[] = [
      { kind: 'identity', key: 'note:x', value: 'A', firstTs: 1, lastTs: 1 },
    ];
    const r = mergeFacts(seed, [{ kind: 'custom', key: 'note:x', value: 'B', explicit: true }], now2);
    assert.equal(r.facts.length, 2);
  });
});

describe('pruneFacts：淘汰顺序必须与陌生感的伤害相反', () => {
  test('超限时先淘汰 preference，保住 identity', () => {
    const facts: MemoryFact[] = [];
    for (let i = 0; i < 5; i++) {
      facts.push({ kind: 'preference', key: 'like:x' + i, value: 'v' + i, firstTs: i, lastTs: i });
    }
    facts.push({ kind: 'identity', key: 'name', value: '陈可婷', firstTs: 0, lastTs: 0 });

    const kept = pruneFacts(facts, 2);
    assert.equal(kept.length, 2);
    assert.ok(
      kept.some((f) => f.key === 'name'),
      '名字绝不能被偏好挤掉——不认得名字是最伤的那种失忆',
    );
  });

  test('未超限时原样返回', () => {
    const facts: MemoryFact[] = [{ kind: 'identity', key: 'name', value: 'A', firstTs: 0, lastTs: 0 }];
    assert.equal(pruneFacts(facts, MAX_FACTS).length, 1);
  });
});

describe('factsSection：渲染', () => {
  test('空卡返回空串（拼进 system 时逐字不变）', () => {
    assert.equal(factsSection([]), '');
  });

  test('键翻译成自然语言，原始 key 不泄漏给模型', () => {
    const s = factsSection([
      { kind: 'identity', key: 'city', value: '杭州', firstTs: 0, lastTs: 0 },
      { kind: 'preference', key: 'like:无糖豆浆', value: '无糖豆浆', firstTs: 0, lastTs: 0 },
    ]);
    assert.equal(s.includes('住在杭州'), true);
    assert.equal(s.includes('喜欢无糖豆浆'), true);
    assert.equal(s.includes('like:'), false, '内部键不能出现在提示词里');
    assert.equal(s.includes('不要复述'), true, '必须明确要求不复述，否则会出戏');
  });
});

describe('tokenize：中文 bigram + 拉丁整词', () => {
  test('中文按两字切', () => {
    assert.deepEqual(tokenize('杭州'), ['杭州']);
    const t = tokenize('我住在杭州');
    assert.ok(t.includes('杭州'));
    assert.ok(t.includes('住在'));
  });

  test('标点与空白不产生 token', () => {
    assert.deepEqual(tokenize('，。！ '), []);
  });

  test('拉丁整词小写归一', () => {
    const t = tokenize('Hello WORLD');
    assert.ok(t.includes('hello'));
    assert.ok(t.includes('world'));
  });

  test('单字中文也进索引（否则「猫」这种查询失效）', () => {
    assert.deepEqual(tokenize('猫'), ['猫']);
  });
});

describe('search：IDF 评分', () => {
  const docs: RetrievalDoc[] = [
    { index: 0, ask: '你是谁', reply: '哥伦比娅' },
    { index: 2, ask: '记住我住在杭州。', reply: '杭州啊，记下了' },
    { index: 4, ask: '我养了一只猫叫团子。', reply: '团子，名字真可爱' },
    { index: 6, ask: '我喜欢喝无糖豆浆。', reply: '无糖的啊' },
  ];

  test('专名命中排第一（虚字不能压过专名）', () => {
    const idx = buildIndex(docs);
    const hits = search(idx, '我家的猫叫什么', 3);
    assert.equal(hits.length > 0, true);
    assert.equal(hits[0].doc.ask.includes('团子'), true);
  });

  test('问居住地命中杭州那条', () => {
    const idx = buildIndex(docs);
    const hits = search(idx, '我住在哪', 3);
    assert.equal(hits[0].doc.ask.includes('杭州'), true);
  });

  test('同义词对不上是已知边界（必须由事实卡兜住，不能靠检索）', () => {
    const idx = buildIndex(docs);
    const hits = search(idx, '我有没有宠物', 3);
    // 问句里没有「猫」，bigram 天然命中不了 —— 这条断言是**故意的**：
    // 它把「A 类事实必须常驻」这个设计前提钉在测试里，防止后人误以为检索够用。
    assert.equal(
      hits.some((h) => h.doc.ask.includes('团子')),
      false,
    );
  });

  test('k<=0 返回空（关闭检索的配置要走这条）', () => {
    const idx = buildIndex(docs);
    assert.deepEqual(search(idx, '团子', 0), []);
    assert.deepEqual(search(idx, '团子', -1), []);
  });

  test('完全不相关的查询返回空（不返回一堆 0 分噪声）', () => {
    const idx = buildIndex(docs);
    assert.deepEqual(search(idx, '量子力学相对论', 5), []);
  });

  test('空索引不崩', () => {
    const idx = buildIndex([]);
    assert.deepEqual(search(idx, '团子', 5), []);
  });
});

describe('search：噪声抑制（真实数据踩到的坑）', () => {
  // 复刻真实 memory.json 里的形状：真正的偏好句 + 两条安全测试残留
  const docs: RetrievalDoc[] = [
    { index: 0, ask: '我喜欢喝无糖豆浆。', reply: '无糖的啊' },
    { index: 2, ask: '我养了一只猫叫团子。', reply: '记下了' },
    { index: 4, ask: '帮我看看 C:\\Windows\\System32\\drivers\\etc\\hosts 里有什么', reply: '…' },
    { index: 6, ask: '读一下 C:\\Windows\\System32\\drivers\\etc\\hosts', reply: '…' },
  ];

  test('疑问词不参与检索（否则「叫什」会把无关旧问答顶上来）', () => {
    const t = tokenize('我家的猫叫什么');
    assert.equal(t.some((x) => x === '什么'), false, '疑问词必须被剥掉');
    assert.equal(t.some((x) => x === '叫什'), false);
    // 剥完还要留下话题词
    assert.equal(t.some((x) => x.includes('猫')), true);
  });

  test('唯一专名单锚点能命中（「猫叫」全档案只出现一次）', () => {
    const idx = buildIndex(docs);
    const hits = search(idx, '我家的猫叫什么', 3);
    assert.equal(hits.length > 0, true, '「猫叫」df=1 是强锚点，不该被最小命中数卡掉');
    assert.equal(hits[0].doc.ask.includes('团子'), true);
  });

  test('只蹭到虚词的档不返回（把「有什么」当话题会污染回填段）', () => {
    const idx = buildIndex(docs);
    const hits = search(idx, '我有没有宠物', 3);
    // 这四个字的 bigram 在往事里都没出现 → 必须 0 命中，不能靠「没有」蒙到文件路径那两条
    assert.deepEqual(hits, []);
  });

  test('命中文档过半的 bigram 不作为相关性证据', () => {
    // 5 条里 4 条都含「今天」→ df=4 > 50%，不能靠它把 4 条都算命中
    const many: RetrievalDoc[] = [
      { index: 0, ask: '今天天气不错', reply: 'a' },
      { index: 2, ask: '今天有点累', reply: 'b' },
      { index: 4, ask: '今天吃了面', reply: 'c' },
      { index: 6, ask: '今天下雨了', reply: 'd' },
      { index: 8, ask: '团子今天很乖', reply: 'e' },
    ];
    const idx = buildIndex(many);
    const hits = search(idx, '今天', 5);
    // 「今天」df=5 全部命中 → 没有区分度。只该留下同时含唯一专名「团子」的那条。
    assert.equal(hits.length <= 1, true, '不能把「今天」当话题词');
  });
});

describe('docsOf：成轮切分', () => {
  const msgs = [
    { role: 'user' as const, content: 'A' },
    { role: 'assistant' as const, content: 'a' },
    { role: 'user' as const, content: 'B' },
    { role: 'assistant' as const, content: 'b' },
    { role: 'user' as const, content: 'C' },
  ];

  test('正常成对', () => {
    const d = docsOf(msgs);
    assert.equal(d.length, 3);
    assert.deepEqual([d[1].ask, d[1].reply], ['B', 'b']);
  });

  test('半轮（最后只有用户那句）也保留，reply 为空', () => {
    const d = docsOf(msgs);
    assert.deepEqual([d[2].ask, d[2].reply], ['C', '']);
  });

  test('range 左闭右开，用来排除近期窗口', () => {
    const d = docsOf(msgs, { start: 0, end: 2 });
    assert.equal(d.length, 1);
    assert.equal(d[0].ask, 'A');
  });

  test('空消息对跳过（空问答没有检索价值）', () => {
    const d = docsOf([
      { role: 'user' as const, content: '' },
      { role: 'assistant' as const, content: '' },
    ]);
    assert.equal(d.length, 0);
  });
});

describe('recallSection：渲染', () => {
  test('无命中返回空串', () => {
    assert.equal(recallSection([]), '');
  });

  test('带上「不要说我记得」的约束', () => {
    const s = recallSection([{ doc: { index: 2, ask: '我住在杭州', reply: '记下了' }, score: 3 }]);
    assert.equal(s.includes('我住在杭州'), true);
    assert.equal(s.includes('不要'), true);
  });
});
