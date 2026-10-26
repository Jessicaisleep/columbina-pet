/**
 * 助手沙箱与权限模型（host 半侧，纯逻辑 + 少量 path/fs）。
 *
 * ## 三档权限（与 DSH 同构，但**工作区只有桌宠自己的文件夹**）
 * | 档位 | 读 | 写 | 说明 |
 * |---|---|---|---|
 * | `readonly` 只读 | 工作区内 + 网络 | ✗（一律拒绝，可走审批） | 最保守，默认值 |
 * | `workspace` 工作区内修改 | 工作区内 | 仅工作区内（越界走审批） | 日常用这档 |
 * | `full` 完全权限 | 任意 | 任意 | 危险，设置页有二次确认 |
 *
 * ## 工作区根怎么定
 * 优先取「DSH_HOME 的上一级且该目录里真有 dsh-pet.exe」——独立模式下 `DSH_HOME=%~dp0data`，
 * 上一级就是桌宠安装目录，符合「工作区只有桌宠文件夹」。
 * 拿不到（DSH_HOME 未设 / 上一级不像安装目录）就退到 `<数据根>/workspace`，
 * **绝不**把用户主目录当工作区（那等于没沙箱）。
 *
 * ## 越界与审批
 * 任何被权限挡下的**写**操作不会静默失败：调用方（assistant 循环）会生成一条审批请求，
 * 等用户在设置页点「允许」后以**一次性**授予重试。审批只覆盖「同一个工具 + 同一个目标路径」，
 * 不做通配——避免一次批准变成永久放行。
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** 权限档位 */
export type AssistantPermission = 'readonly' | 'workspace' | 'full';

/** 合法档位集合（配置校验用） */
export const ASSISTANT_PERMISSIONS: readonly AssistantPermission[] = ['readonly', 'workspace', 'full'];

export function isAssistantPermission(v: unknown): v is AssistantPermission {
  return typeof v === 'string' && (ASSISTANT_PERMISSIONS as readonly string[]).includes(v);
}

/**
 * 算出工作区根（绝对路径，已规范化）。
 *
 * @param dshHome DSH_HOME 指向的数据根（`<安装目录>/data`）；未配置时传空串
 * @returns 工作区根绝对路径
 */
export function resolveWorkspaceRoot(dshHome: string): string {
  const home = (dshHome ?? '').trim();
  if (home !== '') {
    const parent = dirname(resolve(home));
    // 只有当上一级确实像「桌宠安装目录」时才认——否则退回数据根下的 workspace，
    // 防止 DSH_HOME 恰好是某个浅层目录（如 C:\Users\x）时把主目录当工作区。
    const looksLikeApp = ['dsh-pet.exe', 'resources', '启动桌宠.bat'].some((mark) =>
      existsSync(join(parent, mark)),
    );
    if (looksLikeApp) return parent;
    return join(resolve(home), 'workspace');
  }
  return join(resolve(home === '' ? '.' : home), 'workspace');
}

/**
 * 算某只宠物自己的干净工作区目录（程序根目录下的 `宠物工作区/<petId>/`）。
 *
 * ## 为什么每只宠物一个目录（2026-10-26 用户要求）
 * 两只桌宠同时具备写文件能力时，共用一个工作区会互相覆盖对方的文件——而且从对话
 * 里根本看不出是谁改的。按 petId 分目录之后：**各自的助手只能看见各自的文件**，
 * 天然隔离，也便于用户直接去文件夹里翻「哥伦比娅今天写了什么」。
 *
 * ## 目录位置与清理语义
 * 放在**程序根目录**（`<安装目录>/宠物工作区/<petId>/`）而不是数据目录：
 * 用户要能方便地看到、打开、手工整理这些文件；放 data 深处等于藏起来。
 *
 * ## petId 的合法性
 * petId 由配置校验（`ID_FORBIDDEN`）保证不含路径分隔符，但这里仍做一次防御性过滤：
 * 工作区路径来自它，一旦被注入 `..` 就能越出根目录（沙箱整个失效）。
 *
 * @param appRoot 程序根目录（`resolveWorkspaceRoot` 的结果）
 * @param petId   宠物 id
 * @returns 该宠物工作区的绝对路径
 */
