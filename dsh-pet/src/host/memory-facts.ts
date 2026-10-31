/**
 * 稳定事实卡（记忆分层里的 L0）——**纯逻辑**，不碰 IO、不调模型。
 *
 * 为什么需要这一层（实测依据）：
 *   `continue任务` 里 46 条真实对话，摘要只覆盖了 `[0..7]`，而那 8 条全是重复的「你是谁」；
 *   真正会被用户追问的 `[12] 记住我住在杭州` / `[14] 我养了一只猫叫团子` /
 *   `[16] 我喜欢喝无糖豆浆` 全部落在**摘要与窗口之间的黑洞里**（28 条 / 61%）。
 *
 * 为什么不能只靠检索（`./memory-retrieval`）就够：
 *   实测问「我有没有宠物」时，bigram 检索**命中不了**「我养了一只猫叫团子」——
 *   问句里根本没有「猫」字。同类失败还有「我叫什么」（档案里存的是名字本身，不是「叫」）。
 *   稳定事实的正确用法是**常驻**，而不是「等用户问到再捞」：捞不到就是陌生感，
 *   而陌生感在陪伴场景里是毁灭性的（用户原话）。
 *
 * 为什么还要规则抽取、不全交给模型：
 *   1. 用户说「记住 X」是**明确指令**，不能因为这次模型调用失败/超时就丢失；
 *   2. 规则是确定性的，可穷举单测；模型抽取的召回率随提示词漂移，无法钉住；
 *   3. 常态下没有额外 token 成本（不像摘要每次都要调一次模型）。
 *   模型抽取作为补充通道留给上层，本模块只负责「规则能确定的那部分」。
 *
 * 与摘要的分工：
 *   摘要 = 往事叙述（有损、可重写）；事实卡 = 可结构化的事实（无损、按键覆盖）。
 *   事实卡**永不被压缩掉**，也不参与 `summarized` 游标推进。
 */

/** 事实类别：只影响渲染顺序与分组标题，不影响冲突判定 */
export type FactKind = 'identity' | 'preference' | 'relationship' | 'commitment' | 'custom';

/** 一条稳定事实 */
export interface MemoryFact {
  kind: FactKind;
  /**
   * 稳定键 —— **冲突覆盖的唯一依据**。
   * `city` 被新值覆盖 = 用户搬家了；`like:无糖豆浆` 与 `like:下雨天` 是两个不同的键，各自独立存在。
   * 键必须由规则确定性地算出（不能含时间戳/随机数），否则同一件事会堆成无数条。
   */
  key: string;
  /** 值：尽量保留用户原话里的表述，模型读起来最不容易误解 */
  value: string;
  /** 首次记录时刻（ms）；覆盖时**不更新**，用来表达「这件事他关注了很久」 */
  firstTs: number;
  /** 最后一次确认时刻（ms）；覆盖时更新 */
  lastTs: number;
}

/** 渲染时各类别的标题与顺序（顺序即重要度：身份 > 关系 > 偏好 > 约定 > 其他） */
const KIND_ORDER: Array<{ kind: FactKind; title: string }> = [
  { kind: 'identity', title: '身份' },
  { kind: 'relationship', title: '关系' },
  { kind: 'preference', title: '偏好' },
  { kind: 'commitment', title: '约定' },
  { kind: 'custom', title: '其他' },
];

/**
 * 规则表。每条规则 = 「什么句式 → 什么键 → 抽哪一段」。
 *
 * 设计约束（踩过的坑）：
 *   - **顺序有意义**：`我养了一只猫叫团子` 要同时被 pet 规则和「叫 X」规则命中，
 *     pet 规则必须排在前面，否则会被当成「名字叫团子」（人叫团子）。
 *   - **取值段禁止跨标点**：`[^\s，。！？,.!?；;、]{1,20}`。不限制时
 *     「我喜欢喝无糖豆浆。今天好累」会把后半句一起吞进 value。
 *   - **不要写成全句匹配**：用户的表达千变万化，只锚定「触发词 + 紧邻的宾语」，
 *     抽错一个短值比抽不到整句好修——value 短，用户从渲染结果里一眼能看出错。
 */
