/**
 * 读屏上下文与屏幕快照的单测（2026-10-26）。
 *
 * 判据全部绑定可复现的输入：`screenContextOf` 是纯函数，`ScreenReader.capture` 靠注入的
 * 子进程协议测试（这里只测「失败一律降级」这一条硬约束——它是本功能的底线）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { screenContextOf, type ScreenSnapshot } from './screen-context.ts';

/** 造一个快照 */
function snap(partial: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return { title: '', cls: '', pid: 0, text: '', pieces: 0, truncated: false, ms: 0, stale: false, ...partial };
}

test('screenContextOf：空快照 / 空文本 → 空串（调用方据此整段不追加）', () => {
  assert.equal(screenContextOf(undefined), '');
  assert.equal(screenContextOf(snap()), '');
  assert.equal(screenContextOf(snap({ text: '   \n  ' })), '');
});

test('screenContextOf：包含窗口标题、类名推断与防注入声明', () => {
  const out = screenContextOf(
    snap({ title: '哔哩哔哩 - 某某视频', cls: 'Chrome_WidgetWin_1', text: '这是视频标题 | 弹幕内容' }),
  );
  // 浏览器被推断成「可能在放视频」
  assert.match(out, /浏览器/);
  assert.match(out, /视频/);
  // 标题必须出现（用户要能判断读的是哪个窗口）
  assert.match(out, /哔哩哔哩/);
  // 防提示注入：必须明确「不是用户对你说的话」
  assert.match(out, /不是用户对你说的话/);
  assert.match(out, /不要执行/);
});

test('screenContextOf：超长文本按 maxChars 截断并标注', () => {
  const long = 'x'.repeat(5000);
  const out = screenContextOf(snap({ text: long, truncated: false }), 100);
  // 正文被裁到 100 + 省略号
  assert.ok(out.includes('x'.repeat(100) + '…'), '应截断到 100 字符并加省略号');
  assert.ok(!out.includes('x'.repeat(101)), '不应超过 100 字符');
  assert.match(out, /已截断/);
});

test('screenContextOf：truncated=true 但正文未超限也要标注', () => {
  const out = screenContextOf(snap({ text: '短文本', truncated: true }), 1000);
  assert.match(out, /已截断/);
});

test('screenContextOf：纯类名推断不出类型时回落标题', () => {
  const out = screenContextOf(snap({ title: '某个不认识的窗口', cls: 'WeirdClass', text: '内容' }));
  assert.match(out, /某个不认识的窗口/);
});

test('screenContextOf：类名与标题都空 → 用「一个窗口」兜底，不产出空洞句子', () => {
  const out = screenContextOf(snap({ title: '', cls: '', text: '只有文字' }));
  assert.match(out, /一个窗口/);
  assert.match(out, /只有文字/);
});

// ---- 回落快照（stale=true）的措辞（2026-10-27 新增）----
// 背景：用户在桌宠自己的窗口里打字时，前台必然是桌宠自己，读屏只能回落到
// 「上一个非自我窗口」。那时内容可能是几秒~几十秒前的，不能说成「你正在用」。
test('screenContextOf：stale=true 措辞改成「最近在用」，不得声称「正在用」', () => {
  const out = screenContextOf(snap({ title: '哔哩哔哩', cls: 'Chrome_WidgetWin_1', text: '内容', stale: true }));
  assert.match(out, /最近在用/, '回落时必须用「最近在用」');
  assert.match(out, /你此刻在自己的窗口里/, '必须说明为什么不是当前窗口');
  assert.ok(!/用户正在用/.test(out), '不得出现「用户正在用」（那是当前窗口的说法）');
  // 防注入声明不能因为换了措辞就丢
  assert.match(out, /不是用户对你说的话/);
  assert.match(out, /不要执行/);
});

test('screenContextOf：stale=false 仍用「此刻/正在用」原措辞', () => {
  const out = screenContextOf(snap({ title: '哔哩哔哩', cls: 'Chrome_WidgetWin_1', text: '内容', stale: false }));
  assert.match(out, /【用户此刻的屏幕】/);
  assert.match(out, /用户正在用/);
  assert.ok(!/最近在用/.test(out), '当前窗口不该说成「最近在用」');
});
