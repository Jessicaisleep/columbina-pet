/**
 * 分条回复（2026-11-01，用户要求「像真人聊天那样分多条说」）。
 *
 * 真人在聊天里很少把一段话塞进一条消息：说一句、停一下、再补一句。这里做的是
 * **生成端拆开**——用提示词让模型自己把回答拆成 1–3 条短句，末尾用固定标记隔开，
 * host 收到后按标记切开，逐条落盘、逐条发（前端因此天然多出几个气泡，三端都不用改）。
 *
 * 为什么用标记而不是换行来切：换行在正文里本来就有语义（分段、列表、诗句），
 * 拿它当分隔符会把「一段两行的话」误切成两条。标记是显式契约，模型不写就一条都不拆。
 *
 * 为什么每条各存一条 assistant 消息、而不是一条消息里放数组：
 * 两端（电脑对话窗、手机页）的历史、镜像、气泡渲染都是「一条消息 = 一个气泡」写死的，
 * 改成嵌套结构要同时动三端协议与迁移；分开存反而最省事，行为也天然正确。
 * 代价：一次回复会在记忆里多出 1–2 条消息，`chatMemoryRounds` 的轮数被吃掉一点。
 *
 * 本模块纯逻辑、不碰 IO，可直接在 node:test 里跑。
 */

/** 分条标记：模型在正文里用它隔开每条短句 */
export const SPLIT_MARK = '[分]';

/** 一次回复最多拆成几条。超过就把尾部并回最后一条，**绝不丢字** */
export const SPLIT_MAX_PARTS = 3;

/**
 * 拆条指令。追加在 user 正文之后，与配图（`[图:名]`）、打标（`[标:…]`）两段指令同一层——
 * 那里紧邻回答位置，模型最容易遵守（这个位置是配图与打标两条指令已经验证过的口径）。
 *
 * 措辞里刻意留了「本来就一句话就别拆」这一条：不分场合地硬拆，比不拆更像机器。
 */
export function splitInstruction(): string {
  return (
    '\n\n[分条] 真人发消息不会把一长段话挤在一条里。把你要说的拆成 1–3 条短句，' +
    '每条都是能独立发出的完整一句；条与条之间写 ' +
    SPLIT_MARK +
    ' 隔开（标记单独占位，前后不要换行也不要加空格）。' +
    '本来就一句话说完的，就只回一条、不写任何标记——不要为了凑条数把半句话劈开；' +
    '标记不要出现在开头、结尾，也不要连着写两个。'
  );
}

/** 全角/别名写法归一：模型偶尔会把标记写成【分】或 [分条] */
function normalizeMarks(text: string): string {
  return text.replace(/【分(?:条)?】/g, SPLIT_MARK).replace(/\[分条\]/g, SPLIT_MARK);
}

/**
 * 句末标点：只有这些才算「一句说完了」。
 * 逗号/顿号当然不算；**省略号也不算** —— 它表示拖音与停顿（「唔……那个」），
 * 拿它切会把一句未完的话劈成两条气泡（这个是先写了错版本、被单测当场抓到的）。
 */
const SENTENCE_END = /(?<=[。！？!?])/;

/** 低于这个长度不值得拆：一句「好呀」被劈成两条气泡只会更假 */
const SENTENCE_SPLIT_MIN_CHARS = 24;

/**
 * 没有标记时的退路：按句号/问号/感叹号拆。
 *
 * 为什么要这条退路（2026-11-01 实测加上的）：指令写进正文后，小模型（deepseek 的
 * flash 档）经常压根不写 `[分]`，一条长回复照样整段返回 —— 提示词不是合约，
 * 拿它当唯一开关等于把功能交给模型的当时心情。退路是确定性的：句子边界是语言事实。
 *
 * 只走这几条约束，避免把好回复拆坏：
 *  - 只有一句话（或整体短于 `SENTENCE_SPLIT_MIN_CHARS`）→ 不拆；
 *  - 只按句末标点拆，不按逗号（按逗号会拆出「唔……」「那个，」这种半句）；
 *  - 超过 `max` 条时，尾部并回最后一条，**一个字都不丢**。
 */
export function splitSentences(text: string, max: number = SPLIT_MAX_PARTS): string[] {
  const whole = text.trim();
  if (whole === '') return [];
  const cap = Math.max(1, Math.floor(max));
  if (cap === 1 || whole.length < SENTENCE_SPLIT_MIN_CHARS) return [whole];
  const units = whole
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (units.length <= 1) return [whole];
  if (units.length <= cap) return units;
  const head = units.slice(0, cap - 1);
  head.push(units.slice(cap - 1).join(''));
  return head;
}

/**
 * 把生成结果切成若干条。
 *
 * 规则：
 *  - 认 `[分]` / `[分条]` / `【分】` / `【分条】`（模型偶尔写全角）；
 *  - 每条 trim，空串丢掉（模型偶尔连着写两个标记）；
 *  - 超过 `max` 时把尾部**拼回最后一条**，宁可长一点也不丢字；
 *  - **没有标记 → 按句末标点兜底拆**（见 `splitSentences`）。模型守约就按它给的条数，
 *    不守约也还是分条说话，而不是整段糊一条。
 */
export function splitReply(text: string, max: number = SPLIT_MAX_PARTS): string[] {
  const parts = normalizeMarks(text)
    .split(SPLIT_MARK)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length === 0) return [];
  // 只有一条 = 模型没用标记（或本来就只该一条）：交给句子边界判断要不要兜底拆
  if (parts.length === 1) return splitSentences(parts[0], max);
  const cap = Math.max(1, Math.floor(max));
  if (parts.length <= cap) return parts;
  // 拼回时用空格而不是空串：模型真写了 4 条时，第 3、4 条之间原本是有标点的，
  // 直接连起来会出现「。。」这种叠标点，留一个空格至少还能读。
  const head = parts.slice(0, cap - 1);
  head.push(parts.slice(cap - 1).join(' '));
  return head;
}

/**
 * 只删标记、不拆条：给「这条路径不分条」的场合用（助手动作分支）。
 * 标记是给 host 解析的协议，露给用户就是没做完。
 */
export function stripSplitMarks(text: string): string {
  return normalizeMarks(text)
    .split(SPLIT_MARK)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join(' ');
}

/** 分条开关：缺键 = 开（新行为默认生效；老配置升级后不需要手改就有效果） */
export function splitEnabledOf(conf: Record<string, unknown> | undefined): boolean {
  return conf?.chatSplitEnabled !== false;
}
