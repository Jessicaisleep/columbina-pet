/**
 * 把中文时间说法解析成一个**时间区间**，用于「按时间找往事」。
 *
 * 为什么需要这个模块（2026-10-30 用户提出）：
 *   「上周一我们聊了什么」这种问句里，`上周一` 这三个字**不会出现在往事正文里**，
 *   所以字面检索（bigram 倒排）对它完全失效——不管档案里有多少内容都捞不回来。
 *   时间是一个和「话题词」正交的维度，必须单独解析。
 *
 * 设计取舍：
 *  1. **只解析、不猜测**。认不出就返回 undefined，走原来的关键词检索；
 *     绝不"大概是最近一周吧"这种模糊兜底——那会在用户没问时间的时候篡改检索结果。
 *  2. **区间左闭右开**，全部按本地时区算（用户说「昨天」指的是他自己的昨天）。
 *  3. 周的定义按中文习惯：**周一到周日**为一周（不是 ISO 的周一到周日？这里恰好一致，
 *     但要注意 `getDay()` 里周日是 0，需要转成 7 才好算）。
 *  4. 不带年份的日期（「10月20日」）如果落在未来，按**去年**理解——
 *     "我们 10 月 20 日聊过什么" 在 10 月 5 日问出来，指的必然是去年那次。
 */

/** 时间区间（毫秒时间戳，左闭右开）+ 给人看的中文标签（回填 prompt 时会写出来） */
export interface TimeRange {
  /** 起点，含 */
  from: number;
  /** 终点，不含 */
  to: number;
  /** 例如「上周一（10月20日）」——写进 prompt 让模型知道这是哪一段 */
  label: string;
}

const DAY_MS = 86_400_000;

