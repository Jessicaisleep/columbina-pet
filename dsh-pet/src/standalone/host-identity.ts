/**
 * 宿主身份（2026-11-01）—— 让「手机同时记住几台电脑」成为可能。
 *
 * 为什么需要它：一台手机可能先后配对过两台电脑（家里的插件端 2 只、独立端 3 只），
 * 而这两台的地址（ip:port）会随网络变化、端口还会自动顺延，拿地址当身份键，第二天就
 * 认不出谁是谁了。所以在**每台电脑自己的数据目录里**生成一个长期不变的 id：手机按 id
 * 记住「这台是谁」，地址变了只影响这一条，不会把两台电脑的记录混成一份。
 *
 * 落在 `$DSH_HOME/dsh-pet/host-id`（与 mobile.json / paired-devices.json 同目录）：
 * 用户要备份或迁移手机连接，这三个文件一起搬即可。**不含任何密钥**。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOST_ID_FILE = 'host-id';

/** 文件里最多认这么多字符：被别的东西写脏了也不能把一整块垃圾带进响应。 */
const MAX_ID_CHARS = 64;

/**
 * 进程内缓存：同一个进程里反复问必须给同一个答案。
 * 读盘失败时尤其重要 —— 没有缓存就会每次现生成一个新 id，手机那边立刻多出一堆「新电脑」。
 */
let cached: { home: string; id: string } | undefined;

export function readHostId(home: string): string {
  if (cached !== undefined && cached.home === home) return cached.id;
  const directory = join(home, 'dsh-pet');
  const path = join(directory, HOST_ID_FILE);
  let id = '';
  try {
    if (existsSync(path)) id = readFileSync(path, 'utf8').trim().slice(0, MAX_ID_CHARS);
  } catch {
    id = '';
  }
  if (id === '') {
    id = randomUUID();
    try {
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
      writeFileSync(path, `${id}\n`, 'utf8');
    } catch {
      // 写不进去也给一个能用的 id：这一次手机照样能配对，只是下次启动它会变成「另一台」，
      // 手机那边最多多出一条待删的宿主记录 —— 比「配不成对」轻得多。
    }
  }
  cached = { home, id };
  return id;
}
