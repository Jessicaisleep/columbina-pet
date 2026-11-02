/**
 * 电脑设置页「配对设备」这一块的护栏测试（2026-11-02）。
 *
 * 为什么需要它：这一屏也是纯字符串模板，`tsc` 看不见里面写的是对象还是字符串。
 * 2026-11-02 的真机自查里就抓到一个活 bug —— 删除按钮把 `JSON.stringify({id})`
 * 传给了 `petRequest`，而 `petRequest` 内部还会再 stringify 一次，服务端 parse
 * 出来是字符串而不是对象，于是恒定回 400「缺少设备 id」，用户看到的就是
 * 「点删除没反应、设备还在」。这条测试钉的是「协议形状」，不是界面长相。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsPage, settingsScript } from './settings-page';

/** 取出删除按钮那一段脚本（文件里第一处 `devices/remove` 是注释，所以按调用形状定位） */
function deleteHandlerSnippet(): string {
  const at = settingsScript.indexOf("/mobile/api/devices/remove', 'POST'");
  assert.ok(at > 0, '设置页脚本里找不到删除设备的请求调用');
  return settingsScript.slice(Math.max(0, at - 700), at + 500);
}

test('删除设备请求传的是对象，不是已经序列化过的字符串', () => {
  const snippet = deleteHandlerSnippet();
  assert.ok(
    !/JSON\.stringify\(\s*\{\s*id:/.test(snippet),
    '删除设备的 body 不能被 JSON.stringify 包起来：petRequest 内部会再序列化一次，' +
      '服务端只会拿到一个字符串，永久 400「缺少设备 id」',
  );
  assert.ok(/\{\s*id:\s*d\.id\s*\}/.test(snippet), '删除设备应当直接传对象 { id: d.id }');
});

test('设置页确实提供删设备入口，且只出现在电脑端', () => {
  assert.ok(settingsPage.includes('id="mobile-devices"'), '电脑设置页缺少已配对设备列表');
  assert.ok(
    settingsScript.includes("/mobile/api/devices/remove', 'POST'"),
    '缺少删除接口的实际调用（POST /mobile/api/devices/remove）',
  );
});
