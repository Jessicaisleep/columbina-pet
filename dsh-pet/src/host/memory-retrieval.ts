/**
 * 字面检索（记忆分层里的 L3）——**纯逻辑**，不碰 IO、不调模型、不依赖任何 embedding 服务。
 *
 * ## 为什么是字面检索而不是向量检索（实测依据）
 *
 * 1. **本机没有可用的 embedding 通道**：DeepSeek `/embeddings` 实测 404；Ollama 未运行；
 *    node_modules 里没有 onnxruntime / transformers / faiss / hnswlib；磁盘上没有 bge/gte/m3e 模型。
 * 2. **成本差两个数量级**：500 人一年（18.25 万条）的向量本体 = 1024 维 × 4 B × 18.25 万 ≈ 713 MB，
 *    再加模型进程与 ~1.2 GB 模型文件；同一份档案的 bigram 倒排索引常驻内存约几十 MB。
 * 3. **召回差距没有想象中大**：在真实 memory.json（46 条，含「我住在杭州」「我养了一只猫叫团子」
 *    「我喜欢喝无糖豆浆」）上实测 4 个问题命中 3 个。唯一失败的是问「我有没有宠物」——
 *    问句里没有「猫」字，字面检索天然做不到同义扩展。
 *
 * ## 因此：检索**不是**记忆的主通道，只是补充
 *
 * 那条失败的用例恰好划清了分工：
 *   - **稳定事实（A 类）必须常驻**（见 `./memory-facts` 的事实卡），不能指望检索；
 *   - **往事片段（B 类）才走检索**，因为提问通常带主题词（「上次那个文件」「那天聊的生日」）。
 * 把 A 类交给检索 = 靠运气；把 B 类塞进常驻 = 烧 token。两者分工不能反。
 *
 * ## 评分为什么用 IDF 而不是关键词计数
 *
 * 「我」「的」「了」这类字在每条消息里都有，计数会把它当成强信号。
 * IDF（`log((N+1)/(df+1))`）让「团子」这种只出现在 1 条的 bigram 拿到 4.9 分，
 * 而「我的」这种到处都有的拿 0 分——不需要维护停用词表，词表会随语料漂移。
 */

import { stampLabel } from './memory-time';
import { mergeTags, tagOf, tagText, type Kind, type MemoryTags, type Mood } from './memory-tags';

/** 一条可检索的记忆单元（一轮问答 = 1 条；检索命中后整轮回填，只回用户那半会被误读成上下文缺答） */
export interface RetrievalDoc {
  /** 在 `messages` 里的起始下标（对偶数下标；用来去重与排序） */
  index: number;
  /** 用户那句 */
  ask: string;
  /** 宠物那句（可能为空：生成失败时存在半轮） */
  reply: string;
  /**
   * 这轮发生的时间（用户那句的 `ts`）。
   *
   * 为什么必须带上（2026-10-30）：记忆文件里的消息一直有 `ts`，但回填给模型时
   * 只给了正文——模型看到的往事全是"没有时间"的，于是「上周一我们聊了什么」
   * 这种问题它答不了，还会把三个月前的事说成"刚才"。
   * 缺这个字段时按"时间未知"渲染（不编造时间）。
   */
  ts?: number;
  /**
   * AI 补标过的标签（`chat.ts` 的 `aiTags`）。有就以它为准，没有再退回词典现算。
   * 之所以从 `messages` 一路透传到这里：检索时不该再回头查原始消息数组。
   */
  aiTags?: { topics: string[]; mood: Mood; kind: Kind };
}

/** 命中结果 */
export interface RetrievalHit {
  doc: RetrievalDoc;
  score: number;
}

/**
 * 按时间区间捞往事（2026-10-30 新增）。
 *
 * 这是和关键词检索**正交**的一条路：问「上周一我们聊了什么」时，`上周一` 不会出现在
 * 往事正文里，字面检索必然空手而归；但那个时间窗里的对话是客观存在的，直接按 `ts` 筛就行。
 *
 * 三条边界：
 *  1. 区间左闭右开；
 *  2. 没有 `ts` 的文档（老数据/迁移前的记录）**不纳入**——不知道时间的条目塞进时间查询，
 *     等于凭空伪造"它发生在那个时间"；
 *  3. `limit` 只取**最近**的若干条：同样在这个时间段里，越近的越可能是用户想说的那次。
 */
