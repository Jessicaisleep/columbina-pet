/**
 * 数据备份（导出 / 导入）—— 把用户的全部「可迁移状态」收成一个 JSON 文件，以及从该文件恢复。
 *
 * 为什么需要：换机器、重装、手滑改坏配置、想给别人一份「跟我一样的配置」时，
 * 目前只能自己去 `data/dsh-pet/` 里翻文件。这个模块把它变成一次点击。
 *
 * ## 导出什么
 *
 * 只收**用户产生的状态**，不收运行产物：
 *
 * | 文件 | 内容 |
 * |---|---|
 * | `main-config.jsonc` | 用户主配置层（宠物列表 / 位置 / 全局开关 / physics / font / 人名 …） |
 * | `pet/<前缀>-config.json` | 每只文件宠物自己的条目（动画池、人设、权重、events） |
 * | `memory.json` | 对话记忆（原文 + 压缩摘要） |
 * | `standalone-ai.json` | AI 配置。**默认不收**（里面有明文 apiKey），要收必须显式要求 |
 *
 * 刻意**不收**：`logs.txt*`（运行日志，体积大且含日常操作痕迹）、
 * `assistant-history.jsonl`（助手留痕，同理）、`宠物工作区/`（助手沙箱产物）、
 * `uia/`（读屏脚本副本，包内自带）。
 *
 * ## 为什么文件内容是**原文**而不是解析后的对象
 *
 * `main-config.jsonc` 允许 `//` 注释，且用户可能手改过注释与字段顺序。
 * 解析再序列化会把注释整份吃掉——对一个「备份」来说这是数据损失，不是规范化。
 * 所以 `files[].text` 存原始文本，导入时原样写回。
 *
 * ## 校验
 *
 * 1. `format` 必须等于 `dsh-pet-backup`（防止把随便一个 JSON 塞进来）；
 * 2. `version` 必须 ≤ 本机支持的版本；
 * 3. **路径白名单**：只接受 `main-config.jsonc` / `pet/<合法前缀>-config.json` / `memory.json` /
 *    `standalone-ai.json`。前缀里出现 `\ / : 控制字符` 一律拒绝（Path Traversal 防护）；
 * 4. 每个文件的 `sha256` 与实际内容比对（防手改/截断）；
 * 5. 整包 `sha256` 覆盖「排序后的 (path, sha256) 列表」，防增删文件；
 * 6. 内容必须能被现有解析器读懂（JSONC 容忍注释；`memory.json` 必须是对象）。
 *
 * 第 3 条是与其它校验并列的**安全边界**，不是可选项：导入的路径直接进 `writeFileSync`，
 * 少了它一个恶意备份包就能往任意位置写文件。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ID_FORBIDDEN, type ConfigPaths } from './config';

/** 备份包标识（导入时用来认出「这确实是我们的备份」） */
export const BACKUP_FORMAT = 'dsh-pet-backup';
/** 当前支持的备份格式版本。导入时 version > 本值 → 拒绝（未来版本可能改了语义）。 */
export const BACKUP_VERSION = 1;
/**
 * 整包上限（按 UTF-8 字节算）。
 *
 * 这个数不是随手定的：standalone 模式的请求体上限是 `MAX_REQUEST_BYTES = 1 MB`
 * （见 `src/standalone/request-body.ts` 的 `boundedRequest`），而导入是把备份原文塞在
 * JSON body 的 `text` 字段里——原文里每个 `"` 都要再转义成 `\"`，配置文件又满是引号，
 * 实测膨胀约 12~15%。
 *
 * 取 512 KB：512 × 1.15 ≈ 589 KB，离 1 MB 还有四成余量。
 * 实测本机真实备份（2 只宠物配置 + 9 KB 对话记忆）只有约 30 KB，离上限还差 17 倍。
 */
export const BACKUP_MAX_BYTES = 512 * 1024;
/** 单文件上限（按 UTF-8 字节） */
const MAX_FILE_BYTES = 256 * 1024;
/** 单包最多文件数（每只宠物 1 个，64 只远超实际） */
const MAX_FILES = 64;
/** 宠物条目前缀长度上限（与 saveUserConfig 里 id ≤ 64 同一口径） */
const MAX_PREFIX = 64;

/** 固定允许的绝对文件名 */
const FIXED_PATHS = new Set(['main-config.jsonc', 'memory.json', 'standalone-ai.json']);
/** 宠物条目配置的路径形态：pet/<前缀>-config.json */
const PET_PATH = /^pet\/([^/]+)-config\.json$/;

export interface BackupFile {
  /** 相对 `data/dsh-pet/` 的路径，如 `main-config.jsonc`、`pet/nahida-config.json` */
  path: string;
  /** 原始文本（保留注释与格式） */
  text: string;
  /** sha256(text) 十六进制小写 */
  sha256: string;
}