/** 当天 00:00 的时间戳（本地时区） */
function startOfDay(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** 星期几 → 1..7（周一=1，周日=7）。`Date#getDay()` 周日是 0，这里补齐成 7 */
function isoDow(d: Date): number {
  const g = d.getDay();
  return g === 0 ? 7 : g;
}

/** 本周周一 00:00 */
function startOfWeek(d: Date): number {
  return startOfDay(d) - (isoDow(d) - 1) * DAY_MS;
}

/** 某天所在月的 1 号 00:00 */
function startOfMonth(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x.getTime();
}

/** `M月D日` 的短标签 */
function mdOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 星期中文 */
const DOW_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 中文数字 / 阿拉伯数字 → 数（只处理 0~99，够用了：周几、几号、几天前） */
function numOf(s: string): number | undefined {
  if (/^\d+$/.test(s)) return Number(s);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (s === '十') return 10;
  if (s.length === 2 && s[0] === '十') return 10 + (map[s[1]] ?? 0);
  if (s.length === 2 && s[1] === '十') return (map[s[0]] ?? 0) * 10;
  if (s.length === 3 && s[1] === '十') return (map[s[0]] ?? 0) * 10 + (map[s[2]] ?? 0);
  return map[s];
}

/** 周几的字（一二三四五六日天）→ 1..7 */
function dowOf(ch: string): number | undefined {
  if (ch === '日' || ch === '天') return 7;
  const n = numOf(ch);
  return n !== undefined && n >= 1 && n <= 7 ? n : undefined;
}

/**
 * 解析「上周X / 这周X / 星期X」这类说法。
 * 返回某一天的 [00:00, 次日00:00)。
 */
function weekdayRange(weekOffset: number, dow: number, now: Date, labelPrefix: string): TimeRange {
  const weekStart = startOfWeek(now) - weekOffset * 7 * DAY_MS;
  const from = weekStart + (dow - 1) * DAY_MS;
  return {
    from,
    to: from + DAY_MS,
    label: `${labelPrefix}${DOW_CN[dow]}（${mdOf(from)}）`,
  };
}

/**
 * 解析时间说法。认不出返回 undefined（**不猜**）。
 *
 * 支持（按优先级从上到下匹配，先匹配更具体的）：
 *   具体日期：2026-10-20 / 2026/10/20 / 2026年10月20日 / 10月20日 / 10月20号
 *   相对周：上上周X / 上周X / 这周X / 本周X / 上星期X / 星期X / 周X（不带前缀=本周）
 *   相对日：今天 / 昨天 / 前天 / 大前天 / N天前
 *   相对月/年：上个月 / 上月 / 这个月 / 本月 / 去年 / 今年
 */
export function parseTimeRange(text: string, now: Date): TimeRange | undefined {
  const raw = typeof text === 'string' ? text : '';
  if (raw.trim() === '') return undefined;
  const s = raw.replace(/\s+/g, '');

  // ── 1. 完整日期：2026-10-20 / 2026/10/20 / 2026年10月20日 ──
  const full = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})[日号]?/);
  if (full) {
    const y = Number(full[1]);
    const mo = Number(full[2]);
    const d = Number(full[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const from = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
      if (Number.isFinite(from)) {
        return { from, to: from + DAY_MS, label: `${y}年${mo}月${d}日` };
      }
    }
    return undefined;
  }

  // ── 2. 带年词的具体日期：今年10月20日 / 去年12月25日 / 前年3月1号 ──
  //    **必须排在「只有月日」之前**：否则「去年12月25日」会被当成今年的 12 月 25 日。
  const ymPrefix = s.match(/(今年|去年|前年)(\d{1,2})月(\d{1,2})[日号]?/);
  if (ymPrefix) {
    const yOff = ymPrefix[1] === '去年' ? -1 : ymPrefix[1] === '前年' ? -2 : 0;
    const y = now.getFullYear() + yOff;
    const mo = Number(ymPrefix[2]);
    const d = Number(ymPrefix[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const from = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
      if (Number.isFinite(from)) {
        return { from, to: from + DAY_MS, label: `${y}年${mo}月${d}日` };
      }
    }
    return undefined;
  }

  // ── 3. 只有月日：10月20日 / 10月20号 ──
  const md = s.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const yNow = now.getFullYear();
      let from = new Date(yNow, mo - 1, d, 0, 0, 0, 0).getTime();
      // 落在未来 → 按去年那次理解（见文件头设计取舍第 4 条）
      if (from > now.getTime()) from = new Date(yNow - 1, mo - 1, d, 0, 0, 0, 0).getTime();
      return { from, to: from + DAY_MS, label: mdOf(from) };
    }
    return undefined;
  }

  // ── 3. 带周前缀：上上周X / 上周X / 上星期X / 这周X / 本周X / 这个星期X ──
  const weekPref = s.match(/(上上|上|这|本)(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (weekPref) {
    const off = weekPref[1] === '上上' ? 2 : weekPref[1] === '上' ? 1 : 0;
    const dow = dowOf(weekPref[2]);
    if (dow !== undefined) {
      const prefix = off === 2 ? '上上周' : off === 1 ? '上周' : '本周';
      return weekdayRange(off, dow, now, prefix);
    }
    return undefined;
  }

  // ── 4. 不带前缀的星期：星期X / 周X ──
  //    注意「上周」这类已被上一条吃掉；这里只剩裸的「周三」「星期三」。
  const bareWeek = s.match(/(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (bareWeek) {
    const dow = dowOf(bareWeek[1]);
    if (dow !== undefined) return weekdayRange(0, dow, now, '本周');
    return undefined;
  }

  // ── 5. 只给周不给天：上周 / 这周 / 上上周 ──
  const weekOnly = s.match(/(上上|上|这|本)(?:个)?(?:周|星期|礼拜)(?![\u4e00-\u9fff])/);
  if (weekOnly) {
    const off = weekOnly[1] === '上上' ? 2 : weekOnly[1] === '上' ? 1 : 0;
    const from = startOfWeek(now) - off * 7 * DAY_MS;
    const prefix = off === 2 ? '上上周' : off === 1 ? '上周' : '本周';
    return { from, to: from + 7 * DAY_MS, label: `${prefix}（${mdOf(from)}起一周）` };
  }

  // ── 6. 相对日：今天 / 昨天 / 前天 / 大前天 / N天前 ──
  //    这一步覆盖的是**人说话时真正会用到的叫法**，不只是标准词：
  //    今儿/今早/今晚、昨儿/昨晚、前日/前晚、刚才/刚刚……
  //    顺序：大前天 → 前天 → 昨天 → 今天，先长后短，
  //    否则「前天」会被「今天」的 `/今天/` 抢走（这是踩过的坑）。
  if (/大前天|大前日/.test(s)) {
    const from = startOfDay(now) - 3 * DAY_MS;
    return { from, to: from + DAY_MS, label: `大前天（${mdOf(from)}）` };
  }
  if (/前天|前日|前晚/.test(s)) {
    const from = startOfDay(now) - 2 * DAY_MS;
    return { from, to: from + DAY_MS, label: `前天（${mdOf(from)}）` };
  }
  if (/昨天|昨日|昨儿|昨晚|昨夜|昨早/.test(s)) {
    const from = startOfDay(now) - DAY_MS;
    return { from, to: from + DAY_MS, label: `昨天（${mdOf(from)}）` };
  }
  // 「刚才/刚刚」问的是眼下这一小段，不是某一天：给最近 2 小时。
  // 粒度比"日"细，但用户说"刚才"时想找的就是最近几句话，给一整天反而捞回太多。
  if (/刚才|刚刚|方才|刚说/.test(s)) {
    return {
      from: now.getTime() - 2 * 3_600_000,
      to: now.getTime() + 1,
      label: '刚才（最近两小时）',
    };
  }
  if (/今天|今日|今儿|今早|今晨|今晚|今夜/.test(s)) {
    const from = startOfDay(now);
    return { from, to: from + DAY_MS, label: `今天（${mdOf(from)}）` };
  }
  // 「这两天」= 昨天+今天；「这几天/这阵子」= 最近一周。
  // **故意不收裸的「最近」**：`我最近喜欢喝豆浆` 里的「最近」不是要查时间，
  // 收进来会把关键词检索整个顶掉，捞回一堆无关的近期对话。
  if (/这两天/.test(s)) {
    const from = startOfDay(now) - DAY_MS;
    return { from, to: startOfDay(now) + DAY_MS, label: `这两天（${mdOf(from)}起）` };
  }
  if (/这几天|这几日|这阵子|最近几天|最近几日/.test(s)) {
    const from = startOfDay(now) - 6 * DAY_MS;
    return { from, to: startOfDay(now) + DAY_MS, label: `这几天（最近一周）` };
  }
  const nDaysAgo = s.match(/([\d一二三四五六七八九十]{1,2})天前/);
  if (nDaysAgo) {
    const n = numOf(nDaysAgo[1]);
    if (n !== undefined && n >= 0 && n <= 3650) {
      const from = startOfDay(now) - n * DAY_MS;
      return { from, to: from + DAY_MS, label: `${n}天前（${mdOf(from)}）` };
    }
    return undefined;
  }
  // 「前几天」是模糊说法，但人真的会这么说。按 3~10 天前理解并**在标签里写清楚**，
  // 让人看到回填结果时知道这是按"前几天"猜的区间，而不是精确那天。
  if (/前几天|前些天|前阵子/.test(s)) {
    const to = startOfDay(now) - 3 * DAY_MS;
    const from = to - 7 * DAY_MS;
    return { from, to, label: `前几天（${mdOf(from)} 到 ${mdOf(to - DAY_MS)}）` };
  }

  // ── 8. 带年词的整月：去年10月 / 今年3月份 / 前年12月 ──
  //    排在整年判断之前，否则「去年10月」只会命中「去年」给整年。
  const ymOnly = s.match(/(今年|去年|前年)(\d{1,2})月(?![\d一二三四五六七八九十])/);
  if (ymOnly) {
    const yOff = ymOnly[1] === '去年' ? -1 : ymOnly[1] === '前年' ? -2 : 0;
    const y = now.getFullYear() + yOff;
    const mo = Number(ymOnly[2]);
    if (mo >= 1 && mo <= 12) {
      const from = new Date(y, mo - 1, 1).getTime();
      const to = new Date(y, mo, 1).getTime();
      return { from, to, label: `${y}年${mo}月` };
    }
    return undefined;
  }

  // ── 9. 只给月份：3月 / 三月份（**不猜年份**，取离现在最近的那个同月份）──
  //    即：今年的那个月还没到（月首比现在晚）就取去年，否则取今年。
  //    这是「不猜」原则的唯一例外，且只在用户**明确给了月份**时才用：
  //    月份本身是确定的，不确定的只是年份，而"最近的同月"是唯一像话的默认。
  const mOnly = s.match(/(\d{1,2})月(?![\d一二三四五六七八九十])/);
  if (mOnly) {
    const mo = Number(mOnly[1]);
    if (mo >= 1 && mo <= 12) {
      const yNow = now.getFullYear();
      let y = yNow;
      if (new Date(yNow, mo - 1, 1).getTime() > now.getTime()) y = yNow - 1;
      const from = new Date(y, mo - 1, 1).getTime();
      const to = new Date(y, mo, 1).getTime();
      return { from, to, label: `${y}年${mo}月` };
    }
    return undefined;
  }

  // ── 10. 月 / 年 ──
  if (/上个月|上月/.test(s)) {
    const cur = new Date(startOfMonth(now));
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const from = new Date(y, m - 1, 1).getTime();
    const to = new Date(y, m, 1).getTime();
    return { from, to, label: `上个月（${new Date(from).getFullYear()}年${new Date(from).getMonth() + 1}月）` };
  }
  if (/这个月|本月|这月/.test(s)) {
    const from = startOfMonth(now);
    const d = new Date(from);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return { from, to, label: `本月（${d.getFullYear()}年${d.getMonth() + 1}月）` };
  }
  if (/去年/.test(s)) {
    const y = now.getFullYear() - 1;
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: `${y}年` };
  }
  if (/今年/.test(s)) {
    const y = now.getFullYear();
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: `${y}年` };
  }

  return undefined;
}

/**
 * 这句话是不是在**问过去**（而不是顺口提到一个时间词）？
 *
 * 为什么需要单独一层（踩过的坑）：
 *   `今天天气不错，我们聊点别的` 含时间词「今天」，`parseTimeRange` 会老实返回今天的区间。
 *   但如果调用方一见区间就把关键词检索整个换掉，这句日常闲聊就变成了"按今天查记录"，
 *   捞不到东西还会往 prompt 里塞一句「那段时间没有记录」——反而干扰回答。
 *
 * 所以职责分开：
 *   `parseTimeRange` 只认时间词（纯解析，不猜意图）；
 *   `looksLikeRecall` 认"回忆句"（有回忆动词/问过去的时间指代）。
 *   两个都成立，才走按时间检索。
 */
export function looksLikeRecall(text: string): boolean {
  const s = typeof text === 'string' ? text.replace(/\s+/g, '') : '';
  if (s === '') return false;
  // ① 问"做过什么"：聊/说/讲/问/提/做/干/玩/去/发生 + 过/了 + 什么/啥/哪些
  if (/(?:聊|说|讲|问|提|做|干|玩|去|发生|讨论|商量)(?:过|了)?(?:什么|啥|哪些|些什么)/.test(s)) {
    return true;
  }
  // ② 明确要"想起来"：记得 / 还记得 / 记不记得 / 有没有印象
  if (/记得|记不记得|想起来|有没有印象|有印象/.test(s)) return true;
  // ③ 指代某段过去：上次 / 那天 / 那次 / 那回 / 当时 / 那时候 / 什么时候
  if (/上次|那天|那次|那回|那会儿|那时候|当时|什么时候|哪一天|哪天/.test(s)) return true;
  // ④ 提到过去的某天并带追忆/遗憾语气：`哎呀昨天应该出去玩的`、`早知道前天就去了`。
  //    这一条用户专门举过例子（2026-10-30）：这类句子**不是提问**，
  //    但它恰恰是最需要接上"你昨天说过天气不错"的场景——不接住就成了失忆。
  //    判据是「过去时间词 + 情态/追悔词」，两个都缺一不可：
  //    只有时间词（今天天气不错）不触发，只有情态词（我该走了）也不触发。
  if (
    /(?:昨天|昨日|昨儿|前天|前日|大前天|上[个]?周|上月|上个月|去年|那时候|那次|那天)/.test(s) &&
    /应该|本来|要是|早知道|可惜|没想到|原来|要不|早该|后悔|当初/.test(s)
  ) {
    return true;
  }
  return false;
}

/** 一条消息的时间戳 → 写进 prompt 的短标签（今天/昨天/本周则用相对叫法，更好读） */
export function stampLabel(ts: number, now: Date): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const today = startOfDay(now);
  const delta = Math.floor((today - startOfDay(d)) / DAY_MS);
  if (delta === 0) return '今天';
  if (delta === 1) return '昨天';
  if (delta === 2) return '前天';
  if (delta > 2 && delta < 7) return `${delta}天前`;
  const y = d.getFullYear();
  const nowY = now.getFullYear();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return y === nowY ? md : `${y}年${md}`;
}
