/**
 * 已配对手机登记表 + 「手机接管」判定（2026-11-01，用户拍板的固定手机优先）。
 *
 * 用户定的规则只有两条（原话：「同步是即时的，不存在两份」「不在同 WIFI 只有手机能用」）：
 *
 *   | 情况 | 谁能写记忆 | 表现 |
 *   |---|---|---|
 *   | 手机连着这台电脑（同一网络） | **电脑**（手机只拿副本） | 两端都能聊，写同一份 |
 *   | 手机连不到这台电脑 | **只有手机** | 电脑转只读，界面明说原因 |
 *
 * 判定「连没连上」不用 SSID、不用网段（4G、热点、VPN 都骗不过）：**看这台电脑最近有没有
 * 收到过那台手机的请求**。手机每 10 秒长轮询一次 `/state`，所以只要它在同一网络，
 * 心跳必然新鲜；它出门/关机/断网，心跳就停。
 *
 * 为什么必须由**电脑**自己判断：只有电脑知道自己收没收到请求。手机端的判断永远乐观
 * （它以为还在，实际打不通），用它当依据等于两边都以为自己是写者。
 *
 * 代价（用户已接受）：手机没电/忘在公司 = 打不到电脑 = 电脑也写不了。这是「宁可哑一天，
 * 不要分叉」的自觉选择，**不要**加「强制电脑可写」的后门 —— 那等于把分叉重新引入。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 登记文件名（与 mobile.json 同目录：`<home>/dsh-pet/paired-devices.json`） */
export const PAIRED_DEVICES_FILE = 'paired-devices.json';

/**
 * 心跳宽容期：超过这么久没收到任何请求，就判定「手机不在这台电脑旁边」。
 *
 * 45 秒 = 手机侧 `/state` 长轮询（10s 一轮）+ 一次重试 + 一次网络抖动的余量。
 * 太短 → 手机锁屏省电时被判离线；太长 → 拔网后电脑还会替它写几十秒（这段时间正好是
 * 「两边各写一句」的窗口）。45 秒是这两件事的折中，改它请同时改 `mobile-page.ts` 的轮询间隔。
 */
export const OFFLINE_GRACE_MS = 45_000;

export interface PairedDevice {
  /** 手机自己生成的稳定标识（存 localStorage），用来区分「同一台」与「新设备」 */
  id: string;
  /** 显示名（型号/别名，可空） */
  name: string;
  /** 第一次配对时间（ms） */
  pairedAt: number;
  /** 最后一次收到它请求的时间（ms）——判定接管就靠这个 */
  lastSeenAt: number;
}

export function pairedDevicesPath(home: string): string {
  return join(home, 'dsh-pet', PAIRED_DEVICES_FILE);
}

/** 解析登记表：坏文件/坏条目一律丢，绝不让一条脏数据把整表废掉（废掉就等于用户被永久只读） */
export function parseDevices(text: string): PairedDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { devices?: unknown })?.devices;
  if (!Array.isArray(list)) return [];
  const out: PairedDevice[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const id = typeof d.id === 'string' ? d.id.trim() : '';
    if (id === '') continue;
    out.push({
      id,
      name: typeof d.name === 'string' ? d.name : '',
      pairedAt: typeof d.pairedAt === 'number' && Number.isFinite(d.pairedAt) ? d.pairedAt : 0,
      lastSeenAt: typeof d.lastSeenAt === 'number' && Number.isFinite(d.lastSeenAt) ? d.lastSeenAt : 0,
    });
  }
  return out;
}

export function serializeDevices(list: PairedDevice[]): string {
  return JSON.stringify({ devices: list }, null, 2);
}

/** 登记/刷新一台设备（同 id 视为同一台：保留原 pairedAt，刷新 name 与 lastSeenAt） */
export function upsertDevice(
  list: PairedDevice[],
  device: { id: string; name?: string; seenAt: number },
  now: number = device.seenAt,
): PairedDevice[] {
  const id = device.id.trim();
  if (id === '') return list;
  const next: PairedDevice[] = [];
  let hit = false;
  for (const d of list) {
    if (d.id === id) {
      hit = true;
      next.push({ id, name: device.name ?? d.name, pairedAt: d.pairedAt || now, lastSeenAt: device.seenAt });
    } else {
      next.push(d);
    }
  }
  if (!hit) next.push({ id, name: device.name ?? '', pairedAt: now, lastSeenAt: device.seenAt });
  return next;
}

export function removeDevice(list: PairedDevice[], id: string): PairedDevice[] {
  return list.filter((d) => d.id !== id.trim());
}

/**
 * 手机是否「不在这台电脑旁边」（= 电脑该转只读了）。
 *
 * - 一台都没登记过 → `false`。没配过手机的用户不该被这个机制碰到（否则第一次装就是只读）。
 * - 登记过任意一台，且**所有**设备的心跳都过期 → `true`。
 *   「任意一台在线就算在家」：用户的场景是一台手机，但多设备时不因为副机离线就锁电脑。
 */
