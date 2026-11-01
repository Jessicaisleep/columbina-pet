/**
 * `/pair` 的宿主身份契约（2026-11-01）。
 *
 * 为什么要单独钉：手机要同时记住几台电脑（插件端 2 只 / 独立端 3 只），一次只用一份数据，
 * 靠的就是配对响应里那个 `hostId`。它一旦缺失或每次都变，手机那边就会每次多出一条「新电脑」，
 * 而按 ip:port 记又会在换网、端口顺延时把两台电脑的记录混成一份。所以：
 *   - 配对成功必须带回本机 host-id 文件里的值（与磁盘一致）；
 *   - 同一台电脑反复配对必须同值；不同电脑必须不同值；
 *   - 取不到身份时也不许把配对搞挂（退化为空串，手机按地址记）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOST_ID_FILE, readHostId } from '../standalone/host-identity.ts';
import { createPairing, type Pairing } from '../standalone/pairing.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';
import { startRouter } from './router.ts';

interface PairResult {
  status: number;
  body: { ok?: boolean; token?: string; hostId?: string };
}

async function pair(home: string, hostId?: () => string): Promise<{ result: PairResult; expected: string }> {
  const security = createRequestSecurity();
  const pairing: Pairing = createPairing();
  const server = await startRouter([], {
    security,
    log: () => {},
    status: () => ({ ok: true }),
    landingPage: () => '<html></html>',
    pairing,
    hostId: hostId ?? (() => readHostId(home)),
    mobile: { read: () => ({ enabled: true }) as never, write: () => {}, lan: () => [], listeningWide: false },
    devices: {
      read: async () => ({ devices: {}, revoked: [] }) as never,
      register: async () => ({ devices: {}, revoked: [] }) as never,
      touch: async () => {},
      drop: async () => ({ devices: {}, revoked: [] }) as never,
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    // /mobile/api/* 属于「电脑本机设置」接口，要主令牌（/pair 才免令牌：手机还没有令牌）
    const issued = await (
      await fetch(`${base}/mobile/api/pair`, { method: 'POST', headers: { 'X-DSH-Pet-Token': security.token } })
    ).json();
    const response = await fetch(`${base}/pair`, {
      method: 'POST',
      // 回环（本机测试）路径要令牌；真机走远程路径时 /pair 本就免令牌，见 mobile-pairing.test.ts
      headers: { 'content-type': 'application/json', 'X-DSH-Pet-Token': security.token },
      body: JSON.stringify({ pin: issued.pin, deviceId: 'test-phone', deviceName: '测试手机' }),
    });
    const body = (await response.json()) as PairResult['body'];
    let expected = '';
    try {
      expected = readFileSync(join(home, 'dsh-pet', HOST_ID_FILE), 'utf8').trim();
    } catch {
      expected = '';
    }
    return { result: { status: response.status, body }, expected };
  } finally {
    await server.close();
  }
}

test('配对响应带回本机身份，且同一台电脑反复配对同值', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pet-pair-a-'));
  const first = await pair(home);
  const second = await pair(home);
  for (const one of [first, second]) {
    assert.equal(one.result.status, 200);
    assert.equal(one.result.body.ok, true);
    assert.ok((one.result.body.token ?? '').length > 0, '令牌必须回给手机');
    assert.ok((one.result.body.hostId ?? '').length >= 16, `hostId 太短：${one.result.body.hostId}`);
    assert.equal(one.result.body.hostId, one.expected, 'hostId 必须就是磁盘上那个值');
  }
  assert.equal(first.result.body.hostId, second.result.body.hostId, '同一台电脑第二次配对必须同值');
});

test('两台电脑（不同数据目录）的 hostId 必须不同', async () => {
  const a = await pair(mkdtempSync(join(tmpdir(), 'dsh-pet-pair-h1-')));
  const b = await pair(mkdtempSync(join(tmpdir(), 'dsh-pet-pair-h2-')));
  assert.notEqual(a.result.body.hostId, b.result.body.hostId);
});

test('拿不到身份时配对照旧成功，只是 hostId 为空串', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pet-pair-broken-'));
  const one = await pair(home, () => {
    throw new Error('盘读不了');
  });
  assert.equal(one.result.status, 200);
  assert.equal(one.result.body.ok, true);
  assert.ok((one.result.body.token ?? '').length > 0, '令牌照旧要给');
  assert.equal(one.result.body.hostId, '', '退化：给空串，手机按地址记');
});

test('旧行为不回退：没有 hostId 依赖时也能配对成功，响应里是空串', async () => {
  const security = createRequestSecurity();
  const pairing = createPairing();
  const server = await startRouter([], {
    security,
    log: () => {},
    status: () => ({ ok: true }),
    landingPage: () => '<html></html>',
    pairing,
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    // 这个用例刻意不提供 mobile 依赖（老版本形态），所以直接从 pairing 上拿票
    const pin = pairing.issue().pin;
    const response = await fetch(`${base}/pair`, {
      method: 'POST',
      // 回环（本机测试）路径要令牌；真机走远程路径时 /pair 本就免令牌，见 mobile-pairing.test.ts
      headers: { 'content-type': 'application/json', 'X-DSH-Pet-Token': security.token },
      body: JSON.stringify({ pin, deviceId: 'old-phone' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as PairResult['body'];
    assert.equal(body.ok, true);
    assert.equal(body.hostId, '');
  } finally {
    await server.close();
  }
});