export function searchByTime(
  docs: ReadonlyArray<RetrievalDoc>,
  range: { from: number; to: number },
  limit = 5,
): RetrievalHit[] {
  const list = Array.isArray(docs) ? docs : [];
  const from = Number(range?.from);
  const to = Number(range?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const k = Math.max(1, Math.floor(Number(limit) || 5));
  const hit = list.filter(
    (d) => d && typeof d.ts === 'number' && Number.isFinite(d.ts) && d.ts >= from && d.ts < to,
  );
  // 先按新→旧排序**只为了截断**：同一时间窗里"最近那次"最可能是用户指的那次，
  // 窗口很长（「去年」= 一整年）时不能把最近的挤掉。
  hit.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  // 截断后再翻回正序：回填段是给模型读的一段"那天发生过什么"，
  // 倒序会让它按倒放理解（实测踩过：把`算了，我先忙了`排在`天气不错`前面）。
  const kept = hit.slice(0, k).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return kept.map((doc) => ({ doc, score: 1 }));
}

/**
 * 疑问词：查询前先剥掉。
 *
 * 为什么（真实数据实测）：问「我家的猫叫什么」分出的 bigram 里有「叫什」「什么」，
 * 它们把 `我叫什么名字？` 顶到了第一位，而真正该命中的 `我养了一只猫叫团子。` 排到后面。
 * 疑问词在任何问句里都会出现，**不承载任何话题信息**——留着只会拉低精确度。
 *
 * 注意是剥「子串」而不是剥 token：`我家的猫叫什么` 剥掉「什么」后是 `我家的猫叫`，
 * 切出的 `猫叫` 才是有区分度的那个 token。
 */
const QUESTION_WORDS = /(什么|啥|哪位|哪个|哪里|哪儿|在哪|谁|怎么|怎样|多少|多久|如何|是不是|是否|有没有|吗|呢)/g;

/** 单个 bigram/词的最大长度保护：防止用户贴超长串把 key 表撑爆 */
const MAX_TOKEN_CHARS = 24;

/**
 * 分词：中文切 bigram，拉丁/数字切整词。
 *
 * 为什么中文用 bigram 而不是单字：
 *   单字「猫」在任何提到猫的地方都命中，包括「猫粮」「熊猫」；bigram「团子」几乎只指向那只猫。
 *   代价是索引条目翻倍（40 字中文 ≈ 39 个 bigram），但倒排去重后约 30 个/条，可接受。
 *
 * 为什么拉丁按整词：英文单词的字符级 bigram 会退化成无意义组合（`th`/`he`），
 * 而整词切分在混合语料里表现稳定，且不需要词干还原（本场景没有英文文档）。
 */
export function tokenize(text: string): string[] {
  const raw = typeof text === 'string' ? text : '';
  // 先剥疑问词：疑问词在任何问句里都有，不承载话题信息，留着只会把无关的旧问答顶上来。
  // 剥完可能变短（「我家的猫叫什么」→「我家的猫叫」），但要保证不剥成空串：
  // 整句只有疑问词时（「什么」）就按原句检索，至少还能按字面匹配。
  const stripped = raw.replace(QUESTION_WORDS, '');
  const s = stripped.replace(/[^\u4e00-\u9fffa-zA-Z0-9_]+/g, '').length > 0 ? stripped : raw;
  const out: string[] = [];
  const seen = new Set<string>();

  // 拉丁词 / 数字：连续字母数字算一个词（小写归一，避免大小写漂移）
  const latin = /[a-zA-Z0-9_]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = latin.exec(s)) !== null) {
    const w = m[0].toLowerCase().slice(0, MAX_TOKEN_CHARS);
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }

  // 中文：只保留汉字，按相邻两字切 bigram
  const cjk = s.replace(/[^\u4e00-\u9fff]+/g, '');
  for (let i = 0; i + 1 < cjk.length; i++) {
    const g = cjk.slice(i, i + 2);
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  // 单字也进（中文整段只有一个字时，上面循环一条都不产出，会让「猫」这种短查询检索失效）
  if (cjk.length === 1 && !seen.has(cjk)) out.push(cjk);

  return out;
}

