/**
 * 配对码与「手机端远程授权」的测试。
 *
 * 这两块是本轮改动里**唯一扩大攻击面**的地方（以前服务只绑回环，物理上就没人能连），
 * 所以测试要钉住的不是「功能能用」，而是**边界不会自己松开**：
 *   - 开关关着时，非回环来源一律 403（哪怕请求写得完全正确、哪怕带对了令牌）；
 *   - 开关开着时，除了配对与手机壳页面，任何 `/dsh-pet-*` 都仍要令牌；
 *   - 短码过期/用尽/一次性都真的生效，而不是「靠用户不看屏幕」。
 */
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';

import { createPairing, PAIR_MAX_ATTEMPTS, PAIR_TTL_MS } from './pairing';
import { createRequestSecurity } from './request-security';

/** 造一个足够像的请求：只需要 authorize 实际读的那几个字段。 */
function fakeRequest(init: {
  peer?: string;
  host?: string;
  port?: number;
  method?: string;
  url?: string;
  token?: string;
  origin?: string;
  fetchSite?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (init.host !== undefined) headers.host = init.host;
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.fetchSite !== undefined) headers['sec-fetch-site'] = init.fetchSite;
  if (init.token !== undefined) headers['x-dsh-pet-token'] = init.token;
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers,
    socket: { remoteAddress: init.peer ?? '127.0.0.1', localPort: init.port ?? 3080 },
  } as unknown as IncomingMessage;
}

/** authorize 会往响应上写的东西：状态码、可移除/可设置的响应头。 */
type FakeRes = {
  statusCode: number;
  headers: Record<string, string>;
  writeHead(status: number, headers?: Record<string, string>): FakeRes;
  end(): FakeRes;
  getHeaderNames(): string[];
  removeHeader(name: string): void;
  setHeader(name: string, value: string): void;
};

function fakeResponse(): ServerResponse {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      Object.assign(res.headers, headers ?? {});
      return res;
    },
    end() {
      return res;
    },
    getHeaderNames() {
      return Object.keys(res.headers);
    },
    removeHeader(name: string) {
      delete res.headers[name];
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res as unknown as ServerResponse;
}

test('配对码：6 位、可带前导零、默认有效期内可兑换一次', () => {
  const clock = 1_000_000;
  const pairing = createPairing(() => clock);
  assert.equal(pairing.current(), undefined, '没生成过就没有票');
  const ticket = pairing.issue();
  assert.match(ticket.pin, /^\d{6}$/);
  assert.equal(pairing.current()?.pin, ticket.pin);
  assert.equal(pairing.claim(ticket.pin), true, '正确短码应兑换成功');
  assert.equal(pairing.current(), undefined, '一次性：换过即作废');
  assert.equal(pairing.claim(ticket.pin), false, '同一码不能再用第二次');
});

test('配对码：过期即失效（不是「等下一次请求才发现」）', () => {
  let clock = 5_000_000;
  const pairing = createPairing(() => clock);
  const ticket = pairing.issue();
  clock += PAIR_TTL_MS - 1;
  assert.ok(pairing.current(), '差 1ms 时仍然有效');
  clock += 2;
  assert.equal(pairing.current(), undefined, '超过 TTL 后 current() 就该是 undefined');
  assert.equal(pairing.claim(ticket.pin), false, '过期后兑换必须失败');
});

test('配对码：错满次数即作废，正确码也不能再救回来', () => {
  const pairing = createPairing(() => 7_000_000);
  const ticket = pairing.issue();
  const wrong = ticket.pin === '000000' ? '111111' : '000000';
  for (let i = 0; i < PAIR_MAX_ATTEMPTS; i += 1) {
    assert.equal(pairing.claim(wrong), false);
  }
  assert.equal(pairing.current(), undefined, '次数用尽后票就没了');
  assert.equal(pairing.claim(ticket.pin), false, '此时正确码也进不来');
});

test('配对码：格式不对也算一次尝试（否则可以先无限次探服务端行为）', () => {
  const pairing = createPairing(() => 8_000_000);
  const ticket = pairing.issue();
  for (let i = 0; i < PAIR_MAX_ATTEMPTS; i += 1) {
    assert.equal(pairing.claim('abc'), false);
  }
  assert.equal(pairing.claim(ticket.pin), false, '垃圾输入把次数耗光后，正确码也进不来');
});

test('配对码：issue 覆盖旧票、cancel 立刻作废', () => {
  const pairing = createPairing(() => 9_000_000);
  const first = pairing.issue();
  const second = pairing.issue();
  assert.equal(pairing.claim(first.pin), false, '被新票覆盖后旧码失效');
  assert.equal(pairing.claim(second.pin), true);
  const third = pairing.issue();
  pairing.cancel();
  assert.equal(pairing.claim(third.pin), false);
});

// ---------------------------------------------------------------- 远程授权边界

const PHONE = '192.168.1.42';

test('手机访问：开关关着时，非回环来源一律 403（带对令牌也不行）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => false });
  const req = fakeRequest({
    peer: PHONE,
    host: `${PHONE}:7340`,
    port: 7340,
    url: '/dsh-pet-7340/config',
    token: security.token,
  });
  const res = fakeResponse();
  assert.equal(security.authorize(req, res), false);
  assert.equal(res.statusCode, 403);
});

