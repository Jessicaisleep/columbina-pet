/**
 * 自签证书生成 —— 零依赖手写 DER。
 *
 * 为什么需要它：浏览器把 `http://192.168.x.x` 判为**非安全上下文**，
 * 于是 `navigator.mediaDevices` 根本不存在、`SpeechRecognition` 一调就
 * `not-allowed`。实测读数（Edge，局域网 IP）：http 下 getUserMedia 连函数都没有，
 * https（哪怕证书不被信任、用户手点「继续前往」）下 `isSecureContext` 就是 true，
 * getUserMedia 与 SpeechRecognition 双双可用。所以「手机上能不能用语音」这一条，
 * 完全取决于手机页是不是 https。
 *
 * 为什么不引 selfsigned / node-forge：这两个包会把 @peculiar/x509 + pkijs 一整套
 * ASN.1 库拉进来（十几万行），只为签一张一次性证书；而分发场景最怕依赖变多。
 * node:crypto 已经能生成密钥、能导出 SPKI、能签名，缺的只是 DER 拼装，约 100 行。
 *
 * 证书里必须带 subjectAltName：Chrome 从 58 起不再看 CN，只认 SAN，
 * 只写 CN 的证书在任何现代浏览器里都是硬失败（连「继续前往」都不给）。
 */
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export interface TlsMaterial {
  key: string;
  cert: string;
}

// ── DER 基本编码 ────────────────────────────────────────────────────────────

function lengthBytes(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let value = n;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
}

const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
const octet = (body: Buffer): Buffer => tlv(0x04, body);
const bitString = (body: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), body]));
const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const utf8 = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'));
/** 上下文标签（EXPLICIT，构造型）：tag 0xa0 + n */
const explicit = (n: number, body: Buffer): Buffer => tlv(0xa0 + n, body);

/** OID 编码：首字节 = 40*第一段 + 第二段，其后每段 7 位一组、最高位续位标记。 */
function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let value = part >>> 7;
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** 正整数：去掉前导零后若最高位为 1 要补一个 0x00，否则会被读成负数。 */
function integer(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let body = bytes.subarray(start);
  if ((body[0] & 0x80) !== 0) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

/**
 * 时间：2050 年前用 UTCTime（两位年），之后用 GeneralizedTime（四位年）。
 * 写错这一处会让证书在部分客户端被解析成 1950 年，表现是「证书已过期」。
 */
function time(date: Date): Buffer {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const stamp =
    `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  if (year >= 1950 && year < 2050) return tlv(0x17, Buffer.from(`${pad(year % 100)}${stamp}`, 'ascii'));
  return tlv(0x18, Buffer.from(`${year}${stamp}`, 'ascii'));
}

function rdn(commonName: string, organization: string): Buffer {
  const cn = set(seq(oid('2.5.4.3'), utf8(commonName)));
  const org = set(seq(oid('2.5.4.10'), utf8(organization)));
  return seq(cn, org);
}

// ── 证书组装 ────────────────────────────────────────────────────────────────

const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));

/** 一个 IP 的 SAN 项：tag [7] 后直接跟 4 或 16 字节地址，不是字符串。 */
function sanEntry(address: string): Buffer {
  const v4 = address.split('.').map(Number);
  if (v4.length === 4 && v4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return tlv(0x87, Buffer.from(v4));
  }
  // IPv6：展开成 16 字节
  const halves = address.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const fill = new Array(8 - head.length - tail.length).fill('0');
  const groups = [...head, ...fill, ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group || '0', 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return tlv(0x87, Buffer.from(bytes.slice(0, 16)));
}

/**
 * 生成一张自签证书。`addresses` 里的 IP 会进 subjectAltName —— 手机访问的是
 * `https://<局域网 IP>:端口`，IP 不在 SAN 里浏览器同样只给硬失败页。
 */
export function createSelfSignedCertificate(
  addresses: string[],
  options: { days?: number; commonName?: string } = {},
): TlsMaterial {
  const days = options.days ?? 3650;
  const commonName = options.commonName ?? 'dsh-pet';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  // SPKI 直接由 crypto 导出，省掉自己编码 RSA 公钥（那里最容易把 INTEGER 符号位写错）
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000); // 回退一天，容忍两端时钟偏差
  const notAfter = new Date(now.getTime() + days * 24 * 3600 * 1000);

  const sanNames: Buffer[] = [tlv(0x82, Buffer.from('localhost', 'ascii')), sanEntry('127.0.0.1')];
  for (const address of addresses) {
    if (address !== '127.0.0.1') sanNames.push(sanEntry(address));
  }

  const extensions = explicit(
    3,
    seq(
      // basicConstraints: CA 必须为 FALSE，否则这张证书能被用来签别的域名
      seq(oid('2.5.29.19'), boolean(true), octet(seq())),
      // keyUsage: digitalSignature(0) + keyEncipherment(2)
      seq(oid('2.5.29.15'), boolean(true), octet(bitString(Buffer.from([0xa0])))),
      // extKeyUsage: serverAuth
      seq(oid('2.5.29.37'), octet(seq(oid('1.3.6.1.5.5.7.3.1')))),
      seq(oid('2.5.29.17'), octet(seq(...sanNames))),
    ),
  );

  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // version v3
    integer(randomBytes(16)),
    SHA256_RSA,
    rdn(commonName, commonName),
    seq(time(notBefore), time(notAfter)),
    rdn(commonName, commonName),
    spki,
    extensions,
  );

  const signature = sign('sha256', tbs, createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })));
  const certificate = seq(tbs, SHA256_RSA, bitString(signature));

  const toPem = (label: string, der: Buffer): string => {
    const body = der
      .toString('base64')
      .replace(/(.{64})/g, '$1\n')
      .trimEnd();
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
  };

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: toPem('CERTIFICATE', certificate),
  };
}
