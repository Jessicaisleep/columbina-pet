/**
 * 手机端设置屏的护栏测试（2026-11-01）。
 *
 * 这一屏是纯字符串模板，没有类型能帮忙：写错一个 id、少写一个控件、把模板插值漏进
 * 产物字符串，`tsc` 都不会报，只有到手机上点开才发现「按钮没反应」。所以用测试把
 * 三件事钉住：
 *   ① 脚本里 `$('x')` 引用的 id 必须真的在 HTML 里；
 *   ② 产物里不许残留插值记号（残留说明模板拼错，浏览器会把它当普通文本渲染）；
 *   ③ 手机端**绝不出现**配对设备管理（用户明确要求：那是电脑上的事）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobilePage, mobileScript, mobileStyle } from './mobile-page';
import { MOBILE_SETTINGS_IDS } from './mobile-settings';

test('设置屏的每个 id 都真的渲染在页面里', () => {
  for (const id of MOBILE_SETTINGS_IDS) {
    assert.ok(mobilePage.includes('id="' + id + '"'), `页面里缺少 id="${id}"`);
  }
});

test('脚本里 $() 取到的 id 必须存在', () => {
  const used = new Set<string>();
  const re = /\$\('([a-z0-9-]+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mobileScript)) !== null) used.add(m[1]);
  assert.ok(used.size > 30, '取到的 id 太少，说明设置屏的脚本没拼进产物');
  for (const id of used) {
    assert.ok(
      mobilePage.includes('id="' + id + '"'),
      `脚本里取了 $('${id}')，但页面里没有这个 id —— 运行时会是 null 然后整段脚本报错`,
    );
  }
});

test('三段产物里不许残留模板插值记号', () => {
  for (const [name, text] of [
    ['mobilePage', mobilePage],
    ['mobileStyle', mobileStyle],
    ['mobileScript', mobileScript],
  ] as const) {
    assert.equal(text.includes('${'), false, `${name} 里残留了插值记号，模板没拼对`);
  }
});

test('设置屏默认是隐藏的，靠头部「设置」按钮进入', () => {
  assert.match(mobilePage, /<section id="setts"[^>]*class="screen is-hidden"/);
  assert.ok(mobilePage.includes('id="set-btn"'), '缺入口按钮');
  assert.ok(mobileScript.includes("$('set-btn').addEventListener"), '入口按钮没绑事件');
  assert.ok(mobileScript.includes("$('set-back').addEventListener"), '缺返回按钮绑定');
});

test('保存走的就是电脑设置页那两个接口（一份真值）', () => {
  assert.ok(mobileScript.includes('/dsh-pet-7340/assistant/settings'));
  assert.ok(mobileScript.includes('/dsh-pet-7340/pet-persona?pet='));
});

test('手机端不碰配对设备管理', () => {
  assert.equal(mobileScript.includes('/mobile/api/devices'), false, '手机端不许有设备列表入口');
  assert.equal(mobileScript.includes('/mobile/api/pair'), false, '手机端不许生成配对码');
  // 反过来：必须有一句说清「这件事在电脑上做」，否则用户会以为功能丢了。
  assert.ok(mobilePage.includes('配对设备管理只在电脑上做'));
});

test('同步靠 /state 的 config 信号叶子，没有新增轮询接口', () => {
  assert.ok(mobileScript.includes('s.sections.config'), '没读 config 信号叶子，手机改了电脑不会跟');
  assert.ok(mobileScript.includes('sxOnConfigSignal'), '信号变了没有交给设置屏处理');
  assert.ok(mobileScript.includes('cfgVer'), '缺「上一次看到的配置版本」，首拍会误判成被别人改了');
});

test('手上有未保存的改动时，别把人家写的东西冲掉', () => {
  // sxDirty 的两个用途必须成对出现：置脏（输入事件里）与「脏就不自动覆盖」（同步分支里）。
  assert.ok(mobileScript.includes('sxDirty=true'));
  assert.ok(mobileScript.includes('if(sxDirty)'), '同步分支没有脏检查');
  assert.ok(mobileScript.includes('没保存的改动'), '脏的时候该说清为什么不覆盖');
});

test('数值上限在手机上先校验一遍，别让后端整包拒绝', () => {
  // 后端 topFieldValid 越界会回 bad-request（整包），用户只会看到「提交的值不合法」。
  assert.ok(mobileScript.includes('0–200'), '记忆轮数范围没写在提示里');
  assert.ok(mobileScript.includes('120–86400'), '主动聊天间隔范围没校验');
  assert.ok(mobileScript.includes('0–3000'), '合并窗口范围没校验');
});
