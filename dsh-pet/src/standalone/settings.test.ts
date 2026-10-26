import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSettings, publicSettings } from './settings.ts';
import { settingsPage, settingsScript, settingsStyle } from './settings-page.ts';

test('settings validation accepts explicit costs and write-only blank/clear key semantics', () => {
  const input = {
    protocol: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    model: 'model',
    apiKey: '',
    enabled: false,
    automaticWhispers: false,
    whisperIntervalSec: 300,
    maxTokens: 512,
  };
  assert.deepEqual(validateSettings(input), input);
  assert.deepEqual(validateSettings({ clearApiKey: true }), { clearApiKey: true });
  for (const input of [
    null,
    [],
    { protocol: 'other' },
    { enabled: 'true' },
    { whisperIntervalSec: 59 },
    { whisperIntervalSec: 1.5 },
    { maxTokens: 99999 },
    { apiKey: 123 },
    { hasKey: true },
    { baseUrl: 'file:///a' },
    { baseUrl: 'https://user:secret@example.test/v1' },
    { baseUrl: 'https://example.test/?key=secret' },
  ]) {
    assert.throws(() => validateSettings(input), Error, JSON.stringify(input));
  }
});
test('public settings are an allowlist even if backend accidentally includes credentials', () => {
  const actual = publicSettings({
    protocol: 'anthropic',
    apiKey: 'never expose',
    token: 'never expose',
    hasKey: true,
    model: 'x',
    enabled: false,
  });
  assert.deepEqual(actual, { protocol: 'anthropic', hasKey: true, model: 'x', enabled: false });
  assert.equal(JSON.stringify(actual).includes('never expose'), false);
});
test('settings shell is accessible, self contained, and never saves browser secrets', () => {
  assert.match(settingsPage, /lang="zh-CN"/);
  assert.match(settingsPage, /type="password"/);
  assert.match(settingsPage, /aria-live="polite"/);
  assert.match(settingsPage, /automaticWhispers/);
  assert.match(settingsPage, /费用/);
  assert.match(settingsPage, /min="60"/);
  assert.match(settingsScript, /history\.replaceState/);
  assert.match(settingsScript, /X-DSH-Pet-Token/);
  assert.doesNotMatch(settingsScript, /localStorage|sessionStorage|document\.cookie|innerHTML/);
  assert.doesNotMatch(settingsPage, /https?:\/\/(?!example)/);
  assert.match(settingsStyle, /focus-visible/);
});

test('settings browser script strips fragment, keeps key write-only and explicitly clears without AI requests', async () => {
  const { runInNewContext } = await import('node:vm');
  type Node = {
    value: string;
    checked: boolean;
    disabled: boolean;
    hidden: boolean;
    textContent: string;
    className: string;
    dataset: Record<string, string>;
    children: Node[];
    listeners: Record<string, (event?: unknown) => Promise<void> | void>;
    addEventListener: (name: string, fn: (event?: unknown) => Promise<void> | void) => void;
    setAttribute: (name: string, value: string) => void;
    append: (...nodes: Node[]) => void;
    appendChild: (node: Node) => void;
    reportValidity: () => boolean;
    classList: { toggle: (name: string, on: boolean) => void };
  };
  const node = (): Node => {
    const self: Node = {
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      className: '',
      dataset: {},
      children: [],
      listeners: {},
      addEventListener(name, fn) {
        self.listeners[name] = fn;
      },
      setAttribute: () => undefined,
      append(...nodes: Node[]) {
        self.children.push(...nodes);
      },
      appendChild(child: Node) {
        self.children.push(child);
      },
      reportValidity: () => true,
      classList: { toggle: () => undefined },
    };
    return self;
  };
  const elements = new Map<string, Node>();
  const element = (id: string): Node => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id)!;
  };
  const requests: Array<{ url: string; options: { method: string; body?: string; headers: Record<string, string> } }> =
    [];
  let stripped = '';
  runInNewContext(settingsScript, {
    URLSearchParams,
    location: { hash: '#token=process-capability', pathname: '/standalone-ai/' },
    history: {
      replaceState: (_a: unknown, _b: unknown, path: string) => {
        stripped = path;
      },
    },
    document: { getElementById: element, createElement: () => node() },
    fetch: async (url: string, options: { method: string; body?: string; headers: Record<string, string> }) => {
      requests.push({ url, options });
      // 人设卡与对话历史直接打宿主的宠物路由，返回体与 /standalone-ai/settings 不同。
      const body = url.startsWith('/dsh-pet-7340/config')
        ? { main: { pets: [{ id: 'main', name: '蓝毛小女仆' }] } }
        : url.startsWith('/dsh-pet-7340/pet-persona')
          ? { ok: true, persona: '', system: '你的名字是“蓝毛小女仆”。' }
          : url.startsWith('/dsh-pet-7340/chat/history')
            ? { ok: true, total: 0, messages: [], memory: { summary: '', summarized: 0, total: 0 } }
            : {
                protocol: 'anthropic',
                baseUrl: 'https://example.test',
                model: 'x',
                hasKey: true,
                enabled: true,
                automaticWhispers: false,
                whisperIntervalSec: 300,
                maxTokens: 1024,
              };
      return { ok: true, json: async () => body };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stripped, '/standalone-ai/');
  assert.equal(element('apiKey').value, '');
  assert.equal(element('key-state').textContent, '已保存 · 不回显');
  element('apiKey').value = 'write-only-fake-key';
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.equal(element('apiKey').value, '');
  // 人设卡 / 对话历史也会打本机接口，故只挑设置本体那几次请求按顺序断言（用取值函数，数组会增长）。
  const settingsRequests = () => requests.filter(({ url }) => url === '/standalone-ai/settings');
  assert.equal(JSON.parse(settingsRequests()[1].options.body ?? '{}').apiKey, 'write-only-fake-key');
  element('clearApiKey').checked = true;
  element('clearApiKey').listeners.change();
  assert.equal(element('enabled').checked, false);
  assert.equal(element('apiKey').disabled, true);
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(settingsRequests()[2].options.body ?? '{}').clearApiKey, true);
  assert.equal(JSON.parse(settingsRequests()[2].options.body ?? '{}').enabled, false);
  assert.equal(element('apiKey').disabled, false);
  assert.ok(
    requests.every(({ options }) => options.headers['X-DSH-Pet-Token'] === 'process-capability'),
    '所有本机请求都必须带本次运行凭据',
  );
});
