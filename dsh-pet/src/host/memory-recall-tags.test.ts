/**
 * 标签检索路（`searchByTags` + `wantedTags`）的单测。
 *
 * 为什么单独一张：这条路的输入是**自然语言问句**，输出是「该回忆哪几条」——
 * 它连着两个方向的错，都会直接变成用户能听出来的事故：
 *   - 该想起来没想起来（问"开心的事"，答不出三天前那句"今天赢了三把"）；
 *   - 不该想起来的硬塞进来（问"今天天气怎么样"，把上周所有天气闲聊倒一遍）。
 * 所以每条断言都钉一个**具体问句 → 具体召回集**，而不是只测函数能跑不报错。
 *
 * 跑法：node --experimental-strip-types --test src/host/memory-recall-tags.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { searchByTags, wantedTags, type RetrievalDoc } from './memory-retrieval.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 28, 2, 0, 0);

/** 造一条往事：`ask` 是用户原话，`at` 是相对 T0 的小时数（越大越新） */
function doc(ask: string, at: number, extra: Partial<RetrievalDoc> = {}): RetrievalDoc {
  return { index: at * 2, ask, reply: '唔……', ts: T0 + at * HOUR, ...extra };
}

/** 用一批真实口吻的往事当素材：这是用户 10 月底那几天的真实说法 */
function corpus(): RetrievalDoc[] {
  return [
    doc('今天出门看见一只狗狗好可爱', 1), // 宠物+出门 pos emotion
    doc('这个 bug 改了三遍了还没好，好烦', 2), // 工作 neg emotion
    doc('今天天气不错啊', 3), // 天气 pos
    doc('晚上想吃火锅', 4), // 吃饭 neutral
    doc('今天赢了三把', 5), // 游戏 pos
    doc('明天下午要开个会', 6), // 工作 neutral plan
    doc('猫又把水杯打翻了', 7), // 宠物 neutral
  ];
}

describe('searchByTags：按标签捞往事', () => {
  test('情绪路：问"开心的事"能捞回没提过"开心"两个字的那几条', () => {
    // 这是整条路存在的理由：原文是"好可爱""赢了三把"，和"开心"一个字都不重合。
    const hits = searchByTags(corpus(), { mood: 'pos' }, 10);
    const asks = hits.map((h) => h.doc.ask);
    assert.ok(asks.includes('今天赢了三把'), '漏了「今天赢了三把」');
    assert.ok(asks.includes('今天出门看见一只狗狗好可爱'), '漏了「好可爱」那条');
    assert.ok(asks.includes('今天天气不错啊'), '漏了「天气不错」');
  });

  test('情绪路：问"烦心的"不会把开心的混进来', () => {
    const hits = searchByTags(corpus(), { mood: 'neg' }, 10);
    const asks = hits.map((h) => h.doc.ask);
    assert.deepEqual(asks, ['这个 bug 改了三遍了还没好，好烦']);
  });

  test('主题路：问关于猫狗的，能捞回两条宠物（同一个类目跨不同说法）', () => {
    const hits = searchByTags(corpus(), { topics: ['宠物'] }, 10);
    const asks = hits.map((h) => h.doc.ask);
    assert.ok(asks.includes('今天出门看见一只狗狗好可爱'));
    assert.ok(asks.includes('猫又把水杯打翻了'));
    assert.equal(asks.length, 2, '宠物类目只有这两条，多出来就是越界召回');
  });

  test('多标签加权：主题 + 情绪都对上的排在最前（"好可爱"比"天气不错"更贴"开心"）', () => {
    // 同为 pos，但「狗狗好可爱」还命中"宠物"主题 → 2(主题) + 2(情绪) = 4；
    // 「天气不错」没有传入的主题 → 只有 2。
    const hits = searchByTags(corpus(), { topics: ['宠物'], mood: 'pos' }, 10);
    assert.equal(hits[0]?.doc.ask, '今天出门看见一只狗狗好可爱', '多标签同命的应排第一');
    assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0), '分数必须真的拉开，不是靠排序偶然');
  });

  test('命中两个主题加分更多：一条同时沾两个类目的往事优先', () => {
    const docs = [
      doc('今天天气不错啊', 1), // 只有 天气
      doc('出门散步，天气很好', 2), // 出门 + 天气
    ];
    const hits = searchByTags(docs, { topics: ['天气', '出门'] }, 10);
    assert.equal(hits[0]?.doc.ask, '出门散步，天气很好');
  });

  test('同分按时间新的靠前（问"最近"时，越近越可能是他要的那次）', () => {
    const hits = searchByTags(corpus(), { mood: 'pos' }, 10);
    const ts = hits.map((h) => h.doc.ts ?? 0);
    const sameScoreOrder = ts.every((v, i) => i === 0 || v <= ts[i - 1]!);
    assert.ok(sameScoreOrder, '同一档分数内必须从新到旧');
  });

  test('没有 ts 的往事排在后面：不能假装它是刚发生的', () => {
    const docs: RetrievalDoc[] = [
      { index: 0, ask: '今天赢了三把', reply: '厉害' }, // 无 ts
      { index: 2, ask: '今天天气不错啊', reply: '是呀', ts: T0 },
    ];
    const hits = searchByTags(docs, { mood: 'pos' }, 10);
    assert.equal(hits[0]?.doc.ask, '今天天气不错啊');
  });

  test('limit 生效，且非法 limit 退回默认值而不是返回空', () => {
    assert.equal(searchByTags(corpus(), { mood: 'pos' }, 1).length, 1);
    assert.ok(searchByTags(corpus(), { mood: 'pos' }, 0).length > 0, 'limit=0 不该是空');
    assert.ok(searchByTags(corpus(), { mood: 'pos' }, Number.NaN).length > 0);
  });

  test('空条件 / 空库 / 非数组 一律返回空数组，不抛', () => {
    assert.deepEqual(searchByTags(corpus(), {}, 10), []);
    assert.deepEqual(searchByTags([], { mood: 'pos' }, 10), []);
    assert.deepEqual(searchByTags(undefined as unknown as RetrievalDoc[], { mood: 'pos' }, 10), []);
    assert.deepEqual(searchByTags(corpus(), undefined as unknown as { mood: 'pos' }, 10), []);
  });

  test('AI 补标优先于词典：模型说它是"感情"，就不按词典的"宠物"算', () => {
    // mergeTags 的口径：AI 给了 topics 就用 AI 的（AI 看到了词典没收录的说法）。
    const d = doc('团子今天一直蹭我', 1, {
      aiTags: { topics: ['感情'], mood: 'pos', kind: 'statement' },
    });
    assert.equal(searchByTags([d], { topics: ['宠物'] }, 5).length, 0, '词典标签应被 AI 覆盖');
    assert.equal(searchByTags([d], { topics: ['感情'] }, 5).length, 1);
    assert.equal(searchByTags([d], { mood: 'pos' }, 5).length, 1);
  });
});

