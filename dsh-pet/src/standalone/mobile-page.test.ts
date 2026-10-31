import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SAY_LOOKS, type SayLook } from '../shared/bubble-kind';
import { mobileScript } from './mobile-page';

// 手机页与安卓悬浮窗都是**纯字符串模板**（不能 import TS），所以各自抄了一份
// 「来意 → 长相」的字面量。这个测试把三份钉在一起：谁改了 shared/bubble-kind.ts
// 而忘了改那两处，这里立刻红。改口径只改这一张表，别在模板里另写数字。

/** 从模板字符串里抠出一个 `var NAME = {...};` 的 JSON 字面量 */
function pickObject(source: string, name: string): Record<string, unknown> {
  const start = source.indexOf(' ' + name + '=');
  const start2 = source.indexOf(' ' + name + ' =');
  const at = start >= 0 ? start : start2;
  assert.ok(at >= 0, '模板里找不到 ' + name);
  const braceAt = source.indexOf('{', at);
  assert.ok(braceAt > at, name + ' 后面没有对象字面量');
  let depth = 0;
  for (let i = braceAt; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const raw = source.slice(braceAt, i + 1);
        // 悬浮窗那份是 JS 源码（单引号 + 裸键名 + 尾逗号），补齐成合法 JSON 再解析
        const json = raw
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
          .replace(/'/g, '"')
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(json) as Record<string, unknown>;
      }
    }
  }
  throw new Error(name + ' 的对象没有闭合');
}

/** 取值表 → 模板里该长成的样子（只比对三端都用到的四个字段） */
function expectShape(look: SayLook): Record<string, unknown> {
  // 三端都用得到的三个字段（手机页还多一个 focus，单独断言，因为悬浮窗不需要它）
  return { label: look.label, tone: look.tone, hold: look.holdMs };
}

test('手机页的 SAY_LOOK 与 shared/bubble-kind.ts 逐字段相等', () => {
  const got = pickObject(mobileScript, 'SAY_LOOK');
  assert.deepEqual(Object.keys(got).sort(), ['note', 'proactive', 'whisper']);
  for (const k of ['proactive', 'whisper', 'note'] as const) {
    const cell = got[k] as Record<string, unknown>;
    assert.deepEqual(
      { label: cell.label, tone: cell.tone, hold: cell.hold },
      expectShape(SAY_LOOKS[k]),
      '手机页 ' + k + ' 与取值表不一致',
    );
    assert.equal(cell.focus, SAY_LOOKS[k].focusInput, '手机页 ' + k + ' 的 focus 与取值表不一致');
  }
});

test('手机页的 sayLook 只认 whisper / proactive，其余回落 note', () => {
  assert.ok(mobileScript.includes("origin==='proactive'||origin==='whisper'?origin:'note'"));
});

test('手机页的 showBubble 用取值表决定档位类名、小标题、停留与抢焦点', () => {
  // 三个行为点各一条，防止有人把其中一条悄悄删掉（只改颜色不改行为也算「没区分」）
  assert.ok(mobileScript.includes("look.tone!=='plain'?' tone-'+look.tone"), 'tone 类名');
  assert.ok(mobileScript.includes('tag.textContent=look.label'), '小标题');
  assert.ok(mobileScript.includes('look.hold>0'), 'hold=0 表示不自动消失');
  assert.ok(mobileScript.includes("if(look.focus)try{$('text').focus()}"), '抢焦点');
});

test('安卓悬浮窗的 SAY_LOOK 与取值表一致（项目不在本仓库时可跳过）', (t) => {
  // 安卓工程在工作区的 05-手机APP 下，不属于本 npm 包；打包/别处跑测试时文件不存在 → 跳过
  const p = join(
    process.cwd(),
    '..',
    '..',
    '..',
    '05-手机APP',
    'dsh-pet-mobile',
    'android',
    'app',
    'src',
    'main',
    'assets',
    'overlay',
    'overlay.js',
  );
  if (!existsSync(p)) {
    t.skip('找不到安卓悬浮窗工程，跳过三端一致性检查');
    return;
  }
  const src = readFileSync(p, 'utf8');
  const got = pickObject(src, 'SAY_LOOK');
  for (const k of ['proactive', 'whisper', 'note'] as const) {
    assert.deepEqual(got[k], expectShape(SAY_LOOKS[k]), '悬浮窗 ' + k + ' 与取值表不一致');
  }
});
// ---- 整段脚本必须能解析 ----
// 这个页面是「一段模板字符串里的 JS」，任何一处转义写错（本文件里正则的 \/ 与 \)
// 都会被模板字符串吃掉，产出一个非法正则字面量 —— 整段脚本 SyntaxError、一个事件都不接，
// 而页面看起来一切正常（HTML/CSS 都在），测试也全绿。2026-11-01 真踩过一次：
// `ua.match(/Android[^;]*;([^)]+)\)/)` 里的 \) 被吃成 )，手机页与 APK 同时白屏（功能全无）。
// 所以这里用 new Function 当解析器：能构造出来 = 语法合法。
test('mobileScript 能被 JS 解析（防模板字符串吃掉转义）', () => {
  assert.doesNotThrow(() => {
    new Function(mobileScript);
  });
});