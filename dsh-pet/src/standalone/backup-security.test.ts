/**
 * 备份路由的安全边界测试：证明「含记忆的导出接口」不会绕过令牌。
 *
 * 起因（真实的坑，2026-10-27）：我把 `portable/export` 一开始做成 GET，
 * 而 standalone 的 `publicRead()`（src/standalone/request-security.ts:17-26）会放行
 * **所有** `GET /dsh-pet-<数字>/…`，不要求 `X-DSH-Pet-Token`。
 * 导出包里含 `memory.json`（用户真实对话原文）——一个免令牌的 GET 等于
 * 「本机能打开网页的任何程序都能读走你的聊天记录」。
 *
 * 这个文件把两条约束钉死：
 *   1. `portable/export` 只接受 POST（GET 必须 405，且不产生包体）；
 *   2. 走 `authorize()` 时，没有令牌的 `POST /dsh-pet-7340/portable/export` 必须被拒。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequestSecurity } from './request-security.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

const HOST_DIR = join(import.meta.dirname, '..', 'host');
const hostSource = readFileSync(join(HOST_DIR, 'index.ts'), 'utf8');

function fakeReq(init: {
  url: string;
  method: string;
  headers?: Record<string, string | undefined>;
}): IncomingMessage {
  return {
    url: init.url,
    method: init.method,
    headers: { host: '127.0.0.1:3080', ...(init.headers ?? {}) },
    socket: { localPort: 3080 },
  } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { status?: number; body?: string } {
  const res = {
    status: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(status: number) {
      res.status = status;
      return res;
    },
    end(body?: string) {
      res.body = body;
    },
  };
  return res as unknown as ServerResponse & { status?: number; body?: string };
}

test('portable/export 在宿主侧只收 POST：源码里不含 GET 分支', () => {
  // 抓 `rest === 'portable/export'` 之后到下一个 `if (rest ===` 之间那段
  const start = hostSource.indexOf("rest === 'portable/export'");
  assert.notEqual(start, -1, '找不到 portable/export 路由');
  const next = hostSource.indexOf("if (rest === 'portable/import'", start);
  assert.notEqual(next, -1, '找不到 portable/import 路由（顺序被改过？）');
  const block = hostSource.slice(start, next);
  assert.match(block, /method !== 'POST'/, 'export 必须只允许 POST');
  assert.ok(
    !/method !== 'GET' && method !== 'POST'/.test(block),
    'export 不能再接受 GET —— 那会绕过令牌（见本文件头注释）',
  );
  assert.ok(
    !/url\.searchParams\.get\('includeApiKey'\)/.test(block),
    'includeApiKey 必须从 POST body 取，不能从 query 取（GET 才用 query）',
  );
});

test('没有令牌的 POST /portable/export 被 authorize 拒绝', () => {
  const security = createRequestSecurity();
  const res = fakeRes();
  const ok = security.authorize(
    fakeReq({ url: '/dsh-pet-7340/portable/export', method: 'POST' }),
    res,
  );
  assert.equal(ok, false);
  assert.equal(res.status, 403, '没有令牌的导出请求必须 403');
});

test('没有令牌的 POST /portable/import 被 authorize 拒绝', () => {
  const security = createRequestSecurity();
  const res = fakeRes();
  const ok = security.authorize(
    fakeReq({ url: '/dsh-pet-7340/portable/import', method: 'POST' }),
    res,
  );
  assert.equal(ok, false);
  assert.equal(res.status, 403);
});

test('带正确令牌的 POST /portable/export 放行', () => {
  const security = createRequestSecurity();
  const res = fakeRes();
  const ok = security.authorize(
    fakeReq({
      url: '/dsh-pet-7340/portable/export',
      method: 'POST',
      headers: { 'x-dsh-pet-token': security.token, origin: 'http://127.0.0.1:3080' },
    }),
    res,
  );
  assert.equal(ok, true);
});

test('（反证）GET 路径确实是免令牌的——这正是不用 GET 的原因', () => {
  const security = createRequestSecurity();
  const res = fakeRes();
  // 随便挑一个 GET 形态的业务路径：publicRead 直接放行，不需要令牌
  const ok = security.authorize(fakeReq({ url: '/dsh-pet-7340/config', method: 'GET' }), res);
  assert.equal(
    ok,
    true,
    'GET /dsh-pet-*/config 目前是免令牌的；所以 export 绝不能做成 GET',
  );
});

test('设置页导出走 POST（不是 GET）', () => {
  const page = readFileSync(join(import.meta.dirname, 'settings-page.ts'), 'utf8');
  assert.match(
    page,
    /petRequestRaw\('\/dsh-pet-7340\/portable\/export', 'POST'/,
    '设置页必须用 POST 调导出',
  );
  assert.ok(
    !/portable\/export\?includeApiKey/.test(page),
    '不能再拼 query 形式的 includeApiKey',
  );
});