export function phoneTakeover(list: PairedDevice[], now: number, graceMs: number = OFFLINE_GRACE_MS): boolean {
  if (list.length === 0) return false;
  const newest = list.reduce((max, d) => (d.lastSeenAt > max ? d.lastSeenAt : max), 0);
  if (newest === 0) return true; // 登记过但一次心跳都没收到（配对后立刻断）→ 按离线处理
  return now - newest > graceMs;
}

/** 给用户看的接管说明（电脑端界面与日志共用同一句，别各写一套） */
export function takeoverReason(minutesAgo?: number): string {
  const tail =
    minutesAgo === undefined
      ? ''
      : `（最后一次连上是 ${minutesAgo <= 0 ? '刚刚' : minutesAgo + ' 分钟前'}）`;
  return '手机不在同一网络，现在由手机那边接着记对话' + tail + '。电脑这边先不写，免得两边对不上；手机回到这个网络就自动恢复。';
}

/**
 * 登记表文件形状（2026-11-01）：
 *
 *   { "devices": [...], "revoked": ["设备 id", ...] }
 *
 * `revoked` 存在的理由：令牌是**进程级**的（每次重启换新），删除设备时没法把令牌就地作废
 * 而不影响别的会话。所以删除 = 从 devices 移除 + 把 id 记进 revoked，之后这台手机的请求
 * 一律 403 要求重新配对。重启后令牌本身就换了，revoked 里的旧 id 自然失效（可以留着，无害）。
 */
export interface PairedTable {
  devices: PairedDevice[];
  revoked: string[];
}

export function parseTable(text: string): PairedTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { devices: [], revoked: [] };
  }
  const obj = (parsed ?? {}) as { devices?: unknown; revoked?: unknown };
  const revokedRaw = Array.isArray(obj.revoked) ? obj.revoked : [];
  const revoked: string[] = [];
  for (const raw of revokedRaw) {
    if (typeof raw === 'string' && raw.trim() !== '') revoked.push(raw.trim());
  }
  return { devices: parseDevices(text), revoked };
}

export function serializeTable(table: PairedTable): string {
  return JSON.stringify({ devices: table.devices, revoked: table.revoked }, null, 2);
}

/** 读登记表；文件不存在/坏掉 = 空表（没配过手机） */
export async function readTable(home: string): Promise<PairedTable> {
  try {
    const text = await readFile(pairedDevicesPath(home), 'utf8');
    return parseTable(text);
  } catch {
    return { devices: [], revoked: [] };
  }
}

export async function writeTable(home: string, table: PairedTable): Promise<void> {
  await mkdir(join(home, 'dsh-pet'), { recursive: true });
  await writeFile(pairedDevicesPath(home), serializeTable(table), 'utf8');
}

/**
 * 刷新某台设备的心跳（手机每一次带令牌的请求都会调它）。
 *
 * 只在「上次记录比 now - minGapMs 更早」时写盘：手机每 10 秒轮询一次，每轮都写一次文件
 * 既没必要也伤盘。默认 15 秒一跳，足够让 45 秒的宽容期判断成立。
 */
export async function touchDevice(
  home: string,
  device: { id: string; name?: string; at: number },
  minGapMs = 15_000,
): Promise<PairedTable> {
  const table = await readTable(home);
  const id = device.id.trim();
  if (id === '') return table;
  const known = table.devices.find((d) => d.id === id);
  // 没登记过的 id 不写：登记只发生在配对成功那一刻（否则任何拿到令牌的人都能往表里塞设备）
  if (!known) return table;
  if (device.at - known.lastSeenAt < minGapMs) return table;
  const next: PairedTable = {
    devices: upsertDevice(table.devices, { id, name: device.name, seenAt: device.at }, device.at),
    revoked: table.revoked.filter((x) => x !== id),
  };
  await writeTable(home, next);
  return next;
}

/** 配对成功时登记（幂等：同一台手机重复配对不产生两条记录） */
export async function registerDevice(
  home: string,
  device: { id: string; name?: string; at: number },
): Promise<PairedTable> {
  const table = await readTable(home);
  const id = device.id.trim();
  if (id === '') return table;
  const next: PairedTable = {
    devices: upsertDevice(table.devices, { id, name: device.name, seenAt: device.at }, device.at),
    revoked: table.revoked.filter((x) => x !== id),
  };
  await writeTable(home, next);
  return next;
}

/** 删除一台设备：从登记表移除 + 记进 revoked（它的请求从此 403，需要重新配对） */
export async function dropDevice(home: string, id: string): Promise<PairedTable> {
  const table = await readTable(home);
  const key = id.trim();
  const next: PairedTable = {
    devices: removeDevice(table.devices, key),
    revoked: key === '' ? table.revoked : [...table.revoked.filter((x) => x !== key), key],
  };
  await writeTable(home, next);
  return next;
}

/** 这台设备是否已被移除（请求层用：是就 403 要求重新配对） */
export function isRevoked(table: PairedTable, id: string): boolean {
  const key = id.trim();
  return key !== '' && table.revoked.includes(key);
}