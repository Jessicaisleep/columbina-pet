/**
 * 分条回复（`./split-reply`）。
 *
 * 这一层的风险全在「解析」上：标记认错就切碎正文，条数超了如果直接截断就**丢字**。
 * 这里逐条钉住：不写标记就不拆、四种标记写法都认、超限时尾部并回（总字数不变）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPLIT_MARK, splitEnabledOf, splitInstruction, splitReply, stripSplitMarks } from './split-reply';

test('没有标记但只有一句 / 很短 → 一条（不该拆的别硬拆）', () => {
  assert.deepEqual(splitReply('今天外面下雨，我不太想出门。'), ['今天外面下雨，我不太想出门。']);
  assert.deepEqual(splitReply('好呀。'), ['好呀。']);
  assert.deepEqual(splitReply('嗯，我在。'), ['嗯，我在。']);
});

test('模型没写标记时按句末标点兜底拆（小模型实测常不守约）', () => {
  const text = '在整理工作区里的文件，顺手记了点东西。刚泡的茶还温着，就这么坐着。你要是忙完了，可以叫我。';
  const parts = splitReply(text);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts, [
    '在整理工作区里的文件，顺手记了点东西。',
    '刚泡的茶还温着，就这么坐着。',
    '你要是忙完了，可以叫我。',
  ]);
  // 兜底拆也不许改字：拼回去必须与原文逐字相同
  assert.equal(parts.join(''), text);
});

test('兜底拆只认句末标点，逗号不算（否则会切出「唔……」这种半句）', () => {
  const parts = splitReply('唔……那个，我想说的是，你今天好像有点累。要不先歇一会儿？');
  assert.deepEqual(parts, ['唔……那个，我想说的是，你今天好像有点累。', '要不先歇一会儿？']);
});

test('兜底拆超过上限时尾部并回，仍然不丢字', () => {
  const text = '第一句在这里放着。第二句也在这里。第三句还在。第四句最后一句。';
  const parts = splitReply(text, 3);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), text);
});

test('标记切三条，顺序与内容都不动', () => {
  const parts = splitReply(`今天外面下雨${SPLIT_MARK}我不太想出门${SPLIT_MARK}你要不要也歇一会儿`);
  assert.deepEqual(parts, ['今天外面下雨', '我不太想出门', '你要不要也歇一会儿']);
});

test('全角与别名写法都认（模型偶尔写【分】或[分条]）', () => {
  assert.deepEqual(splitReply('第一句【分】第二句'), ['第一句', '第二句']);
  assert.deepEqual(splitReply('第一句[分条]第二句'), ['第一句', '第二句']);
  assert.deepEqual(splitReply('第一句【分条】第二句'), ['第一句', '第二句']);
});

test('连着写两个标记 → 空串被丢掉，不留空气泡', () => {
  assert.deepEqual(splitReply(`一${SPLIT_MARK}${SPLIT_MARK}二`), ['一', '二']);
});

test('只有标记没有正文 → 空数组（调用方据此判断生成结果不可用）', () => {
  assert.deepEqual(splitReply(`${SPLIT_MARK}${SPLIT_MARK}`), []);
  assert.deepEqual(splitReply('   '), []);
});

test('超过上限时尾部并回最后一条，总字数一字不差', () => {
  const text = `一${SPLIT_MARK}二${SPLIT_MARK}三${SPLIT_MARK}四${SPLIT_MARK}五`;
  const parts = splitReply(text, 3);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts, ['一', '二', '三 四 五']);
  // 关键约束：宁可长一点也不能丢字（拿掉标记与空格后应与原文一致）
  const squeeze = (s: string): string => s.split(SPLIT_MARK).join('').replace(/ /g, '');
  assert.equal(squeeze(parts.join(SPLIT_MARK)), '一二三四五');
});

test('max 非法（0 / 负数 / 小数）时仍至少给出一条，不返回空', () => {
  assert.deepEqual(splitReply(`一${SPLIT_MARK}二`, 0), ['一 二']);
  assert.deepEqual(splitReply(`一${SPLIT_MARK}二`, -3), ['一 二']);
});

test('stripSplitMarks 只删标记、不拆条（助手分支不让标记漏给用户）', () => {
  assert.equal(stripSplitMarks(`一${SPLIT_MARK}二`), '一 二');
  assert.equal(stripSplitMarks('没有标记'), '没有标记');
});

test('拆条指令带上标记本身（模型得知道写什么）', () => {
  const s = splitInstruction();
  assert.ok(s.includes(SPLIT_MARK));
  // 必须写清「本来就一句话就别拆」——不分场合硬拆比不拆更像机器
  assert.ok(s.includes('一条'));
});

test('分条开关：缺键 = 开，只有显式 false 才关', () => {
  assert.equal(splitEnabledOf(undefined), true);
  assert.equal(splitEnabledOf({}), true);
  assert.equal(splitEnabledOf({ chatSplitEnabled: true }), true);
  assert.equal(splitEnabledOf({ chatSplitEnabled: false }), false);
});
