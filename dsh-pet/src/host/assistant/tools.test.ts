/**
 * 助手工具集的单测（2026-10-26）。
 *
 * 全部在临时工作区内跑真实文件操作——不用桩，因为要验的正是「路径归一化 + 权限闸门
 * + 真实 fs」这三者的组合行为。每个用例自建自清，互不干扰。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTool, toolDefinitions, TOOLS, type ToolContext } from './tools.ts';
import { GrantStore } from './permissions.ts';

/** 每例一个干净工作区 */
function withWs(fn: (ws: string, ctx: ToolContext) => Promise<void>): () => Promise<void> {
  return async () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-pet-tools-'));
    const ctx: ToolContext = {
      workspaceRoot: ws,
      permission: 'workspace',
      grants: new GrantStore(60_000),
      netTimeoutMs: 5000,
      networkEnabled: false,
    };
    try {
      await fn(ws, ctx);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  };
}

test('toolDefinitions：7 个工具，名字与参数形状合规（OpenAI function 形状）', () => {
  const defs = toolDefinitions();
  assert.equal(defs.length, 7);
  const names = defs.map((d) => d.function.name).sort();
  assert.deepEqual(names, ['append_file', 'fetch_url', 'list_dir', 'read_file', 'search_files', 'web_search', 'write_file']);
  for (const d of defs) {
    assert.equal(d.type, 'function');
    assert.ok(d.function.description.length > 10, `${d.function.name} 缺少描述`);
    assert.equal(d.function.parameters.type, 'object');
  }
});

test('findTool：存在与不存在的两种返回', () => {
  assert.ok(findTool('read_file'));
  assert.equal(findTool('rm_rf'), undefined);
});

test(
  'write_file + read_file：写入后能读回，内容逐字一致',
  withWs(async (ws, ctx) => {
    const w = await findTool('write_file')!.run(ctx, { path: 'notes/a.txt', content: '你好\n世界' });
    assert.equal(w.ok, true, w.content);
    assert.ok(existsSync(join(ws, 'notes', 'a.txt')), '应自动创建子目录');
    const r = await findTool('read_file')!.run(ctx, { path: 'notes/a.txt' });
    assert.equal(r.ok, true);
    assert.match(r.content, /你好\n世界/);
    assert.equal(readFileSync(join(ws, 'notes', 'a.txt'), 'utf8'), '你好\n世界');
  }),
);

test(
  'append_file：追加而非覆盖',
  withWs(async (ws, ctx) => {
    await findTool('write_file')!.run(ctx, { path: 'x.txt', content: 'A' });
    await findTool('append_file')!.run(ctx, { path: 'x.txt', content: 'B' });
    assert.equal(readFileSync(join(ws, 'x.txt'), 'utf8'), 'AB');
  }),
);

