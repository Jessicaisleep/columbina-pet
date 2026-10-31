import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAY_LOOKS, normalizeSayOrigin, sayLook } from './bubble-kind';

test('normalizeSayOrigin：只认 whisper / proactive，其余一律 note', () => {
  assert.equal(normalizeSayOrigin('whisper'), 'whisper');
  assert.equal(normalizeSayOrigin('proactive'), 'proactive');
  // 老 host 不写 origin、脏值、null/undefined 全部回落 note（改造前的样子）
  assert.equal(normalizeSayOrigin('note'), 'note');
  assert.equal(normalizeSayOrigin(undefined), 'note');
  assert.equal(normalizeSayOrigin(null), 'note');
  assert.equal(normalizeSayOrigin(''), 'note');
  assert.equal(normalizeSayOrigin('reply'), 'note');
  assert.equal(normalizeSayOrigin(123), 'note');
  assert.equal(normalizeSayOrigin({ origin: 'whisper' }), 'note');
});

test('sayLook 直接返回取值表里的那一项（同一个对象，不做拷贝）', () => {
  assert.equal(sayLook('whisper'), SAY_LOOKS.whisper);
  assert.equal(sayLook('proactive'), SAY_LOOKS.proactive);
  assert.equal(sayLook('whatever'), SAY_LOOKS.note);
});

test('取值表只有三项，且 origin 字段与键一致', () => {
  assert.deepEqual(Object.keys(SAY_LOOKS).sort(), ['note', 'proactive', 'whisper']);
  for (const [key, look] of Object.entries(SAY_LOOKS)) assert.equal(look.origin, key);
});

test('两种"她说话"的小标题非空、互不相同；普通提示没有小标题', () => {
  assert.notEqual(SAY_LOOKS.proactive.label, '');
  assert.notEqual(SAY_LOOKS.whisper.label, '');
  assert.notEqual(SAY_LOOKS.proactive.label, SAY_LOOKS.whisper.label);
  // 普通提示保持改造前的样子：不加小标题、不加档位类（三端都按 tone==='plain' 判）
  assert.equal(SAY_LOOKS.note.label, '');
  assert.equal(SAY_LOOKS.note.tone, 'plain');
});

test('停留时长：碎碎念自己走（4000），主动聊天不走（0，等你回话），提示 10000', () => {
  assert.equal(SAY_LOOKS.whisper.holdMs, 4000);
  assert.equal(SAY_LOOKS.proactive.holdMs, 0);
  assert.equal(SAY_LOOKS.note.holdMs, 10000);
  // 碎碎念必须比提示短：它是背景音，不能占着屏幕比你还要看的东西久
  assert.ok(SAY_LOOKS.whisper.holdMs < SAY_LOOKS.note.holdMs);
});

test('只有主动聊天抢输入框、挂通知——碎碎念不能打扰正在输入的用户', () => {
  assert.equal(SAY_LOOKS.proactive.focusInput, true);
  assert.equal(SAY_LOOKS.proactive.notify, true);
  for (const k of ['whisper', 'note'] as const) {
    assert.equal(SAY_LOOKS[k].focusInput, false);
    assert.equal(SAY_LOOKS[k].notify, false);
  }
});

test('三端的档位名只能是 murmur / calling / plain（手机页与悬浮窗各自拼 CSS 类名）', () => {
  const tones = new Set(['murmur', 'calling', 'plain']);
  for (const look of Object.values(SAY_LOOKS)) assert.ok(tones.has(look.tone), look.tone);
  // 两种"她说话"必须是不同档位，否则用户看不出区别——这就是这个功能存在的理由
  assert.notEqual(SAY_LOOKS.proactive.tone, SAY_LOOKS.whisper.tone);
});