const RULES: Array<{
  kind: FactKind;
  key: string | ((m: RegExpMatchArray) => string);
  re: RegExp;
  /** 值的组装方式：默认取第 1 组；需要拼前缀时用函数（如「猫·团子」） */
  value?: (m: RegExpMatchArray) => string;
}> = [
  // ---- 宠物优先于姓名：「我养了一只猫叫团子」不能被下面的「叫 X」抢走 ----
  // 三个分支必须按「先具体后笼统」排：
  //   ① 我家的<物种>叫<名>   ② 我养了(一只)<物种>叫<名>   ③ 我养了(一只)<物种>
  // 第一版把 ②③ 合成一条宽松的 `我养了(...)?([^标点]{1,10})`，结果
  // `我养了一只猫叫团子` 的取值段一路吞成「猫叫团子」，渲染出「养的宠物是猫叫团子」。
  // 物种必须先枚举、名字必须锚在「叫」之后，取值段才不会越界。
  {
    kind: 'identity',
    key: 'pet',
    re: /(?:我家(?:的)?(猫|狗|仓鼠|兔子|鸟|鱼|蛇|龟)叫\s*([^\s，。！？,.!?；;、]{1,10})|我养了(?:一只|一个|一只小)?\s*(猫|狗|仓鼠|兔子|鸟|鱼|蛇|龟)(?:叫\s*([^\s，。！？,.!?；;、]{1,10}))?)/,
    value: (m) => {
      // 分支一：我家<物种>叫<名> → 「猫·团子」
      if (m[1]) return (m[2] ?? '') === '' ? m[1] : m[1] + '·' + (m[2] ?? '');
      // 分支二/三：我养了<物种>[叫<名>]
      const sp = m[3] ?? '';
      const nm = m[4] ?? '';
      return nm === '' ? sp : sp + '·' + nm;
    },
  },
  // ---- 称谓：必须是「叫我 X」而不是「我叫 X」（后者是姓名） ----
  {
    kind: 'relationship',
    key: 'address',
    re: /(?:以后)?(?:就)?(?:叫我|称呼我|喊我)\s*([^\s，。！？,.!?；;、]{1,12})/,
  },
  // ---- 姓名 ----
  { kind: 'identity', key: 'name', re: /(?:我叫|我的名字是|我名字叫|我名字是)\s*([^\s，。！？,.!?；;、]{1,12})/ },
  // ---- 居住地：搬家用同一个键覆盖 ----
  {
    kind: 'identity',
    key: 'city',
    re: /(?:我住在|我家在|我生活在|我搬到了|我搬去|我现在住)\s*([^\s，。！？,.!?；;、]{1,14})/,
  },
  // ---- 生日 / 年龄 ----
  { kind: 'identity', key: 'birthday', re: /我的生日(?:是|在)?\s*([^\s，。！？,.!?；;、]{1,20})/ },
  { kind: 'identity', key: 'age', re: /我(?:今年)?\s*(\d{1,2})\s*岁/ },
  // ---- 作息：陪伴场景里最常用的一条（凌晨还在聊的人，模型不该问「你怎么还不睡」） ----
  {
    kind: 'preference',
    key: 'schedule',
    re: /(?:我(?:经常|总是|习惯)?(?:在)?(?:凌晨|深夜|半夜)(?:还)?(?:醒着|不睡|熬夜)|我是(?:个)?夜猫子)/,
    value: () => '常在深夜/凌晨保持清醒',
  },
  // ---- 偏好：喜欢 / 讨厌 分开建键（喜欢 A、讨厌 B 不冲突） ----
  {
    kind: 'preference',
    key: (m) => 'like:' + (m[1] ?? ''),
    // `(?:吃|喝|玩|听|看|用|穿)?` 吃掉紧跟在「喜欢」后面的动词：
    // 不写它时「我喜欢喝无糖豆浆」的 value 是「喝无糖豆浆」，渲染成「喜欢喝无糖豆浆」——
    // 碰巧还行，但键也成了 `like:喝无糖豆浆`：同一个「无糖豆浆」下次说成「我喜欢无糖豆浆」
    // 就是另一个键，于是同一件事堆成两条，事实卡被自己的重复条目挤爆。
    re: /我(?:很|最|特别)?(?:喜欢|爱吃|爱喝|偏爱)(?:吃|喝|玩|听|看|用|穿)?\s*([^\s，。！？,.!?；;、]{1,16})/,
  },
  {
    kind: 'preference',
    key: (m) => 'dislike:' + (m[1] ?? ''),
    re: /我(?:很|最|特别)?(?:讨厌|不喜欢|受不了|不吃|不爱吃)(?:吃|喝|闻|听)?\s*([^\s，。！？,.!?；;、]{1,16})/,
  },
  // ---- 约定 / 忌讳：这两类不常出现，但一旦出现必须常驻 ----
  {
    kind: 'commitment',
    key: (m) => 'promise:' + (m[1] ?? '').slice(0, 8),
    re: /(?:以后|下次|明天|等下)([^，。！？,.!?]{2,24})(?:要|会|记得|别忘)/,
  },
  {
    kind: 'commitment',
    key: 'taboo',
    re: /(?:不要|别)(?:再)?(?:问我|提|说)\s*([^，。！？,.!?]{1,20})/,
  },
];

