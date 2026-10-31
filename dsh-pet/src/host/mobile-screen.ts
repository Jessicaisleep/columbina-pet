/**
 * 手机端推上来的「此刻屏幕文字」（2026-10-31）。
 *
 * <p><b>为什么需要独立一层</b>：桌面端的读屏（`./screen-context`）走 PowerShell
 * UIAutomation，读的是**电脑**的前台窗口。手机上聊的时候，用户眼前的东西在另一块屏，
 * 电脑那份上下文帮不上忙。所以手机端用 AccessibilityService 自己抓、通过 HTTP 推上来，
 * 这里只负责「保管最近一次 + 判断够不够新」。
 *
 * <p><b>三条硬约束</b>（都是为了让「过期屏幕」不会污染 prompt）：
 * <ol>
 *   <li><b>只留最近一次</b>：这是「此刻环境」不是历史，堆着旧的只会误导；</li>
 *   <li><b>带过期时间</b>（{@link MOBILE_SCREEN_TTL_MS}）：手机锁屏半小时后再上传的
 *       内容早就不是用户在看的东西了，宁可当作没读到；</li>
 *   <li><b>只在内存里</b>：屏幕内容可能含隐私（聊天记录、表单），不落盘、不进日志全文
 *       （日志只打字数与包名）。</li>
 * </ol>
 */
import type { ScreenSnapshot } from './screen-context';

/** 手机屏幕快照的有效期：超过它就当作「没读到」。 */
export const MOBILE_SCREEN_TTL_MS = 90_000;

/** 与桌面端 `screenContextOf` 的默认上限保持一致（见 screen-context.ts）。 */
export const MOBILE_SCREEN_MAX_CHARS = 1200;

export interface MobileScreen {
  /** 前台应用的包名（如 com.tencent.mm）——用于粗判用户在用什么。 */
  pkg: string;
  /** 无障碍树里抓到的文字片段（` | ` 分隔）。 */
  text: string;
  /** 上传时刻（ms）。 */
  at: number;
  /** 字数（预先算好，日志与渲染都用它，避免反复算）。 */
  chars: number;
}

/**
 * 最近一次手机屏幕快照的保管箱。
 *
 * <p>做成类而不是模块级变量：宿主可以被多次 `apply`（测试里每个用例一个 ctx），
 * 模块级状态会串味。实例挂在 host 的作用域里，生命周期与宿主一致。
 */
export class MobileScreenStore {
  // 用 declare + 构造器赋值（与 src/host/helper-process.ts 同一约定）：写成类字段初始化时，
  // es2020 目标会把它降级成 `_defineProperty(...)` 并拉进 `@oxc-project/runtime` 那条裸 import
  // —— 本包没声明这个依赖，prepack-check 会红，装好的用户也可能 ERR_MODULE_NOT_FOUND。
  declare private last: MobileScreen | undefined;

  constructor() {
    this.last = undefined;
  }

  /** 记一次上传。空 текст按「没读到」处理（清掉旧的，而不是留着一个空壳）。 */
  put(input: { pkg?: unknown; text?: unknown }, now: number = Date.now()): MobileScreen | undefined {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (text === '') {
      this.last = undefined;
      return undefined;
    }
    // 截断在这里做一次：上游（手机 AccessibilityService）也有自己的上限，但那是它那一侧的事，
    // 宿主不能信任外部输入的长度。
    const clipped = text.length > MOBILE_SCREEN_MAX_CHARS ? text.slice(0, MOBILE_SCREEN_MAX_CHARS) : text;
    this.last = {
      pkg: typeof input.pkg === 'string' ? input.pkg.trim() : '',
      text: clipped,
      at: now,
      chars: clipped.length,
    };
    return this.last;
  }

  /** 取一份「还新鲜」的快照；过期或没有 → undefined。 */
  fresh(now: number = Date.now()): MobileScreen | undefined {
    if (!this.last) return undefined;
    if (now - this.last.at > MOBILE_SCREEN_TTL_MS) return undefined;
    return this.last;
  }

  /** 当前状态（供 /state 或设置页诊断用）：有没有、多旧。 */
  status(now: number = Date.now()): { present: boolean; chars: number; ageMs: number; pkg: string } {
    if (!this.last) return { present: false, chars: 0, ageMs: 0, pkg: '' };
    return { present: true, chars: this.last.chars, ageMs: now - this.last.at, pkg: this.last.pkg };
  }

  /** 清空（用户关掉读屏开关时该调用，避免残留内容下次被用上）。 */
  clear(): void {
    this.last = undefined;
  }
}

/**
 * 把手机快照渲染成 prompt 段。
 *
 * <p>措辞与桌面端的 `screenContextOf` 刻意保持一致（同一个「【用户此刻的屏幕】」抬头），
 * 这样模型不需要区分来源；但在末尾补一句「这是手机上的画面」，因为**这决定了它该用
 * 手机的语气还是电脑的语气**接话（比如「你在看微信，那我小点声」）。
 */
export function mobileScreenSection(snap: MobileScreen): string {
  return (
    '\n\n【用户此刻的屏幕】' +
    (snap.pkg ? `（手机，前台应用 ${snap.pkg}）` : '（手机）') +
    '：\n' +
    snap.text +
    '\n（这是用户手机屏幕上的文字，不是电脑。可以自然地接上，但不要逐条复述。）'
  );
}

/**
 * 把手机快照适配成 {@link ScreenSnapshot} 形状，供 `read_screen` 工具复用。
 *
 * <p>为什么复用桌面那个类型：`read_screen` 工具已经按 `ScreenSnapshot` 写好了
 * （title/cls/pid/text/pieces/truncated/ms/stale），手机端硬造第二种形状只会让
 * 工具层出现两条分支。这里用 title 放包名、cls 标 `mobile`，语义上完全够用。
 */
export function mobileAsSnapshot(snap: MobileScreen, now: number = Date.now()): ScreenSnapshot {
  return {
    title: snap.pkg || '手机',
    cls: 'mobile',
    pid: 0,
    text: snap.text,
    pieces: snap.text.split(' | ').filter((s) => s !== '').length,
    truncated: snap.chars >= MOBILE_SCREEN_MAX_CHARS,
    ms: Math.max(0, now - snap.at),
    stale: false,
  };
}
