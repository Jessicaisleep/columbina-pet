/**
 * 手机连接设置 —— 一个**独立的小文件**，不塞进 main-config.jsonc。
 *
 * 为什么不复用主配置：`main-config.jsonc` 的 schema 归 host 的 config.ts 管（宠物合并、
 * 字段默认值、迁移都有严格处理），往顶层塞一个未知键要么被静默忽略、要么哪天被校验拒掉。
 * 而这项设置的生命周期也完全不同：它决定的是「服务绑哪张网卡」，属于**启动期**决策。
 *
 * 文件形态刻意留了将来加字段的余地（`version`），且**不含任何密钥** ——
 * 令牌是每次进程启动重新随机的（见 request-security.ts），从不落盘。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

export interface MobileConfig {
  /** 是否允许局域网/远程设备访问。false = 服务只绑回环（改造前的行为）。 */
  enabled: boolean;
  /** 对外监听端口。仅 enabled 时有意义；被占用会自动向后顺延。 */
  port: number;
}

const DEFAULT_MOBILE: MobileConfig = { enabled: false, port: 7340 };
const MAX_BYTES = 4096;

function configFile(home: string): string {
  return join(home, 'dsh-pet', 'mobile.json');
}

export function readMobileConfig(home: string): MobileConfig {
  const path = configFile(home);
  if (!existsSync(path)) return { ...DEFAULT_MOBILE };
  try {
    if (readFileSync(path).byteLength > MAX_BYTES) return { ...DEFAULT_MOBILE };
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<MobileConfig> | null;
    const enabled = raw?.enabled === true;
    const port = Number(raw?.port);
    return {
      enabled,
      port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_MOBILE.port,
    };
  } catch {
    // 坏文件按默认（只回环）处理：宁可手机连不上，也不要因为一个解析错误把服务暴露出去
    return { ...DEFAULT_MOBILE };
  }
}

export function writeMobileConfig(home: string, next: MobileConfig): void {
  const directory = join(home, 'dsh-pet');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const path = configFile(home);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, ...next }, null, 2), 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* 临时文件可能已被 rename 掉 */
    }
    throw error;
  }
}

/**
 * 本机在局域网里的地址（给用户填到手机上）。
 *
 * 只挑非内部 IPv4，并按「像家里的网段」排序：192.168/10/172.16-31 优先，
 * 其它（如 100.64.x = Tailscale CGNAT、或虚拟网卡）排后面。
 * 拿不到就返回 undefined —— 调用方要如实显示「没检测到局域网地址」，
 * 绝不能拿 127.0.0.1 冒充（手机会连到自己）。
 */
export function lanAddresses(): string[] {
  const found: Array<{ address: string; score: number }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const a = item.address;
      let score = 0;
      if (a.startsWith('192.168.')) score = 3;
      else if (a.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) score = 2;
      else if (a.startsWith('100.')) score = 1; // Tailscale 常见
      // 虚拟网卡（VMware/VirtualBox/Hyper-V）容易误导用户，压低但不排除
      if (/vmware|virtualbox|vbox|hyper-v|vethernet|loopback/i.test(name)) score -= 2;
      found.push({ address: a, score });
    }
  }
  return found.sort((x, y) => y.score - x.score || x.address.localeCompare(y.address)).map((item) => item.address);
}