/** 倒排索引（构建一次，多次查询） */
export interface RetrievalIndex {
  /** bigram/词 → 出现它的文档下标列表 */
  postings: Map<string, number[]>;
  /** bigram/词 → IDF 权重 */
  idf: Map<string, number>;
  docs: RetrievalDoc[];
}

/**
 * 把一批记忆单元建成倒排索引。
 *
 * 索引只建在**当前不在上下文的**那些旧消息上（调用方负责筛选）——
 * 已经进了近期窗口的内容再被检索回填一次，会在同一次请求里出现两遍，
 * 既浪费 token 又可能让模型以为用户重复说过。
 */
export function buildIndex(docs: RetrievalDoc[]): RetrievalIndex {
  const list = Array.isArray(docs) ? docs : [];
  const postings = new Map<string, number[]>();
  const df = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    // 这里扫的是 `ask + 标签`，不是 `ask + reply`（2026-10-30 改）。
    //
    // 两个理由：
    //  ① 标签要进同一次打分，才能让「问开心的事」命中「好可爱」（原文和标签各贡献一路分）；
    //  ② 宠物的回复不该参与检索——用户问「我不开心」时，命中的应该是**他自己说的**
    //     那些不开心的话，而不是宠物安慰他的那句（那句里全是"别难过""会好的"）。
    //     之前 `tokenize(d.reply)` 会把这类回复也索引进去，实测确实造成过串台。
    const toks = new Set(tokenize(searchableTextOf(d)));
    for (const t of toks) {
      df.set(t, (df.get(t) ?? 0) + 1);
      const arr = postings.get(t);
      if (arr) arr.push(i);
      else postings.set(t, [i]);
    }
  }

  const n = list.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)));

  return { postings, idf, docs: list };
}

/**
 * 检索 top-K。
 *
 * 三种刻意的取舍：
 *   1. **只累计正分**：IDF 在「词出现在几乎所有文档」时接近 0，不会为负；不做余弦归一，
 *      因为归一化后短文档会被抬高，而本场景要的正是「长文档里恰好有那个专名」。
 *   2. **同一 doc 内重复出现的 token 不重复计分**：bigram 集合已在建索引时去重，
 *      否则「团子团子团子」这种重复会把分数刷到不合理的高。
 *   3. **分数为 0 的 doc 不进结果**：没命中就是没命中，返回一堆 0 分文档会让回填段被噪声填满。
 *
 * @param query 用户这一句（或当前话题）
 * @param k 最多返回几条（0 或负 → 空数组）
 * @param minScore 最低分（默认 0.5，低于它的命中基本都是「我」「的」这类虚字造成的假阳性）
 */