test('手机访问：开关开着，但没有令牌 → 403', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  const res = fakeResponse();
  assert.equal(
    security.authorize(
      fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, url: '/dsh-pet-7340/config' }),
      res,
    ),
    false,
  );
  assert.equal(res.statusCode, 403);
});

test('手机访问：开关开着且带对令牌 → 放行私有读', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  const res = fakeResponse();
  assert.equal(
    security.authorize(
      fakeRequest({
        peer: PHONE,
        host: `${PHONE}:7340`,
        port: 7340,
        url: '/dsh-pet-7340/config',
        token: security.token,
      }),
      res,
    ),
    true,
  );
});

test('手机访问：配对接口免令牌（这是它唯一存在的理由）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  assert.equal(
    security.authorize(
      fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, method: 'POST', url: '/pair' }),
      fakeResponse(),
    ),
    true,
  );
});

test('手机访问：手机壳页面免令牌，但 /mobile/api/* 不免', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  for (const url of ['/mobile/', '/mobile/mobile.js', '/mobile/mobile.css']) {
    assert.equal(
      security.authorize(fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, url }), fakeResponse()),
      true,
      `${url} 应免令牌`,
    );
  }
  // 这几个是「手机连接」的设置接口，必须走令牌
  for (const url of ['/mobile/api/state', '/mobile/api/pair']) {
    const res = fakeResponse();
    assert.equal(
      security.authorize(fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, url }), res),
      false,
      `${url} 不应免令牌`,
    );
    assert.equal(res.statusCode, 403);
  }
});

test('手机访问：对话与设置接口永不免令牌（哪怕 GET）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  for (const url of [
    '/dsh-pet-7340/chat?pet=a',
    '/dsh-pet-7340/chat/history?pet=a',
    '/dsh-pet-7340/whisper',
    '/standalone-ai/settings',
    '/standalone-ai/',
  ]) {
    const res = fakeResponse();
    assert.equal(
      security.authorize(fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, url }), res),
      false,
      `${url} 不应免令牌`,
    );
  }
});

test('手机访问：不依赖 Origin（Capacitor 壳的 origin 与局域网地址不同源）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  const res = fakeResponse();
  assert.equal(
    security.authorize(
      fakeRequest({
        peer: PHONE,
        host: `${PHONE}:7340`,
        port: 7340,
        url: '/dsh-pet-7340/config',
        token: security.token,
        origin: 'http://localhost',
        fetchSite: 'cross-site',
      }),
      res,
    ),
    true,
    '远程路径只看令牌，不看 Origin/Sec-Fetch-Site',
  );
});

test('本机路径不受远程开关影响：关着也照常放行公开读', () => {
  const security = createRequestSecurity({ remoteEnabled: () => false });
  const res = fakeResponse();
  assert.equal(security.authorize(fakeRequest({ host: '127.0.0.1:3080', port: 3080, url: '/health' }), res), true);
});

test('本机路径：Host 不对仍然 403（DNS rebinding 防线没被放松）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  const res = fakeResponse();
  assert.equal(security.authorize(fakeRequest({ host: 'evil.example:3080', port: 3080, url: '/health' }), res), false);
  assert.equal(res.statusCode, 403);
});

test('来源地址读不到时按本机处理（不能因为字段缺失就降级到宽松分支）', () => {
  const security = createRequestSecurity({ remoteEnabled: () => false });
  const res = fakeResponse();
  // 空 remoteAddress + 正确 Host：走本机路径，公开读放行
  assert.equal(
    security.authorize(fakeRequest({ peer: '', host: '127.0.0.1:3080', port: 3080, url: '/health' }), res),
    true,
  );
  // 私有写仍要令牌 —— 说明它确实走的是「本机严格路径」而不是「远程免检路径」。
  // 注意不能用 GET /dsh-pet-7340/config 来测：本机路径下它对 GET 本来就是公开的
  // （桌面渲染端靠它读配置，见 publicRead），这是既有设计，远程路径才收紧。
  const res2 = fakeResponse();
  assert.equal(
    security.authorize(
      fakeRequest({
        peer: '',
        host: '127.0.0.1:3080',
        port: 3080,
        method: 'POST',
        url: '/dsh-pet-7340/chat?pet=a&surface=web',
      }),
      res2,
    ),
    false,
  );
});

test('本机公开、远程收紧：同一条 GET 配置在两种来源下结论不同', () => {
  const security = createRequestSecurity({ remoteEnabled: () => true });
  const loopback = fakeResponse();
  assert.equal(
    security.authorize(fakeRequest({ host: '127.0.0.1:3080', port: 3080, url: '/dsh-pet-7340/config' }), loopback),
    true,
    '本机 GET 配置公开（桌面渲染端依赖它）',
  );
  const remote = fakeResponse();
  assert.equal(
    security.authorize(
      fakeRequest({ peer: PHONE, host: `${PHONE}:7340`, port: 7340, url: '/dsh-pet-7340/config' }),
      remote,
    ),
    false,
    '远程 GET 配置必须带令牌',
  );
  assert.equal(remote.statusCode, 403);
});