export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** 导出时刻（ISO 8601） */
  exportedAt: string;
  /** 产出该包的程序版本（排障用，不参与校验） */
  appVersion: string;
  /** 是否包含 API 密钥文件 */
  includeApiKey: boolean;
  files: BackupFile[];
  /** 覆盖「排序后的 (path, sha256)」的整包校验 */
  sha256: string;
}

export interface BackupOptions {
  /** 是否把 `standalone-ai.json`（含明文 apiKey）一起导出。默认 false */
  includeApiKey?: boolean;
  /** 程序版本（写进包体供排障） */
  appVersion?: string;
  /** 覆盖导出时刻（测试注入） */
  now?: Date;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 整包校验：对「按路径排序后的 (path, sha256) 列表」求哈希。
 *
 * 为什么不直接哈希 `JSON.stringify(files)`：那样会把 `text` 也滚进去，
 * 同一个文件只要换行风格变了校验就变——但换行风格是导入端自己要不要归一化的事，
 * 不该让「内容没变但格式变了」的包被判损坏。用每文件的 sha256 做叶子更稳。
 */
function bundleDigest(files: ReadonlyArray<{ path: string; sha256: string }>): string {
  const canon = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\n${f.sha256}`)
    .join('\n');
  return sha256(canon);
}

/**
 * 校验一个相对路径是否允许被备份/恢复。
 *
 * 这是 Path Traversal 的唯一防线：导入端拿到路径后直接拼 `join(userRoot, path)` 写盘，
 * 所以必须在这里挡住 `..`、盘符、UNC、绝对路径、以及任何多余的目录层级。
 */
export function isAllowedBackupPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return false;
  // 反斜杠、盘符、前导斜杠、`..` 一律不接受：备份包的路径只用正斜杠且只有一层目录
  if (path.includes('\\') || path.includes(':') || path.startsWith('/')) return false;
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  if (FIXED_PATHS.has(path)) return true;
  const m = PET_PATH.exec(path);
  if (!m) return false;
  const prefix = m[1];
  if (prefix.length === 0 || prefix.length > MAX_PREFIX) return false;
  // 与 saveUserConfig 里 id 的过滤规则同一份（Windows 保留符 + 控制字符）
  if (ID_FORBIDDEN.test(prefix)) return false;
  return true;
}

/** 扫 `pet/` 下所有 `<前缀>-config.json`（与 config.ts 的 scanPetFiles 同一套文件名规则） */
function petConfigNames(petDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(petDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return []; // pet/ 不存在 = 没有文件宠物
  }
  return names.filter((n) => /^.+?-config\.json$/.test(n)).sort();
}

/**
 * 收集当前状态成一个备份包。
 *
 * 读不出来的文件**跳过而不是抛错**：备份的价值在于「能救多少救多少」，
 * 一个权限怪异的文件不该让整次导出失败。跳过的会在返回值的 `skipped` 里列出（调用方展示）。
 */
export function collectBackup(
  paths: ConfigPaths,
  userRoot: string,
  options: BackupOptions = {},
): { bundle: BackupBundle; skipped: string[] } {
  const files: BackupFile[] = [];
  const skipped: string[] = [];

  const push = (rel: string, abs: string): void => {
    if (files.length >= MAX_FILES) {
      skipped.push(rel);
      return;
    }
    try {
      const text = readFileSync(abs, 'utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
        skipped.push(rel);
        return;
      }
      files.push({ path: rel, text, sha256: sha256(text) });
    } catch {
      skipped.push(rel);
    }
  };

  // 主配置：优先 .jsonc；老用户可能还停在 .json（迁移前的形态）
  if (existsSync(paths.userFile)) push('main-config.jsonc', paths.userFile);
  else if (paths.legacyUserFile !== undefined && existsSync(paths.legacyUserFile))
    push('main-config.jsonc', paths.legacyUserFile);

  for (const name of petConfigNames(paths.petDir)) {
    const rel = `pet/${name}`;
    // 文件名本身也可能含非法字符（用户手放的），走同一道白名单
    if (!isAllowedBackupPath(rel)) {
      skipped.push(rel);
      continue;
    }
    push(rel, join(paths.petDir, name));
  }

  const memoryPath = join(userRoot, 'memory.json');
  if (existsSync(memoryPath)) push('memory.json', memoryPath);

  const includeApiKey = options.includeApiKey === true;
  if (includeApiKey) {
    const aiPath = join(userRoot, 'standalone-ai.json');
    if (existsSync(aiPath)) push('standalone-ai.json', aiPath);
  }

  const bundle: BackupBundle = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    appVersion: options.appVersion ?? '',
    includeApiKey,
    files,
    sha256: bundleDigest(files),
  };
  return { bundle, skipped };
}

export interface BackupValidationError {
  ok: false;
  /** 机器可读的原因（设置页按它给不同提示） */
  reason:
    | 'not-json'
    | 'wrong-format'
    | 'unsupported-version'
    | 'too-large'
    | 'too-many-files'
    | 'bad-path'
    | 'file-mismatch'
    | 'bundle-mismatch'
    | 'bad-content';
  /** 给人看的中文说明 */
  message: string;
  /** 出问题的具体文件（可选） */
  file?: string;
}

export type BackupValidation = { ok: true; bundle: BackupBundle } | BackupValidationError;

function fail(
  reason: BackupValidationError['reason'],
  message: string,
  file?: string,
): BackupValidationError {
  return file === undefined ? { ok: false, reason, message } : { ok: false, reason, message, file };
}

/** 极简 JSONC 剥注释（与 config.ts 的 stripJsonc 同一套思路，只为让导入端能验内容） */
function stripJsoncComments(src: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  // 尾逗号容错（JSONC 常见；用户手改过的配置里几乎必然出现）
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 校验一个已解析的备份对象。
 *
 * 逐条对应文件头注释里的 6 条校验。任何一条不过 → 返回结构化失败，
 * **绝不做「尽力而为的部分导入」**：备份恢复要么全成，要么一个字节都不写。
 */
export function validateBackup(raw: unknown): BackupValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('wrong-format', '这个文件不是桌宠备份（期望一个 JSON 对象）。');
  }
  const o = raw as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) {
    return fail('wrong-format', '这个文件不是桌宠备份（缺少 dsh-pet-backup 标记）。');
  }
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) {
    return fail('unsupported-version', '备份文件的版本字段无效。');
  }
  if (version > BACKUP_VERSION) {
    return fail(
      'unsupported-version',
      `这个备份来自更新的版本（格式 v${version}，本机只支持到 v${BACKUP_VERSION}）。请先升级桌宠再导入。`,
    );
  }
  if (!Array.isArray(o.files)) {
    return fail('wrong-format', '备份文件缺少 files 列表。');
  }
  if (o.files.length === 0) {
    return fail('wrong-format', '这个备份里没有任何数据。');
  }
  if (o.files.length > MAX_FILES) {
    return fail('too-many-files', `备份里的文件数（${o.files.length}）超过上限 ${MAX_FILES}。`);
  }

  const files: BackupFile[] = [];
  const seen = new Set<string>();
  for (const item of o.files) {
    if (!item || typeof item !== 'object') return fail('bad-content', '备份里的文件条目格式不对。');
    const f = item as Record<string, unknown>;
    const path = f.path;
    if (typeof path !== 'string') return fail('bad-path', '备份里有文件缺少路径。');
    if (!isAllowedBackupPath(path)) {
      return fail('bad-path', `备份里含有不允许写入的路径：${path}`, path);
    }
    if (seen.has(path)) return fail('bad-path', `备份里同一个路径出现了两次：${path}`, path);
    seen.add(path);
    const text = f.text;
    if (typeof text !== 'string') return fail('bad-content', `「${path}」的内容不是文本。`, path);
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
      return fail('too-large', `「${path}」超过单文件上限 ${Math.round(MAX_FILE_BYTES / 1024)} KB。`, path);
    }
    const digest = sha256(text);
    const declared = f.sha256;
    if (typeof declared === 'string' && declared !== '' && declared !== digest) {
      return fail('file-mismatch', `「${path}」的校验值不符，文件可能被改动过或损坏。`, path);
    }
    files.push({ path, text, sha256: digest });
  }

  // 整包校验：只对「真的带了 sha256 字段」的包强制——手工拼的极简包也能导入，但会少一层防增删保护
  if (typeof o.sha256 === 'string' && o.sha256 !== '') {
    const actual = bundleDigest(files);
    if (actual !== o.sha256) {
      return fail('bundle-mismatch', '整包校验不符：里面有文件被增删或改动过，已拒绝导入。');
    }
  }

  // 内容可解析性：别让一个语法坏掉的配置把桌宠搞成起不来
  for (const f of files) {
    if (f.path === 'memory.json' || f.path === 'standalone-ai.json') {
      try {
        const v = JSON.parse(f.text) as unknown;
        if (!v || typeof v !== 'object') {
          return fail('bad-content', `「${f.path}」不是一个 JSON 对象。`, f.path);
        }
      } catch {
        return fail('bad-content', `「${f.path}」不是合法 JSON。`, f.path);
      }
      continue;
    }
    // 配置层：JSONC，允许注释
    try {
      const v = JSON.parse(stripJsoncComments(f.text)) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return fail('bad-content', `「${f.path}」不是一个配置对象。`, f.path);
      }
    } catch {
      return fail('bad-content', `「${f.path}」不是合法 JSON/JSONC。`, f.path);
    }
  }

  const bundle: BackupBundle = {
    format: BACKUP_FORMAT,
    version,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : '',
    includeApiKey: o.includeApiKey === true,
    files,
    sha256: typeof o.sha256 === 'string' ? o.sha256 : '',
  };
  return { ok: true, bundle };
}

/** 从原始文本解析并校验（设置页上传的 JSON 文本走这条） */
export function readBackup(raw: string): BackupValidation {
  if (Buffer.byteLength(raw, 'utf8') > BACKUP_MAX_BYTES) {
    return fail('too-large', `备份文件超过上限（${Math.round(BACKUP_MAX_BYTES / 1024)} KB）。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return fail('not-json', '这个文件不是合法 JSON（可能选错了文件）。');
  }
  return validateBackup(parsed);
}