export function search(index: RetrievalIndex, query: string, k: number, minScore = 0.5): RetrievalHit[] {
  const topK = Math.floor(Number(k));
  if (!Number.isFinite(topK) || topK <= 0) return [];
  const q = tokenize(query);
  if (q.length === 0 || index.docs.length === 0) return [];

  const n = index.docs.length;
  /**
   * 「有区分度」的门槛：df 不超过文档数的这一比例。
   *
   * 为什么必须有这道门（真实数据实测）：`我叫什么名字` 分出的 bigram 是
   * 「我叫/叫什/什么/么名/名字」，其中「什么」在 14 条往事里出现在 4 条上——
   * 结果把 `帮我看看 C:\Windows 目录下有什么`、`读一下 C:\Windows` 这两条
   * **安全测试残留**排到了前面，而它们和「名字」毫无关系。
   * 纯靠 IDF 压不住这种情况：小语料上 IDF 的区分度不够（df=4/14 时 idf 仍有 1.1）。
   *
   * 阈值取 0.5：出现在过半文档里的 bigram 基本是虚词或话题词，不能作为「这两条相关」的证据。
   * 只有 1 条文档时（`n===1`）恒放行——否则短档案上一句话都检索不到。
   */
  const dfLimit = n <= 2 ? n : Math.max(1, Math.floor(n * 0.5));

  /**
   * 至少要命中几个 token 才算相关 —— 但**命中唯一专名时一个就够**。
   *
   * 为什么需要下限（真实数据实测）：问「我有没有宠物」剥掉疑问词后只剩 `我宠/宠物`，
   * 这对 bigram 在往事里一次都没出现过，理应 0 命中；但早期版本里它靠「没有」二字
   * 命中了一条 `把「被篡改」写进 D:\Windows\Temp\pet_escape.txt`（安全测试残留），
   * 而且因为 df=1、IDF 高，那条还排在很前面。
   *
   * 为什么又要给「唯一专名」开例外：问「我家的猫叫什么」剥掉「什么」后是 `我家的猫叫`，
   * 切出 `我家/家的/的猫/猫叫`，其中只有 `猫叫` 在往事里出现过——而它 **df=1**，
   * 也就是说整个档案里只有一句说过「猫叫」，那就是 `我养了一只猫叫团子。`。
   * 这种「全档案唯一」的锚点单靠一个就足以定位，多要求一个只会把它漏掉。
   *
   * 所以规则是：命中里若有 df===1 的 token → 放行；否则要求至少对上 2 个。
   */
  const minMatched = q.length >= 3 ? 2 : 1;

  const scores = new Map<number, number>();
  const matched = new Map<number, number>();
  const distinctive = new Set<number>();
  /** 每条文档命中的最小 df（越小越有区分度）；用来判定「唯一专名锚点」 */
  const bestDf = new Map<number, number>();
  for (const t of q) {
    const weight = index.idf.get(t);
    if (weight === undefined) continue;
    const docs = index.postings.get(t);
    if (!docs) continue;
    const rare = docs.length <= dfLimit;
    for (const di of docs) {
      scores.set(di, (scores.get(di) ?? 0) + weight);
      matched.set(di, (matched.get(di) ?? 0) + 1);
      if (rare) distinctive.add(di);
      const prev = bestDf.get(di);
      if (prev === undefined || docs.length < prev) bestDf.set(di, docs.length);
    }
  }

  const hits: RetrievalHit[] = [];
  for (const [di, s] of scores) {
    if (s < minScore) continue;
    // 只靠虚词对上的不算命中（否则回填段会被「什么」「看看」这类噪声填满）
    if (!distinctive.has(di)) continue;
    // 唯一专名（df===1）单锚点放行；否则要求命中足够多的 token
    const uniqueAnchor = (bestDf.get(di) ?? 99) === 1;
    if (!uniqueAnchor && (matched.get(di) ?? 0) < minMatched) continue;
    hits.push({ doc: index.docs[di], score: s });
  }
  // 同分时按下标降序：越新越优先（「上次说的」通常指近的那次）
  hits.sort((a, b) => b.score - a.score || b.doc.index - a.doc.index);
  return hits.slice(0, topK);
}

/**
 * 把命中的记忆渲染成 system 里的一段（无命中 → 空串）。
 *
 * 措辞要点（与 `factsSection` / `memorySection` 同源）：
 *   - 明确这是「以前聊过、此刻不在眼前的记录」，否则模型会以为用户刚说过；
 *   - 明确「不要说根据记录」——陪伴场景里这句话的伤害等同于「我查一下档案」；
 *   - 带上「可能只是部分相关」的提示，避免模型把弱命中当成确定事实到处引用。
 */
export function recallSection(hits: RetrievalHit[], opts: { now?: Date } = {}): string {
  const list = Array.isArray(hits) ? hits.filter((h) => h && h.doc) : [];
  if (list.length === 0) return '';
  const now = opts.now instanceof Date ? opts.now : new Date();

  const lines = list.map((h) => {
    const ask = h.doc.ask.trim();
    const reply = h.doc.reply.trim();
    // 时间写进每一行：不写的话「上周一聊了什么」这类问题模型答不了，
    // 还会把很久以前的事当成"刚才"（用户 2026-10-30 明确提出这一点）。
    //
    // 格式用**显式标签**（时间｜主人说｜你说），不用箭头连排：
    // 用户给的验收场景是「今天下雨，主人说哎呀昨天应该出去玩的，宠物接：对呀你昨天说天气不错」。
    // 模型要接住这句话，必须一眼看出「天气不错」是**昨天**说的、是**主人**说的。
    // 光靠 `- （昨天）今天天气不错 → 对呀…` 这种连排，模型容易把时间和说话人弄混。
    const when = typeof h.doc.ts === 'number' ? stampLabel(h.doc.ts, now) : '';
    const parts: string[] = [];
    if (when !== '') parts.push('时间：' + when);
    parts.push('主人说：' + ask);
    if (reply !== '') parts.push('你说：' + reply);
    return '- ' + parts.join(' ｜ ');
  });

  return (
    '\n\n【想起的往事】这些是你们以前聊过的内容（此刻不在眼前的对话里）。' +
    '如果和现在的话有关就自然地用上，不要逐条复述，不要说"我记得""根据记录"这类话，' +
    '也不要提"检索""往事"这些字眼。它们只是可能相关，不确定的部分不要当成事实说死。\n' +
    '每条都标了发生时间和当时是谁说的：用户提到过去某天时，你可以像人回忆那样' +
    '自然地接上那天他说过的话（例如"你昨天不是说天气不错嘛"），这是他真说过的事，' +
    '放心引用——但别把它说成刚刚发生的事，也别把"你说"的内容安到用户头上：\n' +
    lines.join('\n')
  );
}

