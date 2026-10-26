/**
 * 助手操作记录（host 半侧）：每次助手跑完一轮，往 JSONL 落一条，供设置页留痕查看。
 *
 * ## 为什么要落盘而不是只留内存
 * 「AI 到底动过我电脑里的什么」是用户事后唯一的追责依据。内存记录一重启就没了，
 * 而恰恰是重启之后用户才想起来查（"昨天它是不是改过我那个文件"）。
 *
 * ## 为什么是 JSONL 而不是一个 JSON 数组
 * 追加一行是 O(1) 的 `appendFile`；如果是 JSON 数组，每次追加都要「读出整个数组 →
 * push → 序列化整段 → 写回」，记录一多就变成每次对话都重写几百 KB。
 * JSONL 天然可追加、单行损坏不影响其他行、超限时按行裁剪也简单。
 *
 * ## 存什么、不存什么
 * 存：时间、宠物、用户指令、最终回复、每一步动作（工具名 / 参数摘要 / 成败 / 结果摘要）、
 *     整体结果、耗时、权限档位。
 * **不存**：动作结果全文（可能含文件内容与隐私，只留摘要）、API 密钥、屏幕快照全文。
 *
 * ## 体积边界
 * 单文件上限 `MAX_FILE_BYTES`（512 KB），超出就保留最近 `KEEP_ENTRIES` 条重写一次。
 * 单条记录上限 `MAX_RECORD_BYTES`（8 KB）：指令和回复各截断到 500/1000 字，步骤描述截到 200 字。
 * 没有上限的日志会把用户磁盘写满——这是最容易被忽略的一类缺陷。
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 一次助手运行的结果分类 */
export type AssistantRunStatus = 'ok' | 'blocked' | 'failed';

/** 一个动作的留痕（比 loop.ts 的 AssistantStep 更精简：只留摘要） */
export interface AssistantStepRecord {
  name: string;
  /** 参数摘要（路径 + 关键字段，不含全文） */
  args: string;
  ok: boolean;
  /** 结果摘要（最多 200 字） */
  summary: string;
}

/** 一条操作记录 */
export interface AssistantRecord {
  /** 毫秒时间戳 */
  ts: number;
  /** 宠物 id */
  petId: string;
  /** 宠物显示名（便于阅读；可能为空） */
  petName: string;
  /** 执行时的权限档位 */
  permission: string;
  /** 用户当时的指令（原文，截断到 500 字） */
  userText: string;
  /** 整体结果 */
  status: AssistantRunStatus;
  /** 给用户的最终回复（截断到 1000 字）；被拦/失败时是错误说明 */
  reply: string;
  /** 做了哪些动作 */
  steps: AssistantStepRecord[];
  /** 耗时（毫秒） */
  ms: number;
  /** 被拦时的目标（仅 status=blocked 时有） */
  blockedTarget?: string;
}

/** 单条记录的字节上限（超出则丢弃步骤细节） */
const MAX_RECORD_BYTES = 8 * 1024;
/** 文件体积上限：超过就裁到 KEEP_ENTRIES 条 */
const MAX_FILE_BYTES = 512 * 1024;
/** 裁剪时保留的条数 */
const KEEP_ENTRIES = 500;
/** 指令截断长度 */
const MAX_USER_CHARS = 500;
/** 回复截断长度 */
const MAX_REPLY_CHARS = 1000;
/** 单步摘要截断长度 */
const MAX_STEP_CHARS = 200;

