/**
 * 说话气泡的「来意」分类：同一套展示链路，但用户必须能一眼分清三件事——
 *   1. 她自己嘟囔了一句（碎碎念，不写记忆，你回不回去都行）；
 *   2. 她真的来找你说话了（主动聊天，写进记忆，你回一句她接得上）；
 *   3. 普通提示（余额提醒、出错说明、命令气泡）。
 *
 * 为什么必须放在 src/shared：桌面端（DOM 气泡）、手机页（纯 JS 模板）、安卓悬浮窗
 * （overlay.js）三端都要按同一套规则渲染。颜色、停留时长、要不要抢输入框，只要有一端
 * 跟其它两端不一致，用户就会觉得「这是两个功能」，而实际上它们共用同一个 say 叶子。
 *
 * 判定权在**写端**（宿主写 say 叶子时带上 origin），读端只做白名单收窄：
 * 老 host 不写 origin → 'note'（保持改造前的样子），脏值同理。
 */

/** 说话气泡的来意。'note' = 普通提示，也是老数据/未知值的兜底。 */
export type SayOrigin = 'whisper' | 'proactive' | 'note';

/** 三端共用的视觉档位（三端各自把 tone 映射成自己的 CSS 类名）。 */
export type BubbleTone = 'murmur' | 'calling' | 'plain';

export interface SayLook {
  origin: SayOrigin;
  /** 气泡上的小标题；空串 = 不显示。 */
  label: string;
  tone: BubbleTone;
  /** 自动消失的毫秒数；0 = 不自动消失，等用户动手。 */
  holdMs: number;
  /** 是否把光标放进输入框（潜台词「该你回了」）。 */
  focusInput: boolean;
  /** 安卓是否同时发一条通知栏消息——App 在后台时这是唯一的可见入口。 */
  notify: boolean;
}

/**
 * 三端唯一的取值表。改这里就同时改三端，不要在任何一端另写一份数字。
 */
export const SAY_LOOKS: Record<SayOrigin, SayLook> = {
  // 主动聊天：描边高亮 + 小标题 + 一直留着直到你回话 + 抢输入框 + 挂通知
  proactive: { origin: 'proactive', label: '她主动来找你', tone: 'calling', holdMs: 0, focusInput: true, notify: true },
  // 碎碎念：小字灰斜体 + 无边框 + 4 秒自己消失 + 不碰输入框 + 不打扰
  whisper: { origin: 'whisper', label: '自言自语', tone: 'murmur', holdMs: 4000, focusInput: false, notify: false },
  // 普通提示：与改造前完全一致（10 秒、无小标题）
  note: { origin: 'note', label: '', tone: 'plain', holdMs: 10000, focusInput: false, notify: false },
};

/** 白名单收窄：只认已知来意，其余（老数据/脏值/undefined）一律 'note'。 */
export function normalizeSayOrigin(v: unknown): SayOrigin {
  return v === 'proactive' || v === 'whisper' ? v : 'note';
}

/** 来意 → 视觉档位（读端唯一入口，不要在调用点自己拼）。 */
export function sayLook(v: unknown): SayLook {
  return SAY_LOOKS[normalizeSayOrigin(v)];
}
