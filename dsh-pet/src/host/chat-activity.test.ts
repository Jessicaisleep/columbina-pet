import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAT_QUIET_MS, ChatActivity, chatQuiet } from './chat-activity.ts';

test('chatQuiet：从没说过话 → 不静默（冷启动照常碎碎念）', () => {
  assert.equal(chatQuiet(undefined, 1_000_000), false);
});

test('chatQuiet：刚说过话 → 静默', () => {
  assert.equal(chatQuiet(1_000_000, 1_000_000), true);
});

test('chatQuiet：边界——恰好 CHAT_QUIET_MS 时已解除（与 > 语义一致）', () => {
  assert.equal(chatQuiet(0, CHAT_QUIET_MS - 1), true);
  assert.equal(chatQuiet(0, CHAT_QUIET_MS), false);
  assert.equal(chatQuiet(0, CHAT_QUIET_MS + 1), false);
});

test('chatQuiet：时间回拨（lastTalkAt 在未来）→ 按刚说过处理', () => {
  assert.equal(chatQuiet(2_000_000, 1_000_000), true);
});

test('chatQuiet：非法读数不静默（不让坏数据永久哑掉碎碎念）', () => {
  assert.equal(chatQuiet(Number.NaN, 1_000_000), false);
  assert.equal(chatQuiet(1_000_000, Number.NaN), false);
  assert.equal(chatQuiet(Number.POSITIVE_INFINITY, 1_000_000), false);
});

test('chatQuiet：quietMs 可覆盖（0 表示不静默）', () => {
  assert.equal(chatQuiet(1_000_000, 1_000_000, 0), false);
  assert.equal(chatQuiet(1_000_000, 1_001_000, 5_000), true);
});

test('ChatActivity：note 之后进入静默窗，过期自动解除', () => {
  const a = new ChatActivity();
  assert.equal(a.quiet('p', 1_000_000), false, '没记过就不静默');
  a.note('p', 1_000_000);
  assert.equal(a.lastTalkAt('p'), 1_000_000);
  assert.equal(a.quiet('p', 1_000_000 + CHAT_QUIET_MS - 1), true);
  assert.equal(a.quiet('p', 1_000_000 + CHAT_QUIET_MS), false);
});

test('ChatActivity：按宠物隔离——一只在聊，另一只照常说', () => {
  const a = new ChatActivity();
  a.note('columbina1', 1_000_000);
  assert.equal(a.quiet('columbina1', 1_000_000), true);
  assert.equal(a.quiet('nahida1', 1_000_000), false);
});

test('ChatActivity：空 petId 不做记录（不污染表）', () => {
  const a = new ChatActivity();
  a.note('', 1_000_000);
  assert.equal(a.lastTalkAt(''), undefined);
  assert.equal(a.quiet('', 1_000_000), false);
});

test('ChatActivity：后来的 note 会刷新静默窗起点', () => {
  const a = new ChatActivity();
  a.note('p', 1_000_000);
  a.note('p', 1_100_000);
  assert.equal(a.lastTalkAt('p'), 1_100_000);
  assert.equal(a.quiet('p', 1_100_000 + CHAT_QUIET_MS - 1), true);
});
