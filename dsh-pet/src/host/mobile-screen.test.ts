/**
 * 手机读屏（`./mobile-screen`）。
 *
 * 这一层的价值全在「过期判定」与「不落盘」上：屏幕内容是**此刻环境**，不是历史。
 * 这里逐条钉住那几条约束，避免以后有人为了「多留点上下文」把 TTL 或截断改坏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOBILE_SCREEN_MAX_CHARS,
  MOBILE_SCREEN_TTL_MS,
  MobileScreenStore,
  mobileAsSnapshot,
  mobileScreenSection,
} from './mobile-screen';

test('收到内容后能取回，字数与包名都对', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ pkg: 'com.tencent.mm', text: '微信 | 张三 | 在吗' }, 1_000);
  assert.ok(snap);
  assert.equal(snap.pkg, 'com.tencent.mm');
  assert.equal(snap.chars, '微信 | 张三 | 在吗'.length);
  assert.equal(snap.at, 1_000);

  const fresh = store.fresh(1_000);
  assert.ok(fresh);
  assert.equal(fresh.text, '微信 | 张三 | 在吗');
});

test('超过 TTL 就不再新鲜（宁可当作没读到）', () => {
  const store = new MobileScreenStore();
  store.put({ text: '旧内容' }, 1_000);
  // 刚好到期仍算新鲜
  assert.ok(store.fresh(1_000 + MOBILE_SCREEN_TTL_MS));
  // 超过 1ms 就不算
  assert.equal(store.fresh(1_000 + MOBILE_SCREEN_TTL_MS + 1), undefined);
});

test('过期之后 status 仍能说清「有过但旧了」', () => {
  const store = new MobileScreenStore();
  store.put({ pkg: 'com.android.chrome', text: '一段文字' }, 1_000);
  const st = store.status(1_000 + MOBILE_SCREEN_TTL_MS * 3);
  // present 表示「有没有留着」，与 fresh 是两件事：诊断要看得出「收到过、但已过期」，
  // 否则用户会以为上传根本没到。
  assert.equal(st.present, true);
  assert.equal(st.chars, 4);
  assert.equal(st.pkg, 'com.android.chrome');
  assert.ok(st.ageMs > MOBILE_SCREEN_TTL_MS);
  // 但生成时不会用它
  assert.equal(store.fresh(1_000 + MOBILE_SCREEN_TTL_MS * 3), undefined);
});

test('空文本按「没读到」处理，并清掉旧的', () => {
  const store = new MobileScreenStore();
  store.put({ text: '有内容' }, 1_000);
  assert.ok(store.fresh(1_000));
  assert.equal(store.put({ text: '   ' }, 2_000), undefined);
  // 关键：不是留着一个旧快照继续用 —— 手机那边已经读不到了，宿主这边不该假装有。
  assert.equal(store.fresh(2_000), undefined);
  assert.equal(store.status(2_000).present, false);
});

test('超长文本在宿主侧截断（不信任外部输入长度）', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ text: 'x'.repeat(MOBILE_SCREEN_MAX_CHARS + 500) }, 1_000);
  assert.ok(snap);
  assert.equal(snap.chars, MOBILE_SCREEN_MAX_CHARS);
});

test('非字符串的 pkg/text 不炸，按缺失处理', () => {
  const store = new MobileScreenStore();
  // 外部输入什么都可能传：数字、null、对象。既不能抛，也不能把它当字符串拼进去。
  assert.equal(store.put({ pkg: 123, text: null }, 1_000), undefined);
  assert.equal(store.put({ pkg: {}, text: {} }, 1_000), undefined);
  const ok = store.put({ pkg: 456, text: '真文字' }, 1_000);
  assert.ok(ok);
  assert.equal(ok.pkg, '');
});

test('clear 之后彻底没有', () => {
  const store = new MobileScreenStore();
  store.put({ text: '私密内容' }, 1_000);
  store.clear();
  assert.equal(store.fresh(1_000), undefined);
  assert.equal(store.status(1_000).present, false);
});

test('多次上传只保留最近一次', () => {
  const store = new MobileScreenStore();
  store.put({ pkg: 'a', text: '第一条' }, 1_000);
  store.put({ pkg: 'b', text: '第二条' }, 2_000);
  const fresh = store.fresh(2_000);
  assert.ok(fresh);
  assert.equal(fresh.pkg, 'b');
  assert.equal(fresh.text, '第二条');
});

test('渲染的 prompt 段点名「这是手机」，并带上包名', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ pkg: 'com.tencent.mm', text: '微信 | 在吗' }, 1_000);
  assert.ok(snap);
  const section = mobileScreenSection(snap);
  // 抬头必须与桌面端同一个词，模型不用学第二种说法
  assert.match(section, /【用户此刻的屏幕】/);
  // 必须说清来源是手机：这决定了它该用手机语气还是电脑语气接话
  assert.match(section, /手机/);
  assert.match(section, /com\.tencent\.mm/);
  assert.match(section, /微信 \| 在吗/);
});

test('没有包名时也能渲染，不出现空括号', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ text: '只有文字' }, 1_000);
  assert.ok(snap);
  const section = mobileScreenSection(snap);
  assert.match(section, /【用户此刻的屏幕】（手机）/);
  assert.doesNotMatch(section, /（手机，前台应用 ）/);
});

test('适配成 ScreenSnapshot 供 read_screen 工具复用', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ pkg: 'com.tencent.mm', text: 'a | b | c' }, 1_000);
  assert.ok(snap);
  const view = mobileAsSnapshot(snap, 1_500);
  assert.equal(view.cls, 'mobile');
  assert.equal(view.title, 'com.tencent.mm');
  assert.equal(view.pieces, 3);
  assert.equal(view.ms, 500);
  // 手机快照不会是 stale —— 过期的那份 fresh() 根本不返回
  assert.equal(view.stale, false);
  assert.equal(view.truncated, false);
});

test('到达上限的文本在快照里标 truncated', () => {
  const store = new MobileScreenStore();
  const snap = store.put({ text: 'y'.repeat(MOBILE_SCREEN_MAX_CHARS) }, 1_000);
  assert.ok(snap);
  assert.equal(mobileAsSnapshot(snap, 1_000).truncated, true);
});