export function resolvePetWorkspace(appRoot: string, petId: string): string {
  // 防御性清洗：只留字母数字下划线连字符与中文，其余（含 . / \ :）一律替换成 _
  const safe = (petId ?? '').trim().replace(/[^0-9A-Za-z_\-\u4e00-\u9fff]/g, '_');
  const name = safe === '' ? 'pet' : safe;
  return join(appRoot, '宠物工作区', name);
}

/** 把路径规范化成「可比对的小写绝对路径」（Windows 大小写不敏感） */
function norm(p: string): string {
  let out = resolve(p);
  try {
    if (existsSync(out)) out = realpathSync(out);
  } catch {
    /* 不存在就用 resolve 的结果 */
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** 目标是否落在工作区内（含工作区根本身） */
export function isInsideWorkspace(workspaceRoot: string, target: string): boolean {
  const root = norm(workspaceRoot);
  const t = norm(target);
  if (t === root) return true;
  return t.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * 相对路径统一按工作区解析（模型常给 `notes/a.txt` 这种相对路径）。
 * 绝对路径原样返回（可能是越界的，由权限层判）。
 */
export function resolveTarget(workspaceRoot: string, p: string): string {
  const raw = (p ?? '').trim();
  if (raw === '') return workspaceRoot;
  return isAbsolute(raw) ? resolve(raw) : resolve(join(workspaceRoot, raw));
}

/** 一次操作的权限判定结果 */
export type PermissionVerdict =
  | { ok: true }
  | { ok: false; reason: 'readonly' | 'outside-workspace'; message: string };

/**
 * 判定「读」是否允许。
 *
 * 读的门槛低：只读档也允许读（否则助手什么都干不了）。
 * 但**只读档也只读工作区**——用户没理由让桌宠在只读模式下翻遍全盘。
 */
export function checkRead(permission: AssistantPermission, workspaceRoot: string, target: string): PermissionVerdict {
  if (permission === 'full') return { ok: true };
  if (isInsideWorkspace(workspaceRoot, target)) return { ok: true };
  return {
    ok: false,
    reason: 'outside-workspace',
    message: `读取 ${target} 超出了工作区（${workspaceRoot}）。要做这件事需要把权限提到「完全权限」。`,
  };
}

/**
 * 判定「写 / 删除 / 执行」是否允许。
 *
 * 只读档一律拒绝；工作区档只允许工作区内；完全权限放行。
 */
export function checkWrite(
  permission: AssistantPermission,
  workspaceRoot: string,
  target: string,
): PermissionVerdict {
  if (permission === 'full') return { ok: true };
  if (permission === 'readonly') {
    return {
      ok: false,
      reason: 'readonly',
      message: `现在是「只读」权限，不能写入或删除。要改 ${target} 需要提权。`,
    };
  }
  if (isInsideWorkspace(workspaceRoot, target)) return { ok: true };
  return {
    ok: false,
    reason: 'outside-workspace',
    message: `${target} 在工作区（${workspaceRoot}）之外。要改它需要把权限提到「完全权限」。`,
  };
}

/**
 * 一次性授权（审批通过后短时生效）。
 *
 * 键 = `工具名|规范化目标`，只对**同一个工具 + 同一个目标**放行，不做通配。
 * 有效期默认 120 秒：审批是「就这一次」，不是「以后都行」。
 */
export class GrantStore {
  private grants = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs = 120_000) {
    this.ttlMs = ttlMs;
  }

  private key(tool: string, target: string): string {
    return tool + '|' + (process.platform === 'win32' ? target.toLowerCase() : target);
  }

  /** 记一次授权 */
  grant(tool: string, target: string): void {
    this.grants.set(this.key(tool, target), Date.now() + this.ttlMs);
  }

  /** 查是否仍有授权（过期即失效并清掉） */
  has(tool: string, target: string): boolean {
    const k = this.key(tool, target);
    const until = this.grants.get(k);
    if (until === undefined) return false;
    if (Date.now() > until) {
      this.grants.delete(k);
      return false;
    }
    return true;
  }

  /** 消费掉一次授权（一次性语义：用过就没了） */
  consume(tool: string, target: string): void {
    this.grants.delete(this.key(tool, target));
  }

  /** 清空（权限档位变化时调用——提权/降权都应让旧授权失效） */
  clear(): void {
    this.grants.clear();
  }
}
