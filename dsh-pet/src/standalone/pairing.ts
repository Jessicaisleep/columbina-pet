/**
 * 手机配对码 —— 把 43 字符的进程令牌「借」给手机的那一步。
 *
 * 为什么需要它：令牌是 32 字节随机数，只经「配置页地址的 #token=」递到浏览器（见
 * request-security.ts）。手机不可能手输 43 个字符，而把它印在二维码里又意味着任何
 * 拍到你屏幕的相机都能拿到它。所以中间加一道**人肉短码**：电脑上点一下生成 6 位数字，
 * 手机填地址 + 这 6 位，换回令牌。短码本身不能当凭证用（5 分钟、5 次机会、一次性），
 * 且**只有用户主动点「手机连接」时才存在** —— 平时这个接口就是 404。
 *
 * 安全边界（刻意这么划）：
 *   - 短码用 `randomInt` 而非 Math.random；比对走 timingSafeEqual。
 *   - 只存哈希？不必 —— 短码只有 6 位，哈希挡不住穷举，真正的防线是「次数 + 有效期」。
 *   - 失败次数用尽即作废（不是「等 5 分钟自然过期」），否则攻击者可以慢慢试。
 *   - 换到令牌之后短码立刻失效（一次性），避免同一码被第二台设备复用。
 *   - 全程不写日志、不落盘。
 */
import { randomInt, timingSafeEqual } from 'node:crypto';

/** 短码有效期：5 分钟。手机连一次够用，泄露窗口足够小。 */
export const PAIR_TTL_MS = 5 * 60 * 1000;
/** 允许的失败次数：用尽即作废。 */
export const PAIR_MAX_ATTEMPTS = 5;

export interface PairingTicket {
  /** 6 位数字，含前导零 */
  readonly pin: string;
  /** 毫秒时间戳；到点后 `current()` 返回 undefined */
  readonly expiresAt: number;
  /** 已用掉的尝试次数（成功也算一次，成功后整张票作废） */
  readonly attempts: number;
}

export interface Pairing {
  /** 当前有效的票（未生成 / 已过期 / 已用尽 → undefined） */
  current(): PairingTicket | undefined;
  /** 生成一张新票（覆盖旧票）。只有用户在设置页显式点击时才该调用。 */
  issue(): PairingTicket;
  /** 作废当前票 */
  cancel(): void;
  /**
   * 用手机提交的短码兑换。成功返回 true 并把票作废；失败计入次数。
   * 票不存在/已过期时也返回 false（调用方给同一句错误，不泄露「是不是过期了」）。
   */
  claim(pin: string): boolean;
}

const DIGITS = /^\d{6}$/;

export function createPairing(now: () => number = Date.now): Pairing {
  let ticket: PairingTicket | undefined;

  const alive = (): PairingTicket | undefined => {
    if (!ticket) return undefined;
    if (ticket.attempts >= PAIR_MAX_ATTEMPTS) return undefined;
    if (now() >= ticket.expiresAt) return undefined;
    return ticket;
  };

  return {
    current() {
      const live = alive();
      if (!live) return undefined;
      // 不把 attempts 的细节暴露给调用方以外的地方也没意义；原样给出，路由自己决定显示什么
      return live;
    },
    issue() {
      ticket = {
        // 000000–999999 全范围，含前导零（用户看到的永远是 6 位）
        pin: String(randomInt(0, 1_000_000)).padStart(6, '0'),
        expiresAt: now() + PAIR_TTL_MS,
        attempts: 0,
      };
      return ticket;
    },
    cancel() {
      ticket = undefined;
    },
    claim(pin: string) {
      const live = alive();
      if (!live) return false;
      if (!DIGITS.test(pin)) {
        // 格式就不对：也算一次尝试。否则攻击者可以先无限次发垃圾试探服务端行为。
        ticket = { ...live, attempts: live.attempts + 1 };
        return false;
      }
      // 长度已经由 DIGITS 保证相同，timingSafeEqual 不会抛
      const ok = timingSafeEqual(Buffer.from(pin), Buffer.from(live.pin));
      if (!ok) {
        ticket = { ...live, attempts: live.attempts + 1 };
        return false;
      }
      ticket = undefined; // 一次性：换到令牌即作废
      return true;
    },
  };
}
