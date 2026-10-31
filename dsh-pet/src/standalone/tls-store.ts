/**
 * 手机连接的 TLS 证书落盘与复用。
 *
 * 为什么必须持久化：自签证书如果每次启动重生成，手机浏览器里「已接受」的记录就失效，
 * 用户每次开桌宠都要再点一遍「继续前往」。所以证书与私钥存在 `<home>/dsh-pet/tls/` 下，
 * 只有缺失或过期时才重新生成。
 *
 * 私钥权限：Windows 上尽力收紧到「仅当前用户」。这里**不因为收不紧就不启动** ——
 * 与 standalone-ai.json 的 ACL 硬门不同，那张证书只能用来冒充本机手机页，
 * 而手机页本身还要配对码与令牌；为它让整个桌宠起不来是本末倒置。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSelfSignedCertificate, type TlsMaterial } from './tls-cert';

/** 证书剩余有效期少于这个天数就重签（避免用户正好在过期当天打开）。 */
const RENEW_BEFORE_DAYS = 30;
const CERT_DAYS = 3650;

function tlsDir(home: string): string {
  return join(home, 'dsh-pet', 'tls');
}

/**
 * 读取（必要时生成）证书。`addresses` 变了（换了网段/连了别的 WiFi）也要重签 ——
 * 否则新 IP 不在 SAN 里，浏览器连「继续前往」都不给，直接硬失败。
 */
export function ensureTlsMaterial(home: string, addresses: string[], log?: (message: string) => void): TlsMaterial {
  const dir = tlsDir(home);
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  const metaPath = join(dir, 'meta.json');

  const usable = (): TlsMaterial | null => {
    if (!existsSync(keyPath) || !existsSync(certPath) || !existsSync(metaPath)) return null;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        addresses?: unknown;
        notAfter?: unknown;
      };
      const previous = Array.isArray(meta.addresses)
        ? meta.addresses.filter((a): a is string => typeof a === 'string')
        : [];
      // 地址集合变化 → 重签（只关心手机真正会用的那些 IP）
      const wanted = [...new Set(addresses)].sort();
      const have = [...new Set(previous)].sort();
      if (wanted.length !== have.length || wanted.some((a, i) => a !== have[i])) return null;
      const notAfter = Number(meta.notAfter);
      if (!Number.isFinite(notAfter)) return null;
      if (notAfter - Date.now() < RENEW_BEFORE_DAYS * 24 * 3600 * 1000) return null;
      return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
    } catch {
      return null;
    }
  };

  const existing = usable();
  if (existing) return existing;

  const material = createSelfSignedCertificate(addresses, { days: CERT_DAYS });
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, material.key, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(certPath, material.cert, 'utf8');
  writeFileSync(
    metaPath,
    JSON.stringify(
      { version: 1, addresses: [...new Set(addresses)], notAfter: Date.now() + CERT_DAYS * 24 * 3600 * 1000 },
      null,
      2,
    ),
    'utf8',
  );
  log?.(`手机连接证书已${existing === null ? '生成' : '更新'}（${addresses.join(', ') || '仅回环'}）`);
  return material;
}