/**
 * 明确记忆指令：「记住 X」「记一下 X」「别忘了 X」。
 *
 * 命中后**不是**直接把整句塞进去——先剥掉触发词，让剩下的正文再走一遍 `RULES`：
 *   `记住我住在杭州` → 剥成 `我住在杭州` → 命中 city 规则 → 存 `{key:'city', value:'杭州'}`
 *   （若直接存整句，下次用户说「我搬到上海了」时无法覆盖，会并存两条互相矛盾的事实）
 * 剥完仍未命中任何规则时，才整句落成 `custom`（保底：宁可存得笨，也不能丢）。
 */
const EXPLICIT_RE = /(?:记住|记一下|记着|别忘了|要记得|记住啊|帮我记住)\s*[:：,，]?\s*(.+)$/;

/** 抽取结果：一次用户输入里能确定的所有事实 */
export interface ExtractedFact {
  kind: FactKind;
  key: string;
  value: string;
  /** 是否为用户明确要求记住（true 的事实永不被自动淘汰） */
  explicit: boolean;
}

/** 单条事实值的长度上限：防止用户贴一大段文字把事实卡撑爆（事实卡是常驻成本） */
const MAX_VALUE_CHARS = 40;

/**
 * 疑问标记：取值里出现这些词 → 这不是一句陈述，**不能当事实存**。
 *
 * 真实数据里踩到的两个坑（来自 `ColumbinaPet\data\dsh-pet\memory.json`）：
 *   - 用户问「我叫什么名字」→ 被 name 规则抽成 `name = 什么名字`
 *   - 用户问「我喜欢吃的食物是什么」→ 被 like 规则抽成 `like:的食物是什么`
 * 两者都会渲染成「名字叫什么名字」「喜欢的食物是什么」塞进常驻提示词——
 * 等于每次开场都提醒模型「你不记得他叫什么」，比不记得更糟。
 *
 * 为什么在 `push` 里按**取值**判、不按整句判：
 *   「我叫陈可婷，你叫什么名字？」这种句子里前半是真事实，整句判会把它一起丢掉。
 */
const QUESTION_RE = /什么|啥|哪位|哪个|哪里|哪儿|谁|怎么|怎样|多少|多久|如何|是不是|有没有|吗|呢/;

/**
 * 规范化：去首尾空白、包裹的引号，以及**句末语气词**。
 *
 * 为什么必须剥语气词：`以后叫我主人吧` 的取值段会一直吞到句末，得到「主人吧」，
 * 渲染成「希望被称作主人吧」——模型会把这个「吧」当成称谓的一部分复述出来。
 * 风险是「阿吧」这类把人名末尾当语气词切掉，但中文里「吧/啊/呀/呢/哦/嘛/啦」结尾的
 * 名字几乎不存在，而这类语气词在口语里出现的频率极高，取舍偏向剥。
 */