describe('wantedTags：从问句反推"他想找什么"', () => {
  test('问"开心的事"→ mood=pos（核心用例）', () => {
    assert.deepEqual(wantedTags('我最近有什么开心的事'), { mood: 'pos' });
    assert.deepEqual(wantedTags('说说高兴的事吧'), { mood: 'pos' });
  });

  test('问"烦心的"→ mood=neg；"不开心"不能被"开心"抢走', () => {
    assert.deepEqual(wantedTags('最近有点烦心'), { mood: 'neg' });
    // 「不开心」里含「开心」，正则顺序错了就会判成 pos——这是最典型的一处坑。
    assert.equal(wantedTags('最近有没有不开心的事')?.mood, 'neg', '「不开心」必须判 neg');
  });

  test('陈述当下心情时**不**翻旧账（他要的是安慰，不是档案）', () => {
    // 这两条是真人会说的话，绝不是"在盘点往事"。翻了反而像在炫耀。
    assert.equal(wantedTags('我今天不开心'), undefined);
    assert.equal(wantedTags('我好烦'), undefined);
    assert.equal(wantedTags('今天好开心'), undefined);
  });

  test('提到主题 + 翻旧账口气 → topics 生效', () => {
    const got = wantedTags('上次说的那只狗狗怎么样了');
    assert.ok(got?.topics?.includes('宠物'), '应识别出宠物主题');
  });

  test('只提主题、没有翻旧账口气 → 不走标签路（这是在问窗外，不是问记忆）', () => {
    // 实测不加这条，问"今天天气怎么样"会把一堆旧天气记录塞进回填段。
    assert.equal(wantedTags('今天天气怎么样'), undefined);
    assert.equal(wantedTags('今天吃什么'), undefined);
    assert.equal(wantedTags('你好呀'), undefined);
  });

  test('翻了旧账但没主题没情绪 → undefined，退回普通关键词检索', () => {
    assert.equal(wantedTags('我之前说过什么来着'), undefined);
    assert.equal(wantedTags('你还记得吗'), undefined);
  });

  test('主题与情绪同时给出（既翻旧账又提到狗）', () => {
    const got = wantedTags('上次那只狗狗你还有印象吗，说起来还挺开心的');
    assert.equal(got?.mood, 'pos');
    assert.ok(got?.topics?.includes('宠物'));
  });

  test('空串 / 非字符串 / 纯空白 → undefined，不抛', () => {
    assert.equal(wantedTags(''), undefined);
    assert.equal(wantedTags('   '), undefined);
    assert.equal(wantedTags(undefined as unknown as string), undefined);
    assert.equal(wantedTags(null as unknown as string), undefined);
  });

  test('日常应答词不能被当成查档案（"好"字单独出现不收）', () => {
    // 词典故意不收单独的"好"，就是为了不把「好，我这就去」判成 pos。
    assert.equal(wantedTags('好，我这就去'), undefined);
    assert.equal(wantedTags('嗯嗯'), undefined);
  });
});
