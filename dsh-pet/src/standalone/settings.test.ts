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

/**
 * 对话历史每行的「改 / 删」（2026-10-30 任务2）。
 *
 * 上一个用例的 DOM 桩没有 querySelector / remove / focus / setSelectionRange，
 * 所以 renderRows 之后的 buildOps 那条路一行都没真跑过；这里补一个带这些方法的桩，
 * 把「点改 → 出现文本框 → 保存 → 点删 → 确认」整条链真的走一遍。
 */
test('对话历史每行都能改/删：buildOps 真跑一遍（任务2）', async () => {
  const { runInNewContext } = await import('node:vm');
  type Stub = {
    value: string;
    checked: boolean;
    disabled: boolean;
    hidden: boolean;
    textContent: string;
    className: string;
    type: string;
    dataset: Record<string, string>;
    children: Stub[];
    parent?: Stub;
    listeners: Record<string, (event?: unknown) => Promise<void> | void>;
    addEventListener: (name: string, fn: (event?: unknown) => Promise<void> | void) => void;
    setAttribute: (name: string, value: string) => void;
    append: (...nodes: Stub[]) => void;
    appendChild: (node: Stub) => void;
    reportValidity: () => boolean;
    classList: { toggle: (name: string, on: boolean) => void };
    querySelector: (sel: string) => Stub | null;
    remove: () => void;
    focus: () => void;
    setSelectionRange: (a: number, b: number) => void;
  };
  const node = (): Stub => {
    const self: Stub = {
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      className: '',
      type: '',
      dataset: {},
      children: [],
      listeners: {},
      addEventListener(name, fn) {
        self.listeners[name] = fn;
      },
      setAttribute: () => undefined,
      append(...nodes: Stub[]) {
        for (const n of nodes) {
          n.parent = self;
          self.children.push(n);
        }
      },
      appendChild(child: Stub) {
        child.parent = self;
        self.children.push(child);
      },
      reportValidity: () => true,
      classList: { toggle: () => undefined },
      querySelector(sel: string) {
        const want = sel.replace(/^\./, '');
        const walk = (n: Stub): Stub | null => {
          for (const child of n.children) {
            if (child.className === want) return child;
            const hit = walk(child);
            if (hit) return hit;
          }
          return null;
        };
        return walk(self);
      },
      remove() {
        const p = self.parent;
        if (!p) return;
        const i = p.children.indexOf(self);
        if (i >= 0) p.children.splice(i, 1);
        self.parent = undefined;
      },
      focus: () => undefined,
      setSelectionRange: () => undefined,
    };
    // renderRows 用 `historyList.textContent = ''` 清空列表，真实 DOM 会连子节点一起抹掉；
    // 桩子若只改字符串，断言「重画后只剩一条」就会被旧节点骗过——所以这里照着真实语义做。
    let text = '';
    Object.defineProperty(self, 'textContent', {
      get: () => text,
      set: (next: string) => {
        text = next;
        if (next === '') {
          for (const child of self.children) child.parent = undefined;
          self.children.length = 0;
        }
      },
    });
    return self;
  };
  const elements = new Map<string, Stub>();
  const element = (id: string): Stub => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id)!;
  };
  const requests: Array<{ url: string; options: { method: string; body?: string; headers: Record<string, string> } }> =
    [];
  const confirms: string[] = [];
  const messages = [
    { index: 0, role: 'user', content: '你是谁', ts: 1_700_000_000_000, summarized: true },
    { index: 1, role: 'assistant', content: '我是小女仆', ts: 1_700_000_060_000, summarized: false },
  ];
  runInNewContext(settingsScript, {
    URLSearchParams,
    location: { hash: '#token=process-capability', pathname: '/standalone-ai/' },
    history: { replaceState: () => undefined },
    document: { getElementById: element, createElement: () => node() },
    window: {
      confirm: (text: string) => {
        confirms.push(text);
        return true;
      },
    },
    fetch: async (url: string, options: { method: string; body?: string; headers: Record<string, string> }) => {
      requests.push({ url, options });
      const body = url.startsWith('/dsh-pet-7340/config')
        ? { main: { pets: [{ id: 'main', name: '蓝毛小女仆' }] } }
        : url.startsWith('/dsh-pet-7340/pet-persona')
          ? { ok: true, persona: '', system: '' }
          : url.startsWith('/dsh-pet-7340/chat/history')
            ? options.method === 'GET'
              ? { ok: true, total: 2, messages, memory: { summary: '她叫小女仆。', summarized: 1, total: 2 } }
              : {
                  ok: true,
                  index: 0,
                  total: 1,
                  summarized: 0,
                  covered: true,
                  summaryRewritten: true,
                  memory: { summary: '她叫小明。', summarized: 0, total: 1 },
                }
            : {
                protocol: 'openai-compatible',
                baseUrl: 'https://example.test',
                model: 'x',
                hasKey: false,
                enabled: false,
                automaticWhispers: false,
                whisperIntervalSec: 300,
                maxTokens: 1024,
              };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  await flush();

  // 读历史：宠物下拉由 loadPets 填好选项后手工选中，再点「读取」
  element('history-pet').value = 'main';
  element('history-load').listeners.click?.();
  await flush();
  const list = element('history-list');
  assert.equal(list.children.length, 2, '两条历史都渲染成 li');
  const first = list.children[0]!;
  assert.equal(first.dataset.index, '0', 'li 上带着绝对下标，改/删靠它定位');
  assert.equal(first.className, 'is-summarized', '已压缩的条目仍用旧样式标出来');
  const ops = first.children[2]!;
  assert.equal(ops.className, 'msg-ops');
  const [editBtn, delBtn] = ops.children as [Stub, Stub];
  assert.equal(editBtn.textContent, '改');
  assert.equal(delBtn.textContent, '删');
  assert.equal(delBtn.className, 'danger');

  // 点「改」→ 出现文本框 + 已压缩提示；连点两次不会叠出第二个框
  // li 的子节点顺序：[0] 头部 [1] 正文 [2] 这排按钮；进入编辑后再追加 [3] 编辑框 [4] 保存/取消栏
  editBtn.listeners.click?.();
  const box = first.querySelector('.msg-edit');
  assert.ok(box, '点改之后要有编辑框');
  assert.equal(box!.value, '你是谁', '编辑框初值是原内容');
  assert.equal(first.children[4]!.children[2]!.textContent, '这条已压进摘要，保存后会顺带重写摘要');
  editBtn.listeners.click?.();
  assert.equal(first.querySelector('.msg-edit'), box, '编辑中再点改不应插入第二个框');
  assert.equal(first.children.length, 5, '编辑中再点改不该多出节点（重复点会叠出两套框）');

  // 原样保存 → 不打接口，直接收起（避免无意义的云端摘要重写）
  const postCount = () =>
    requests.filter((r) => r.url === '/dsh-pet-7340/chat/history' && r.options.method === 'POST').length;
  const before = postCount();
  await first.children[4]!.children[0]!.listeners.click?.();
  await flush();
  assert.equal(postCount(), before, '内容没变就别保存');
  assert.equal(first.querySelector('.msg-edit'), null, '原样保存后编辑框要收起');
  assert.equal(first.children[1]!.hidden, false, '正文重新露出来');

  // 真的改：POST 带 pet/index/content，回执里的摘要与计数要落到页面上
  editBtn.disabled = false;
  delBtn.disabled = false;
  editBtn.listeners.click?.();
  const box2 = first.querySelector('.msg-edit')!;
  box2.value = '  我叫小明  ';
  first.children[4]!.children[0]!.listeners.click?.();
  await flush();
  const post = requests.filter((r) => r.url === '/dsh-pet-7340/chat/history' && r.options.method === 'POST').at(-1)!;
  assert.deepEqual(JSON.parse(post.options.body ?? '{}'), { pet: 'main', index: 0, content: '我叫小明' });
  assert.equal(first.children[1]!.textContent, '我叫小明', '改完正文要就地更新，不用整页重读');
  assert.match(element('memory-summary').textContent, /她叫小明/);
  assert.match(element('memory-meta').textContent, /已压缩 0 \/ 1 条/);
  assert.match(element('history-result').textContent, /摘要已重写/);

  // 空内容不提交
  const beforeEmpty = postCount();
  const second = list.children[1]!;
  (second.children[2]!.children[0] as Stub).listeners.click?.();
  second.querySelector('.msg-edit')!.value = '   ';
  await second.children[4]!.children[0]!.listeners.click?.();
  await flush();
  assert.equal(postCount(), beforeEmpty, '空内容不该发请求');
  assert.match(element('history-result').textContent, /内容不能为空/);

  // 删：确认框要说清「已压缩的会重写摘要」；DELETE 参数走 query（路由层只在 PUT/POST 读 body）
  const secondDel = second.children[2]!.children[1] as Stub;
  secondDel.listeners.click?.();
  await flush();
  assert.match(confirms.at(-1) ?? '', /确认删除这条？/);
  const del = requests.filter((r) => r.options.method === 'DELETE').at(-1)!;
  assert.equal(del.url, '/dsh-pet-7340/chat/history?pet=main&index=1');
  assert.match(element('history-result').textContent, /已删除/);
  // 删掉未压缩那条：本地账本只留第一条，整体重画后 index=1 那条不该再出现
  assert.equal(list.children.length, 1, '重画后只剩一条');
  assert.equal(first.querySelector('.msg-edit'), null, '重画会把编辑框一起换掉');
});