function tidy(s: string): string {
  return s
    .trim()
    .replace(/^[「『"'（([]+/, '')
    .replace(/[」』"'）)\]]+$/, '')
    .replace(/[。！？!?，,；;、\s]+$/, '')
    .replace(/[吧啊呀呢哦嘛啦]+$/, '')
    .trim();
}

/**
 * 从一条用户消息里抽取稳定事实。
 *
 * 返回数组（可能为空、可能多条）：一句话里同时说「我叫小明，我住在杭州」时两条都要拿到。
 * 抽样顺序 = `RULES` 顺序，但**同一 key 只保留第一次命中**（后命中的是重叠匹配，不是新事实）。
 *
 * 纯函数、无副作用、不读时钟（时间戳由调用方给），因此可穷举单测。
 */
export function extractFacts(text: string): ExtractedFact[] {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw === '') return [];

  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (kind: FactKind, key: string, value: string, explicit: boolean): void => {
    const v = tidy(value).slice(0, MAX_VALUE_CHARS);
    if (v === '') return;
    // 疑问句不能当事实存（见 QUESTION_RE）：只有「明确要求记住」的例外——
    // 用户说「记住我喜欢什么」时那句话本身是疑问壳，但意图明确，仍按 custom 兜底。
    if (QUESTION_RE.test(v) && !explicit) return;
    const k = kind + '|' + key;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, key, value: v, explicit });
  };

  // 1) 明确指令：剥掉触发词，剩下的正文优先当「强事实」处理
  const explicitBody = (() => {
    const m = EXPLICIT_RE.exec(raw);
    return m ? tidy(m[1] ?? '') : '';
  })();

  // 2) 规则抽取（原文 + 剥出的正文各跑一遍；剥出的命中标记 explicit）
  for (const source of explicitBody !== '' ? [explicitBody, raw] : [raw]) {
    const isExplicitBody = source === explicitBody;
    for (const rule of RULES) {
      const m = rule.re.exec(source);
      if (!m) continue;
      const key = typeof rule.key === 'function' ? rule.key(m) : rule.key;
      const value = rule.value ? rule.value(m) : (m[1] ?? '');
      push(rule.kind, key, value, isExplicitBody);
    }
  }

  // 3) 兜底：明确要求记住、但规则一条都没命中 → 整句存成 custom
  //    （典型：「记住我不吃香菜」会被 dislike 规则命中；「记住周三要交稿」没有对应规则，
  //      这时整句保存比丢掉强——用户明确要求过的事，丢了就是直接的失信。）
  if (explicitBody !== '' && out.every((f) => !f.explicit)) {
    push('custom', 'note:' + explicitBody.slice(0, 10), explicitBody, true);
  }

  return out;
}

/**
 * 把新抽到的事实并进已有事实卡（按 `kind|key` 覆盖）。
 *
 * 覆盖语义：
 *   - 值变了 → 更新 value 与 lastTs，**保留 firstTs**（「这事他提了很久」是有用的语气信息）；
 *   - 值没变 → 只更新 lastTs（重复提及 = 强化，不该产生第二条）；
 *   - 新键 → 追加。
 *
 * `explicit` 那批恒不被淘汰（见 `pruneFacts`）。
 */
export function mergeFacts(
  existing: MemoryFact[],
  incoming: ExtractedFact[],
  now: number,
): { facts: MemoryFact[]; changed: boolean } {
  const list = Array.isArray(existing) ? existing.slice() : [];
  const idx = new Map<string, number>();
  for (let i = 0; i < list.length; i++) idx.set(list[i].kind + '|' + list[i].key, i);

  let changed = false;
  for (const f of incoming) {
    const k = f.kind + '|' + f.key;
    const at = idx.get(k);
    if (at === undefined) {
      list.push({ kind: f.kind, key: f.key, value: f.value, firstTs: now, lastTs: now });
      idx.set(k, list.length - 1);
      changed = true;
      continue;
    }
    const old = list[at];
    if (old.value !== f.value) {
      list[at] = { ...old, value: f.value, lastTs: now };
      changed = true;
    } else if (old.lastTs !== now) {
      // 值没变：只刷新「最后确认时间」，不算内容变化（避免每轮都触发写盘）
      list[at] = { ...old, lastTs: now };
    }
  }
  return { facts: list, changed };
}

/**
 * 事实卡容量上限。
 *
 * 为什么需要：事实卡是**常驻**成本，无上限时用户连续说 200 句「我喜欢 X」会把 system 撑大，
 * 反而挤掉近期原文——那就和摘要膨胀是同一个病。
 * 40 条 × 平均 12 字 ≈ 480 字 ≈ 450 token，对「身份+关系+偏好」足够。
 */
export const MAX_FACTS = 40;

/**
 * 淘汰超额事实：保留策略 = **先保非偏好类，再按 lastTs 取新**。
 *
 * 为什么偏好类先出局：`like:无糖豆浆` 这类是「锦上添花」，而 `name` / `city` / `address`
 * 少了就是「不认得我」。淘汰顺序必须与「陌生感的伤害程度」相反。
 */
export function pruneFacts(facts: MemoryFact[], limit: number = MAX_FACTS): MemoryFact[] {
  const list = Array.isArray(facts) ? facts.slice() : [];
  if (list.length <= limit) return list;
  const weight = (f: MemoryFact): number => (f.kind === 'preference' ? 0 : f.kind === 'custom' ? 1 : 2);
  list.sort((a, b) => weight(b) - weight(a) || b.lastTs - a.lastTs);
  return list.slice(0, limit);
}

/**
 * 渲染成 system 提示词里的一段（空卡 → 空串，调用方直接字符串相加即可）。
 *
 * 措辞要点（与 `memorySection` 同源）：必须明确「当作已知事实」+「不要复述、别提『事实卡』」——
 * 不写这两句时，模型会开口说「根据我的记录，你叫…」，直接把陪伴感打破。
 */
export function factsSection(facts: MemoryFact[]): string {
  const list = Array.isArray(facts) ? facts.filter((f) => f && typeof f.value === 'string' && f.value !== '') : [];
  if (list.length === 0) return '';

  const lines: string[] = [];
  for (const g of KIND_ORDER) {
    const items = list.filter((f) => f.kind === g.kind);
    if (items.length === 0) continue;
    const rendered = items.map((f) => renderFact(f));
    lines.push(g.title + '：' + rendered.join('；'));
  }
  if (lines.length === 0) return '';

  return (
    '\n\n【关于对方的已知事实】下面是你已经知道的事，直接当作常识使用。' +
    '不要复述这份清单，不要说"根据记录""我记得你"这类话，也不要提"事实""档案"这些字眼：\n' +
    lines.join('\n')
  );
}

/** 单条事实的人类可读渲染：把内部键翻译成自然语言（键是给程序用的，不能直接给模型看） */
function renderFact(f: MemoryFact): string {
  const key = f.key;
  const v = f.value;
  if (key === 'name') return '名字叫' + v;
  if (key === 'city') return '住在' + v;
  if (key === 'address') return '希望被称作' + v;
  if (key === 'pet') {
    // 取值可能是「猫」或「猫·团子」。渲染成自然句子：不写「养的宠物是猫·团子」这种带分隔符的机器味。
    const parts = v.split('·');
    return parts.length > 1 ? '养了一只' + parts[0] + '，叫' + parts[1] : '养了一只' + v;
  }
  if (key === 'birthday') return '生日是' + v;
  if (key === 'age') return v + ' 岁';
  if (key === 'taboo') return '不希望被提起：' + v;
  if (key.startsWith('like:')) return '喜欢' + v;
  if (key.startsWith('dislike:')) return '不喜欢' + v;
  if (key.startsWith('promise:')) return '约定过：' + v;
  if (key.startsWith('note:')) return v;
  // 其他键（含未来新增的）原样输出值，不丢信息
  return v;
}