/** 截断（按字符，不按字节——中文按字符裁才不会出现半个字） */
function cut(s: unknown, n: number): string {
  const t = typeof s === 'string' ? s : String(s ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 参数对象 → 一行摘要（只挑有意义的字段，不 dump 整个 content） */
function argsBrief(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (k === 'content') {
      // 正文只报长度，不报内容（可能很长，也可能含隐私）
      parts.push(`${k}=<${typeof v === 'string' ? v.length : 0} 字>`);
      continue;
    }
    parts.push(`${k}=${cut(v, 120)}`);
  }
  return cut(parts.join(' '), MAX_STEP_CHARS);
}

/**
 * 把循环产出规范成一条记录（做全部截断与筛选）。
 *
 * 单独抽出来是为了能单测——不碰 fs，纯函数。
 */
export function buildRecord(input: {
  petId: string;
  petName?: string;
  permission: string;
  userText: string;
  status: AssistantRunStatus;
  reply: string;
  steps: ReadonlyArray<{ name: string; args: Record<string, unknown>; ok: boolean; summary: string }>;
  ms: number;
  blockedTarget?: string;
  now?: number;
}): AssistantRecord {
  const rec: AssistantRecord = {
    ts: input.now ?? Date.now(),
    petId: cut(input.petId, 64),
    petName: cut(input.petName ?? '', 64),
    permission: cut(input.permission, 16),
    userText: cut(input.userText, MAX_USER_CHARS),
    status: input.status,
    reply: cut(input.reply, MAX_REPLY_CHARS),
    steps: input.steps.slice(0, 20).map((s) => ({
      name: cut(s.name, 40),
      args: argsBrief(s.args),
      ok: s.ok === true,
      summary: cut(s.summary, MAX_STEP_CHARS),
    })),
    ms: Number.isFinite(input.ms) ? Math.max(0, Math.round(input.ms)) : 0,
  };
  if (input.blockedTarget) rec.blockedTarget = cut(input.blockedTarget, 400);
  return rec;
}

/** 记录文件路径（宿主组装后传入，比如 `<userRoot>/assistant-history.jsonl`） */
export interface HistoryPaths {
  file: string;
}

/**
 * 追加一条记录。
 *
 * 失败**不抛**：留痕是附带能力，绝不能因为它写不进去就让对话失败
 * （用户会看到"回答不出来"，而真实原因只是一个日志文件没写成）。
 *
 * @returns 是否写成功（调用方可据此打 warn，但不打断主流程）
 */
export async function appendRecord(paths: HistoryPaths, rec: AssistantRecord): Promise<boolean> {
  let line: string;
  try {
    line = JSON.stringify(rec);
    // 单条过大：丢掉步骤细节再序列化一次（保留「做没做事」这个最关键的信息）
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
      line = JSON.stringify({ ...rec, steps: rec.steps.map((s) => ({ ...s, args: '', summary: cut(s.summary, 60) })) });
    }
  } catch {
    return false;
  }
  try {
    await mkdir(dirname(paths.file), { recursive: true });
    await appendFile(paths.file, line + '\n', 'utf8');
  } catch {
    return false;
  }
  // 体积闸门：超限就裁（这里失败也不影响本次追加已成功）
  try {
    const raw = await readFile(paths.file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) {
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      const kept = lines.slice(-KEEP_ENTRIES);
      await writeFile(paths.file, kept.join('\n') + '\n', 'utf8');
    }
  } catch {
    /* 裁剪失败不报错：文件还在，只是暂时偏大 */
  }
  return true;
}

/**
 * 读最近 N 条（**新的在前**）。
 *
 * 坏行跳过而不是整份失败：JSONL 的价值就在于单行损坏不牵连其他行。
 */
export async function readRecords(paths: HistoryPaths, limit = 100): Promise<AssistantRecord[]> {
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 100;
  let raw: string;
  try {
    raw = await readFile(paths.file, 'utf8');
  } catch {
    return [];
  }
  const out: AssistantRecord[] = [];
  const lines = raw.split('\n');
  // 从后往前扫，够数就停（大文件不必全解析）
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l === '') continue;
    try {
      const v = JSON.parse(l) as unknown;
      if (isRecord(v)) out.push(v);
    } catch {
      /* 坏行跳过 */
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 形状校验：只认「字段齐全」的记录。
 *
 * 为什么不能只查 `typeof ts === 'number'`：`{"ts":123}` 这种残缺行也会通过，
 * 界面上就会冒出若干空记录（没有宠物、没有指令、没有回复），看起来像数据损坏。
 * 只查必填字段的类型，不做严格 schema——将来加字段时旧记录还能读。
 */
function isRecord(v: unknown): v is AssistantRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.ts === 'number' &&
    Number.isFinite(r.ts) &&
    typeof r.petId === 'string' &&
    typeof r.status === 'string' &&
    typeof r.userText === 'string' &&
    typeof r.reply === 'string' &&
    Array.isArray(r.steps)
  );
}

/** 清空记录 */
export async function clearRecords(paths: HistoryPaths): Promise<boolean> {
  try {
    await mkdir(dirname(paths.file), { recursive: true });
    await writeFile(paths.file, '', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 统计条数（设置页显示「共 N 条」用；大文件只数行不算内容） */
export async function countRecords(paths: HistoryPaths): Promise<number> {
  try {
    const raw = await readFile(paths.file, 'utf8');
    return raw.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}