test(
  'read_file：拒绝非文本扩展名（避免把二进制读进 prompt）',
  withWs(async (ws, ctx) => {
    writeFileSync(join(ws, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await findTool('read_file')!.run(ctx, { path: 'img.png' });
    assert.equal(r.ok, false);
    assert.match(r.content, /不是文本文件/);
  }),
);

test(
  'read_file：超过 8 KB 时截断并标注',
  withWs(async (ws, ctx) => {
    writeFileSync(join(ws, 'big.txt'), 'x'.repeat(20_000));
    const r = await findTool('read_file')!.run(ctx, { path: 'big.txt' });
    assert.equal(r.ok, true);
    assert.match(r.content, /只读前 8192/);
    assert.ok(r.content.length < 20_000, '返回值不应包含全文');
  }),
);

test(
  'list_dir：列出文件与子目录（目录带斜杠），并标注总数',
  withWs(async (ws, ctx) => {
    mkdirSync(join(ws, 'sub'));
    writeFileSync(join(ws, 'a.txt'), '1');
    const r = await findTool('list_dir')!.run(ctx, { path: '.' });
    assert.equal(r.ok, true);
    assert.match(r.content, /sub\//);
    assert.match(r.content, /a\.txt/);
    assert.match(r.content, /2 项/);
  }),
);

test(
  'write_file 越界：workspace 档下被拦，blocked 带上工具名与目标路径',
  withWs(async (_ws, ctx) => {
    const outside = join(tmpdir(), 'dsh-pet-should-not-exist.txt');
    const r = await findTool('write_file')!.run(ctx, { path: outside, content: 'boom' });
    assert.equal(r.ok, false);
    assert.equal(existsSync(outside), false, '被拦下时绝不能真的写出去');
    assert.ok(r.blocked, '必须带回 blocked 供上层发起审批');
    assert.equal(r.blocked!.tool, 'write_file');
    assert.equal(r.blocked!.reason, 'outside-workspace');
  }),
);

test(
  '只读档：工作区内也拒写，reason=readonly',
  withWs(async (ws, ctx) => {
    const ro = { ...ctx, permission: 'readonly' as const };
    const r = await findTool('write_file')!.run(ro, { path: 'a.txt', content: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.blocked!.reason, 'readonly');
    assert.equal(existsSync(join(ws, 'a.txt')), false);
  }),
);

test(
  '只读档 + 一次性授权：仍然拒写（审批不能把只读档用成工作区档）',
  withWs(async (ws, ctx) => {
    const target = join(ws, 'ro-grant.txt');
    const ro = { ...ctx, permission: 'readonly' as const };
    // 故意先发一个授权，模拟「用户点了允许」
    ro.grants.grant('write_file', target);
    const r = await findTool('write_file')!.run(ro, { path: 'ro-grant.txt', content: 'x' });
    assert.equal(r.ok, false, '只读档不该被审批绕过');
    assert.equal(r.blocked!.reason, 'readonly');
    assert.equal(existsSync(target), false, '文件绝不能落盘');
  }),
);

test(
  '只读档：读工作区内的文件仍然允许（只读不是什么都干不了）',
  withWs(async (ws, ctx) => {
    writeFileSync(join(ws, 'r.txt'), 'hello');
    const ro = { ...ctx, permission: 'readonly' as const };
    const r = await findTool('read_file')!.run(ro, { path: 'r.txt' });
    assert.equal(r.ok, true);
    assert.match(r.content, /hello/);
  }),
);

test(
  '一次性授权：grant 之后同一个越界写动作放行，且只用一次',
  withWs(async (ws, ctx) => {
    const outside = join(tmpdir(), 'dsh-pet-grant-' + Date.now() + '.txt');
    try {
      // workspace 档 + 越界目标：本来会被拦，先发一个授权模拟「用户点了允许」
      ctx.grants.grant('write_file', outside);
      const r1 = await findTool('write_file')!.run(ctx, { path: outside, content: 'v1' });
      assert.equal(r1.ok, true, r1.content);
      assert.equal(readFileSync(outside, 'utf8'), 'v1');
      // 第二次没有授权了 -> 又被拦
      const r2 = await findTool('write_file')!.run(ctx, { path: outside, content: 'v2' });
      assert.equal(r2.ok, false, '授权应只生效一次');
      assert.equal(readFileSync(outside, 'utf8'), 'v1', '第二次不应写入');
    } finally {
      rmSync(outside, { force: true });
    }
  }),
);

test(
  'search_files：按文件名与按内容都能搜到',
  withWs(async (ws, ctx) => {
    mkdirSync(join(ws, 'deep'));
    writeFileSync(join(ws, 'deep', 'todo.md'), '第一行\nTODO: 买菜\n');
    const byName = await findTool('search_files')!.run(ctx, { pattern: 'todo', by: 'name' });
    assert.equal(byName.ok, true);
    assert.match(byName.content, /todo\.md/);
    const byContent = await findTool('search_files')!.run(ctx, { pattern: '买菜', by: 'content' });
    assert.equal(byContent.ok, true);
    assert.match(byContent.content, /买菜/);
    assert.match(byContent.content, /:2:/, '应给出行号');
  }),
);

test(
  'search_files：跳过 node_modules（防止在大目录里卡死）',
  withWs(async (ws, ctx) => {
    mkdirSync(join(ws, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(ws, 'node_modules', 'pkg', 'hit.js'), 'NEEDLE');
    writeFileSync(join(ws, 'keep.js'), 'NEEDLE');
    const r = await findTool('search_files')!.run(ctx, { pattern: 'NEEDLE', by: 'content' });
    assert.equal(r.ok, true);
    assert.match(r.content, /keep\.js/);
    assert.ok(!r.content.includes('node_modules'), '不该搜进 node_modules');
  }),
);

test(
  '联网关闭时：fetch_url 与 web_search 明确失败，不发请求',
  withWs(async (_ws, ctx) => {
    const off = { ...ctx, networkEnabled: false };
    const a = await findTool('fetch_url')!.run(off, { url: 'https://example.com' });
    assert.equal(a.ok, false);
    assert.match(a.content, /联网已关闭/);
    const b = await findTool('web_search')!.run(off, { query: 'x' });
    assert.equal(b.ok, false);
    assert.match(b.content, /联网已关闭/);
  }),
);

test(
  'fetch_url：拒绝非 http/https 协议（挡住 file: 读本地文件）',
  withWs(async (_ws, ctx) => {
    const on = { ...ctx, networkEnabled: true };
    const r = await findTool('fetch_url')!.run(on, { url: 'file:///C:/Windows/win.ini' });
    assert.equal(r.ok, false);
    assert.match(r.content, /只支持 http\/https/);
  }),
);

test('每个工具都有 write 标记（决定走 checkRead 还是 checkWrite）', () => {
  const writes = TOOLS.filter((t) => t.write).map((t) => t.name).sort();
  assert.deepEqual(writes, ['append_file', 'write_file'], '写类工具只有这两个');
});