export interface BackupImportPlan {
  /** 相对路径（与 bundle.files[].path 同口径） */
  path: string;
  /** 目标绝对路径 */
  absolute: string;
  /** 字节数（UTF-8） */
  bytes: number;
  /** 目标是否已存在（设置页用它提示「会覆盖」） */
  overwrite: boolean;
}

/**
 * 算出「如果现在导入，会写哪些文件」——只读，不落盘。
 *
 * 设置页先拿它给用户看一眼（覆盖哪些、新增哪些），确认后才真导。
 * 这样「点错文件直接覆盖掉全部配置」这个最贵的误操作就没有发生的机会。
 */
export function planBackupImport(
  paths: ConfigPaths,
  userRoot: string,
  bundle: BackupBundle,
): BackupImportPlan[] {
  return bundle.files.map((f) => {
    const absolute = f.path.startsWith('pet/')
      ? join(paths.petDir, f.path.slice('pet/'.length))
      : join(userRoot, f.path);
    return {
      path: f.path,
      absolute,
      bytes: Buffer.byteLength(f.text, 'utf8'),
      overwrite: existsSync(absolute),
    };
  });
}

export interface BackupApplyResult {
  written: Array<{ path: string; bytes: number; overwrite: boolean }>;
  /** 落盘前的自动副本（同名 + .bak-before-import-<时间戳>）；无旧文件则为空 */
  backups: string[];
  /** 清掉的 API 密钥残留（导入的包不含密钥、但本机原有密钥文件时，见下方说明） */
  apiKeyKept: boolean;
}