/**
 * 「那一天的样子」——把某个时间窗内的对话**整体**取出来，而不是抽样几条。
 *
 * 为什么不能用 top-K（2026-10-30 实测踩到的坑，探针可复现）：
 *   昨天聊了 12 轮，主人今天说「哎呀昨天应该出去玩的」。
 *   时间窗里按新旧取 3 条，捞出的是「今天赢了三把 / 困了早点睡 / 明天见」——
 *   **没有那句「今天天气不错」**。宠物手上没有素材，就接不上「对啊你昨天说天气不错」。
 *   换成 5 条也一样捞不到。
 *
 *   根因不是排序，是**抽样本身**：人听到"昨天"时浮起来的不是三条随机的记忆，
 *   是那一天的大致样子（早上干嘛、中午吃啥、下午开会、晚上打游戏），
 *   然后才在整体里挑出和眼下话题最搭的那一句。
 *   把它压成 top-3，等于把"那天的样子"换成"那天的最后三件事"。
 *
 * 所以这里返回整段轨迹（按时间正序），只在两种情况下裁：
 *   - 超过 `max` 条：先用关键词相关度挑，再用「最近的」补齐，最后仍按时间正序展示；
 *   - 单条正文超过 `clip` 字：截断加省略号。
 *
 * 成本：实测 12 轮 ≈ 340 字 ≈ 260 token（1M 窗口的 0.03%）。
 * 40 条 ≈ 900 token。和时间检索省下的检索误差比，这个代价是划算的。
 */
export function dayTrace(
  docs: ReadonlyArray<RetrievalDoc>,
  range: { from: number; to: number },
  opts: { max?: number; clip?: number; query?: string } = {},
): { lines: RetrievalDoc[]; total: number; truncated: boolean } {
  const list = Array.isArray(docs) ? docs : [];
  const from = Number(range?.from);
  const to = Number(range?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return { lines: [], total: 0, truncated: false };
  }
  const max = Math.max(1, Math.floor(Number(opts.max ?? 40)) || 40);
  const hit = list.filter(
    (d) => d && typeof d.ts === 'number' && Number.isFinite(d.ts) && d.ts >= from && d.ts < to,
  );
  const total = hit.length;
  if (total === 0) return { lines: [], total: 0, truncated: false };
  if (total <= max) {
    return { lines: hit.slice().sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)), total, truncated: false };
  }

  // 超限才裁：相关度优先，名额用完后由「离现在最近的」补齐（那天最后聊的更可能在心上）
  const wanted = new Set<RetrievalDoc>();
  const query = typeof opts.query === 'string' ? opts.query : '';
  if (query.trim() !== '') {
    const relevant = search(buildIndex(hit), query, Math.max(1, Math.floor(max / 2)));
    for (const r of relevant) if (r.score > 0) wanted.add(r.doc);
  }
  for (const d of hit.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))) {
    if (wanted.size >= max) break;
    wanted.add(d);
  }
  const lines = [...wanted].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return { lines, total, truncated: true };
}

/**
 * 渲染「那一天的样子」。
 *
 * 与 `recallSection` 的关键差别：这里**不发号施令**。
 * 不说"把这些用上"，而是说"这是那天发生过的事，你可以从中挑一句接上"。
 * 因为用户要的是「对啊你昨天说天气不错」这种自然回应，
 * 命令式措辞会让模型要么硬塞、要么逐条复述，两种都不像人说话。
 *
 * 时间标注按跨度切换：单日给「08:00」，跨多天给「10月29日 08:00」。
 * 一整段都是"昨天"还每条标"昨天"，读起来像表格，也让模型难把"那天几点"说出来。
 */
