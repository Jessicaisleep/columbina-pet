/**
 * 自签证书与落盘复用。
 *
 * 这些断言防的是「生成的证书浏览器不认」—— 那是整条手机链路里最难现场排查的失败：
 * 页面打不开，但没有任何日志，用户只会看到「连接不安全」。所以这里把浏览器认的硬条件
 * 全部钉住：SAN 里必须有 IP（Chrome 从 58 起完全不看 CN）、CA 必须为 FALSE、能自校验。
 */
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { createSelfSignedCertificate } from './tls-cert.ts';
import { ensureTlsMaterial } from './tls-store.ts';

const scratch: string[] = [];
function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-tls-'));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('createSelfSignedCertificate —— 浏览器认不认', () => {
  it('SAN 里带上局域网 IP（Chrome 只认 SAN，不看 CN）', () => {
    const material = createSelfSignedCertificate(['192.168.1.7', '10.2.3.4']);
    const cert = new X509Certificate(material.cert);
    const san = cert.subjectAltName ?? '';
    assert.match(san, /IP Address:192\.168\.1\.7/);
    assert.match(san, /IP Address:10\.2\.3\.4/);
    // 回环与 localhost 永远要带：用户也可能在电脑本机用 https 打开
    assert.match(san, /IP Address:127\.0\.0\.1/);
    assert.match(san, /DNS:localhost/);
  });

  it('CA 为 FALSE —— 这张证书不能拿去签别的域名', () => {
    const cert = new X509Certificate(createSelfSignedCertificate(['192.168.1.7']).cert);
    assert.equal(cert.ca, false);
  });

  it('是有效期内、可自校验的 RSA 证书', () => {
    const material = createSelfSignedCertificate(['192.168.1.7'], { days: 30 });
    const cert = new X509Certificate(material.cert);
    const notBefore = Date.parse(cert.validFrom);
    const notAfter = Date.parse(cert.validTo);
    const now = Date.now();
    assert.ok(notBefore <= now, '生效时间必须早于现在（容忍两端时钟偏差）');
    assert.ok(notAfter > now, '必须还没过期');
    // 自签：issuer 与 subject 相同
    assert.equal(cert.issuer, cert.subject);
    assert.ok(cert.verify(cert.publicKey), '自签证书应当能用自身公钥验签');
  });

  it('私钥与证书配对（不配对的话 TLS 握手会直接失败）', () => {
    const material = createSelfSignedCertificate(['192.168.1.7']);
    const key = createPrivateKey(material.key);
    const cert = new X509Certificate(material.cert);
    assert.equal(cert.checkPrivateKey(key), true);
    assert.equal(key.asymmetricKeyType, 'rsa');
  });

  it('地址为空也能出一张可用证书（只有回环与 localhost）', () => {
    const cert = new X509Certificate(createSelfSignedCertificate([]).cert);
    const san = cert.subjectAltName ?? '';
    assert.match(san, /IP Address:127\.0\.0\.1/);
    assert.equal(cert.ca, false);
  });
});

describe('ensureTlsMaterial —— 落盘复用与重签', () => {
  it('第一次调用生成三份文件，第二次原样复用（手机不用重新点证书警告）', () => {
    const home = makeHome();
    const first = ensureTlsMaterial(home, ['192.168.1.7']);
    const dir = join(home, 'dsh-pet', 'tls');
    for (const name of ['key.pem', 'cert.pem', 'meta.json']) {
      assert.ok(existsSync(join(dir, name)), `${name} 应当落盘`);
    }
    const second = ensureTlsMaterial(home, ['192.168.1.7']);
    assert.equal(second.cert, first.cert, '同样的地址不应重签');
    assert.equal(second.key, first.key);
  });

  it('地址集合变了就重签 —— 否则新 IP 不在 SAN 里，浏览器连「继续前往」都不给', () => {
    const home = makeHome();
    const first = ensureTlsMaterial(home, ['192.168.1.7']);
    const second = ensureTlsMaterial(home, ['192.168.1.9']);
    assert.notEqual(second.cert, first.cert);
    assert.match(new X509Certificate(second.cert).subjectAltName ?? '', /IP Address:192\.168\.1\.9/);
  });

  it('地址顺序不同不算变化（换网卡枚举顺序不该让用户重装证书）', () => {
    const home = makeHome();
    const first = ensureTlsMaterial(home, ['192.168.1.7', '10.0.0.2']);
    const second = ensureTlsMaterial(home, ['10.0.0.2', '192.168.1.7']);
    assert.equal(second.cert, first.cert);
  });

  it('证书快过期时重签', () => {
    const home = makeHome();
    const first = ensureTlsMaterial(home, ['192.168.1.7']);
    const metaPath = join(home, 'dsh-pet', 'tls', 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    // 只剩 3 天：早于 RENEW_BEFORE_DAYS（30 天）的门限
    writeFileSync(metaPath, JSON.stringify({ ...meta, notAfter: Date.now() + 3 * 24 * 3600 * 1000 }), 'utf8');
    const second = ensureTlsMaterial(home, ['192.168.1.7']);
    assert.notEqual(second.cert, first.cert);
  });

  it('文件坏掉时重新生成，而不是让手机连接整个不可用', () => {
    const home = makeHome();
    ensureTlsMaterial(home, ['192.168.1.7']);
    writeFileSync(join(home, 'dsh-pet', 'tls', 'meta.json'), '{ 这不是 JSON', 'utf8');
    const material = ensureTlsMaterial(home, ['192.168.1.7']);
    assert.ok(material.cert.includes('BEGIN CERTIFICATE'));
    assert.equal(new X509Certificate(material.cert).ca, false);
  });
});