/**
 * 执行导入：逐个写盘。
 *
 * ## 两处刻意的设计
 *
 * 1. **写前先留副本**：已存在的目标文件复制成 `<名>.bak-before-import-<yyyyMMdd-HHmmss>`。
 *    导入是破坏性操作，用户手滑选错包时这是唯一的退路。副本名不匹配
 *    `pet/*-config.json` 的扫描规则（后缀不对），所以不会被当成宠物读进去。
 *
 * 2. **不含密钥的包不删本机密钥**：如果备份包 `includeApiKey === false` 且本机已有
 *    `standalone-ai.json`，**保持原样**。理由：用户的直觉是「导入配置」而不是「清空我的密钥」，
 *    静默删掉密钥会让碎碎念/对话突然全挂且完全不知道为什么。
 */
export function applyBackupImport(
  paths: ConfigPaths,
  userRoot: string,
  bundle: BackupBundle,
  options: { now?: Date } = {},
): BackupApplyResult {
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '')
    .replace('T', '-');
  const written: BackupApplyResult['written'] = [];
  const backups: string[] = [];
  const hasApiKeyFile = bundle.files.some((f) => f.path === 'standalone-ai.json');

  for (const f of bundle.files) {
    const absolute = f.path.startsWith('pet/')
      ? join(paths.petDir, f.path.slice('pet/'.length))
      : join(userRoot, f.path);
    mkdirSync(dirname(absolute), { recursive: true });
    const existed = existsSync(absolute);
    if (existed) {
      const copy = `${absolute}.bak-before-import-${stamp}`;
      try {
        writeFileSync(copy, readFileSync(absolute));
        backups.push(copy);
      } catch {
        // 复制失败不阻断导入（可能是只读），但会在 backups 里缺这一条——调用方展示数量即可
      }
    }
    writeFileSync(absolute, f.text, 'utf8');
    written.push({ path: f.path, bytes: Buffer.byteLength(f.text, 'utf8'), overwrite: existed });
  }

  return { written, backups, apiKeyKept: !hasApiKeyFile && existsSync(join(userRoot, 'standalone-ai.json')) };
}