export function traceSection(
  lines: ReadonlyArray<RetrievalDoc>,
  label: string,
  opts: { now?: Date; clip?: number; total?: number; truncated?: boolean } = {},
): string {
  const list = Array.isArray(lines) ? lines.filter((d) => d && typeof d.ts === 'number') : [];
  if (list.length === 0) return '';
  // 这里不用 `opts.now`：时刻直接取消息自身的 ts，不依赖"现在几点"，
  // 这样同一段往事在任何时候渲染出的小时数都一样（可复现、可测）。
  const clip = Math.max(8, Math.floor(Number(opts.clip ?? 60)) || 60);
  const stamps = list.map((d) => Number(d.ts));
  const spanMs = Math.max(...stamps) - Math.min(...stamps);
  const singleDay = spanMs < 20 * 3_600_000; // 20 小时内都算同一天

  const cut = (s: string): string => {
    const t = s.trim();
    if (t.length <= clip) return t;
    const head = t.slice(0, clip);
    const p = Math.max(head.lastIndexOf('。'), head.lastIndexOf('，'), head.lastIndexOf('！'));
    return (p > clip * 0.6 ? head.slice(0, p) : head) + '…';
  };
  const clockOf = (ts: number): string => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return singleDay ? `${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  };

  const rows = list.map((d) => {
    const parts = [clockOf(Number(d.ts)), '主人说：' + cut(d.ask)];
    if (d.reply.trim() !== '') parts.push('你说：' + cut(d.reply));
    return '- ' + parts.join(' ｜ ');
  });

  const tag = typeof label === 'string' && label.trim() !== '' ? label.trim() : '那段时间';
  const total = Math.floor(Number(opts.total ?? list.length)) || list.length;
  const more = opts.truncated === true && total > list.length ? `（共 ${total} 轮，这里是节选）` : '';
  return (
    `\n\n【那一天的样子·${tag}】${more}这是那段时间里你们说过的话，按时间从头到尾排。` +
    '主人刚提到了这个时间，你可以像人一样，从里面挑和现在这话题最搭的一句自然接上' +
    '（比如"对啊你昨天不是说天气不错嘛"）——那是他真说过的事，放心引用。' +
    '但不要一条条复述，不要提"记录""检索"这类字眼，也别把"你说"的内容安到他头上；' +
    '和眼下无关的就让它过去，硬提反而怪：\n' +
    rows.join('\n')
  );
}

/**
 * 把 `ChatMemoryMessage[]` 切成「一轮一条」的检索单元。
 *
 * 为什么要成对：只回用户那句会得到「我住在杭州」却没有回应，模型可能理解成用户刚在说这句话；
 * 只回宠物那句更糟（不知道在回应什么）。成对回填才能读成一段真实发生过的对话。
 *
 * `start`/`end` 是给调用方排除近期窗口用的**左闭右开**下标区间。
 */
export function docsOf(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; ts?: number }>,
  range: { start?: number; end?: number } = {},
): RetrievalDoc[] {
  const list = Array.isArray(messages) ? messages : [];
  const start = Math.max(0, Math.floor(Number(range.start ?? 0)) || 0);
  const endRaw = range.end === undefined ? list.length : Math.floor(Number(range.end));
  const end = Math.min(list.length, Number.isFinite(endRaw) ? endRaw : list.length);
  if (end <= start) return [];

  const out: RetrievalDoc[] = [];
  for (let i = start; i < end; i += 2) {
    const u = list[i];
    if (!u || u.role !== 'user') continue;
    const a = i + 1 < end ? list[i + 1] : undefined;
    const reply = a && a.role === 'assistant' ? a.content : '';
    const ask = typeof u.content === 'string' ? u.content : '';
    if (ask.trim() === '' && reply.trim() === '') continue;
    const ts = typeof u.ts === 'number' && Number.isFinite(u.ts) && u.ts > 0 ? u.ts : undefined;
    const ai = aiTagsOf(u);
    out.push({
      index: i,
      ask,
      reply,
      ...(ts !== undefined ? { ts } : {}),
      ...(ai !== undefined ? { aiTags: ai } : {}),
    });
  }
  return out;
}

/** 从原始消息里读 AI 标签，形状不对就当没有（宁可退回词典，也不信半截数据） */
function aiTagsOf(msg: { aiTags?: unknown }): RetrievalDoc['aiTags'] | undefined {
  const raw = (msg as { aiTags?: unknown }).aiTags;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.topics)) return undefined;
  const topics: string[] = [];
  for (const t of o.topics) if (typeof t === 'string' && t.trim() !== '') topics.push(t.trim());
  const mood = o.mood === 'pos' || o.mood === 'neg' || o.mood === 'neutral' ? o.mood : 'neutral';
  const kind =
    o.kind === 'question' || o.kind === 'plan' || o.kind === 'emotion' || o.kind === 'statement'
      ? o.kind
      : 'statement';
  return { topics, mood, kind };
}

/**
 * 按标签捞往事（2026-10-30 新增，用户指出「应该是多重分类」之后的第二路）。
 *
 * 场景：用户问「上次说的那只狗狗」「最近有什么开心的事」。
 *   - 前者带"狗狗"，关键词检索能命中原文，没问题；
 *   - 后者带"开心"，而原文是「好可爱」「赢了三把」——**一个字都不重合**。
 * 只靠关键词，第二条问句必然空手而归。
 *
 * 所以一条记忆在入库时就带了三组标签（见 `./memory-tags`），这里按标签找。
 * 返回顺序按「最近的优先」——问"最近"的时候，越近越可能是他要的那次。
 */
export function searchByTags(
  docs: ReadonlyArray<RetrievalDoc>,
  want: { topics?: string[]; mood?: Mood; kind?: string },
  limit = 5,
): RetrievalHit[] {
  const list = Array.isArray(docs) ? docs : [];
  const topics = Array.isArray(want?.topics) ? want.topics.filter((t) => typeof t === 'string' && t !== '') : [];
  const mood = want?.mood;
  const kind = want?.kind;
  if (topics.length === 0 && mood === undefined && kind === undefined) return [];

  const scored: RetrievalHit[] = [];
  for (const d of list) {
    if (!d) continue;
    const tags = tagsFor(d);
    let score = 0;
    // 命中一个主题 +2；命中两个 +5（"狗狗"+"正面"比只命中一个更像用户要找的）
    let hitTopics = 0;
    for (const t of topics) if (tags.topics.includes(t)) hitTopics += 1;
    if (hitTopics === 1) score += 2;
    else if (hitTopics >= 2) score += 5;
    if (mood !== undefined && tags.mood === mood) score += 2;
    if (kind !== undefined && tags.kind === kind) score += 1;
    if (score > 0) scored.push({ doc: d, score });
  }
  if (scored.length === 0) return [];
  // 同分按时间新的靠前（没有 ts 的排后面，不能假装它是新的）
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.doc.ts ?? 0) - (a.doc.ts ?? 0);
  });
  return scored.slice(0, Math.max(1, Math.floor(Number(limit) || 5)));
}

/**
 * 从一段用户原话里反推"他可能想找什么类别"。
 *
 * 只认**明确的类别说法**，不做泛化：
 *   - 「开心的事」「高兴的事」→ mood=pos
 *   - 「烦心事」「难过的事」→ mood=neg
 *   - 「说过狗狗吗」「关于猫的」→ topics=['宠物']
 * 没命中任何类别就返回 undefined，让调用方退回普通关键词检索——
 * **不能因为这句话里有个"事"字就当成查分类**，那会把正常闲聊全变成档案调取。
 */
export function wantedTags(text: string): { topics?: string[]; mood?: Mood } | undefined {
  const s = typeof text === 'string' ? text : '';
  if (s.trim() === '') return undefined;

  // 情绪：只认"在盘点往事"的口气——「有什么开心的事」「最近有点烦心」。
  // 反例必须拦住：「我今天不开心」是**陈述**，这时该先安慰他，
  // 而不是把三天前的"今天赢了三把"翻出来给他看（那反而像在炫耀）。
  // 所以这里加一道与主题路对称的门槛：主题路要 RECALL_HINT，情绪路要 MOOD_ASK。
  let mood: Mood | undefined;
  if (MOOD_ASK.test(s)) {
    // 否定式必须先判，反例：「不开心」里含「开心」，顺序反过来就会被判成 pos（实测踩过）。
    if (/(烦心|烦|难过|难受|伤心|糟心|不开心|不高兴|不顺|倒霉|生气|崩溃)/.test(s)) mood = 'neg';
    else if (/(开心|高兴|快乐|愉快|得意|顺利|好事|幸福|暖)/.test(s)) mood = 'pos';
  }

  // 主题：直接用同一套词典反查。这里**必须复用 tagOf 的词典**，
  // 否则"打标签用的词"和"查标签用的词"会漂移（改了一边忘了另一边）。
  const topicSet = new Set(tagOf(s).topics);
  let topics = topicSet.size > 0 ? [...topicSet] : undefined;

  // 只有 theme 没有 mood 时必须**同时**带"翻旧账"的口气，才走标签路。
  // 否则「今天天气怎么样」也会命中"天气"这个类目，把一堆旧天气记录塞进来——
  // 那是在问窗外，不是在问我记忆里的事。实测这条不加就误伤。
  if (topics !== undefined && mood === undefined && !RECALL_HINT.test(s)) topics = undefined;

  if (mood === undefined && topics === undefined) return undefined;
  return { ...(topics ? { topics } : {}), ...(mood !== undefined ? { mood } : {}) };
}

/** 「翻旧账」口气：说了这些词才是在问过去，而不是在问现在 */
const RECALL_HINT = /上次|上回|之前|以前|从前|说过|提过|讲过|聊过|那次|那回|曾经|还记得|记不记得/;

/**
 * 「在盘点心情」口气：问的是**回忆里**开心的/烦心的事，不是当下心情。
 *
 * 为什么必须有这道门槛（2026-10-30 补）：原来只要句子里出现"开心"就判 pos，
 * 于是「我今天不开心」也被判成 pos 去翻旧账——两处都错：
 * ① 极性反了（"不开心"含"开心"，正则顺序问题）；
 * ② 方向错了——他在**告诉我他现在不开心**，这时候该安慰他，
 *    把三天前"今天赢了三把"翻出来反而像在炫耀。
 * 只认「有什么…的事」「最近…吗」这类盘点口气，才把记忆翻出来给他看。
 */
const MOOD_ASK =
  /有什么|有哪些|有没有|是否|哪些|哪次|什么事|的事|最近|近来|这几天|这一阵|之前|以前|从前|上次|上回|说过|聊过|提过|回忆|印象|还记得|记不记得|来着|呢[？?]|[？?]/;

/**
 * 取（并缓存）一条文档的标签。
 *
 * 为什么不存进 `memory.json`：标签是**原文的派生物**，
 * 存了就得处理"原文改了标签没改"的一致性问题（任务2 要支持改历史原文）。
 * 运行时算一次、按 `index + ask` 缓存，成本可忽略（词典扫一遍 0.05ms），
 * 且改词表后立刻全量生效——不用回填数据。
 */
const tagCache = new Map<string, MemoryTags>();

function tagsFor(doc: RetrievalDoc): MemoryTags {
  const key = doc.index + '\u0000' + doc.ask;
  const hit = tagCache.get(key);
  if (hit) return hit;
  // AI 补标过的以 AI 为准，词典只补它判断"拿不准就留空"的那几个字段。
  const tags = mergeTags(tagOf(doc.ask), doc.aiTags);
  // 缓存上限：档案几万条时不能让 Map 无限涨，超了就先清空（简单且够用）
  if (tagCache.size > 20_000) tagCache.clear();
  tagCache.set(key, tags);
  return tags;
}

/**
 * 把标签拼进检索用的文本。
 *
 * 关键设计：不另建一套索引，而是让 `buildIndex` 扫 `ask + tagText(tags)`。
 * 好处是直接复用已有的 IDF 加权和四道噪声过滤——
 * 用户问"开心"，"开心"命中标签、"好可爱"命中原文，两路分数在**同一次打分**里融合，
 * 不需要再做 RRF 之类的事后合并。
 */
export function searchableTextOf(doc: RetrievalDoc): string {
  const tagWords = tagText(tagsFor(doc));
  return tagWords === '' ? doc.ask : doc.ask + ' ' + tagWords;
}
