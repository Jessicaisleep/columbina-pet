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

/** 一条可检索的记忆单元（一轮问答 = 1 条；检索命中后整轮回填，只回用户那半会被误读成上下文缺答） */
export interface RetrievalDoc {
  /** 在 `messages` 里的起始下标（对偶数下标；用来去重与排序） */
  index: number;
  /** 用户那句 */
  ask: string;
  /** 宠物那句（可能为空：生成失败时存在半轮） */
  reply: string;
}

/** 命中结果 */
export interface RetrievalHit {
  doc: RetrievalDoc;
  score: number;
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
    const toks = new Set([...tokenize(d.ask), ...tokenize(d.reply)]);
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
export function recallSection(hits: RetrievalHit[]): string {
  const list = Array.isArray(hits) ? hits.filter((h) => h && h.doc) : [];
  if (list.length === 0) return '';

  const lines = list.map((h) => {
    const ask = h.doc.ask.trim();
    const reply = h.doc.reply.trim();
    return reply === '' ? '- ' + ask : '- ' + ask + ' → ' + reply;
  });

  return (
    '\n\n【想起的往事】这些是你们以前聊过的内容（此刻不在眼前的对话里）。' +
    '如果和现在的话有关就自然地用上，不要逐条复述，不要说"我记得""根据记录"这类话，' +
    '也不要提"检索""往事"这些字眼。它们只是可能相关，不确定的部分不要当成事实说死：\n' +
    lines.join('\n')
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
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
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
    out.push({ index: i, ask, reply });
  }
  return out;
}
