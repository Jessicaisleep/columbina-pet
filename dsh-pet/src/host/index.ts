/**
 * dsh-pet 宿主半侧（host half）—— 宠物插件的"后端"部分
 *
 * 职责：提供 `/dsh-pet-7340/` 前缀的**业务能力**（handlePetRoute 纯函数，路由与桌面管道共用）。
 * 全部配置（内置默认 + 用户主配置 + 文件宠物）由 ./config 的 readAllConfig 统一读取合并，
 * 本文件只消费它的返回值（绝对正确、零校验），不再接触任何配置文件。
 *
 * 两个入口消费同一份 handlePetRoute：
 *   - HTTP 路由：注册在 DSH WebServer 上（浏览器 overlay / 设置页 / 斜杠命令用）
 *   - 桌面 Helper 管道：helper-process.ts 的 bridgeHandler（DSH_PET_BRIDGE=1 时经
 *     dsh-pet-bridge:// scheme + stdout JSON 行 + 本地回调，**不走 HTTP**——
 *     DSH Desktop 2.0.3+ 的浏览器访问闸门会拦插件子进程的裸 HTTP 请求）
 * 两端行为严格一致（硬契约：浏览器/桌面功能/文案/配置完全对齐）。
 *
 * 路由：
 *   /dsh-pet-7340/config             → 合并后的**成品配置**（{ main:{...}, test1:{...}, ... }，
 *                                每条目字段已填满；浏览器/桌面/设置页的唯一配置入口）
 *                                GET 读取成品；PUT 保存用户层（白名单重建 main-config.jsonc）、
 *                                POST 同步用户层（把内置默认 config.jsonc **原文**整份写入，
 *                                含注释与全部高级字段；合并结果与「没有用户层」等价）——
 *                                两个写接口的**响应体都是保存后的成品聚合**，设置页即时生效
 *                                直接拍平这份响应，客户端不再有第二份"补吹条目级字段"的实现
 *   /dsh-pet-7340/reload              → 桌面端「重载配置」（右键菜单，POST）：重启桌面 Helper，全部桌面
 *                                宠物窗口按最新配置重建（改配置文件后不必回设置页点保存）；与保存走
 *                                **同一条**重启路径（syncDesktop），宠物数量/display/size 变化同样生效
 *   /dsh-pet-7340/config/meta         → 配置文件与素材目录路径 + 日志文件 + 全部存储位置清单
 *                                       （设置页「高级配置」「卸载与存储」展示用）
 *   /dsh-pet-7340/models              → 可选「服务商 + 模型」清单（设置页「AI 模型」下拉框数据源；
 *                                       与 DSH 模型选择器同源，取宿主 llm 服务的 listProviders/listModels）
 *   /dsh-pet-7340/thumb/<素材根>/<动画名>.webm|.mov  → 素材按宠物归属（.mov 为 macOS 定制，扩展名取决于
 *       客户端播放常量 ANIMATION_EXT；本路由固定双扩展名兜底）：
 *       文件宠物 = $DSH_HOME/dsh-pet/pet/<素材根>-animation/（只查自己的，绝不回落）；
 *       主宠物   = $DSH_HOME/dsh-pet/main-animation/<webm|mov>（用户目录，优先）→ 包内 assets/<webm|mov>
 *       <素材根> 是**标识符**（pet/ 下文件名前缀），含分隔符/保留字符即 400（见 ID_FORBIDDEN）
 *   /dsh-pet-7340/state               → **轮询统一状态 S**（GET，前端 1s 轮询的唯一数据源）：
 *                                       { sections: { balance, workStatus, notify }, pets: { <id>: { say } } }，
 *                                       每个叶子 = { counter, data }；counter 变了前端才渲染。
 *                                       只读、纯内存、零副作用（绝不在这里触发外部调用/模型生成）。
 *   /dsh-pet-7340/work-status          → 外部写入工作状态（POST = 设置固定外部槽的档位/文案；
 *                                       DELETE = 清空回空闲。不做多写者仲裁/租约/会话管理）
 *   /dsh-pet-7340/balance              → 余额刷新（POST 动作端点，写 S；数据从 /state 读）
 *   /dsh-pet-7340/whisper              → 让某只宠物立即说一句（POST 动作端点，写 S 的 pets.<id>.say；
 *                                       响应带生成的 text，配图时带 image）
 *   /dsh-pet-7340/broadcast            → 第三方投喂：把外部给定的文本写进气泡（POST 动作端点，写 S 的
 *                                       pets.<id>.say；不生成、只搬运，供宿主侧其他插件集成）。
 *                                       配图给 `image`（池内名）或 `url`（第三方自带的完整地址）二选一
 *   /dsh-pet-7340/anim                 → 点播动画：让桌宠播一段动画（POST 动作端点，写 S 的
 *                                       pets.<id>.anim；供其他插件调用）。`name`（池内名，效果与右键
 *                                       「动作」菜单一致）或 `url`（第三方自带的完整地址，不查池、
 *                                       不走菜单语义）二选一。
 *                                       响应带 playbackId，供 /playback 查**真实回执**
 *   /dsh-pet-7340/lock                 → **占用锁**（issue #122 第 4 项，POST 动作端点）：联动演出
 *                                       期间独占这只宠物，除持锁者外全静音。`lockId` 给了 = 续期、
 *                                       没给 = 新建；回 { lockId, expiresAt }。内存态 + TTL。
 *                                       没带 lock 时行为与改造前逐字一致；带了但查不到锁 → lock-lost
 *   /dsh-pet-7340/lock/release         → 释放占用（POST 动作端点）：`lockId` = 持锁者收工 /
 *                                       `force` = **渲染端**报告用户接管（拖拽、点击、隐藏、关闭）。
 *                                       占用期间 5 个动作端点必须带 `?lock=<lockId>`，否则
 *                                       lock-required（没带）/ lock-lost（带了不匹配，附 cause）
 *   `?surface=`（**必填**，issue #122 第 1 条）→ 声明"我要**哪一端**的宠物"：web / desktop /
 *                                       both / any。`pet` 只说明"哪一只"，不说明"哪一端"——一只
 *                                       `display: desktop` 的宠物被当成网页目标时宿主照旧受理，
 *                                       但**没有任何渲染端会消费它**（拿到 ok:true 却什么都不会
 *                                       发生，直到回执超时）。这里把那种"必然不可能"提前变成显式
 *                                       失败：pet-not-displayed + **该宠物实际的 display**。
 *                                       **只开在会产生渲染端可见效果的端点上**：/anim、/broadcast、
 *                                       /bubble/clear、/position、/throw、/lock、/whisper 与
 *                                       /chat 的 POST；/lock/release（释放必须永远能成功）与
 *                                       /chat 的 GET（读记忆与显示在哪一端无关）**不开**。见 ./surface
 *   /dsh-pet-7340/playback/<id>        → **播放回执**（GET）：返回那一次点播的真实状态
 *                                       （accepted/playing/ended/failed/cancelled）。带
 *                                       `?wait=<状态[,状态]>` + `?timeout=<ms>`（**成对必填**）时挂起等待：
 *                                       状态进入 wait 集合立刻返回（matched:true），到点返回当时状态
 *                                       （matched:false）；两者都不传则立刻返回
 *   /dsh-pet-7340/playback/<id>/report → 渲染端上报播放状态（POST，**内部通道**：浏览器/桌面
 *                                       渲染进程 → host）。这是回执的**地基**——没有它，记录永远停在
 *                                       accepted（host 只知道"受理了"，不知道播没播完）。见 ./playback
 *   /dsh-pet-7340/chat                 → 对话与记忆（GET 最近窗口 / POST 对话并写 memory.json；
 *                                       POST 回 {ok,text,image?}，回复同样写 S 的 pets.<id>.say）
 *   /dsh-pet-7340/font|pic             → 字体 / 通知图标素材
 *
 * 系统通知不属于宠物行为、不在这里的旧实现是：浏览器半侧 notify.ts 经 connection 事件流
 * （api.events.mux/host）监听 DSH 事件。但 DSH 0.1.5 已删除该事件流 API——通知改为
 * host 侧监听宿主事件（session/event + agent/error）生成帧写进 S 的 sections.notify，
 * 浏览器统一轮询 /state 后弹 toast（帧契约与 shared/notify.ts 一致；单槽，见下方 pushNotifyFrame）。
 *
 * 桌面模式（Electron 透明窗）没有独立配置文件：宠物显示在哪全部由宠物条目的 display 决定
 * （web=仅浏览器 / desktop=仅桌面 / both=两者 / none=都不显示；缺失时合并器填内置默认值）。
 *
 * 安全性：resolveAsset 做"防穿越"校验，保证路径仍在对应根目录内；
 *         PUT 保存经 saveUserConfig 白名单重建，id 过滤文件名非法字符。
 *
 * TODO(类型)：peer 依赖类型包本地暂不可解析，ctx/req/res 暂用 any；
 *             依赖可解析后替换为 DSH 官方类型。
 */
import { createReadStream, existsSync, fstatSync, readFileSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { listBalanceProviders, queryBalance, registerBalanceProvider } from './balance/index';
import { generateWhisper } from './whisper';
import { automaticWhisperSchedule, type StandaloneWhisperPolicy } from './whisper-policy';
import { generateChat, generateMemorySummary } from './chat';
import {
  buildSummaryUserText,
  compressPolicyOf,
  memorySection,
  normalizeSummary,
  overviewOf,
  planCompression,
  SUMMARY_SYSTEM_PROMPT,
  summarizedOf,
  type ChatMemoryEntry,
  type MemoryOverview,
} from './memory-summary';
import { configuredModel } from './model-selection';
import { limitPool, pickMeme, readMemePool } from './memes';
import {
  decideBroadcast,
  decideBubbleClear,
  normalizeBroadcastAnim,
  normalizeBroadcastDuration,
  normalizeBroadcastText,
} from './broadcast';
import { decideAnim } from './anim';
import { LockStore } from './lock';
import { createFileLogger, isFileLogger, setDefaultLogger } from './log-file';
import { MENU_WAIT_MAX_MS, MenuRegistry } from './menu';
import { decidePosition, decideThrow, positionLeafData } from './motion-cue';
import { parsePlaybackPath, parseWaitQuery, PlaybackStore } from './playback';
import { PoseStore, normalizePoseInput } from './pose';
import { SURFACE_TEXT, displayCovers, normalizeSurface, type Surface } from './surface';
import {
  findPetInstance,
  flattenPetList,
  ID_FORBIDDEN,
  migrateUserConfig,
  PET_DISPLAY_SET,
  readAllConfig,
  readPetConfigEntry,
  readUserConfig,
  saveUserConfig,
  sliceMemoryRounds,
  syncUserConfigFromDefault,
  userConfigUnparsable,
  type ConfigPaths,
} from './config';
import {
  GOAL_UPDATE_TOOL,
  HOST_WORK_STATUS_STATES,
  TASK_TEXT_MAX,
  reduceWorkStatus,
  currentTaskFromTodo,
  goalUpdateAction,
  WorkStatusStore,
  type HostWorkStatusState,
  type WorkStatusTurnContext,
} from './work-status';
import { toolDetailFromEvent } from './tool-detail';
import {
  agentErrorFrame,
  hasBlockingActivity,
  isCompletionTurnEnd,
  reduceNotifyFrame,
  sessionIdOf,
  shouldNotifySession,
  withSessionId,
  type HostNotifyFrame,
} from './notify-events';
import { profileNameFrom, storageEntries } from './storage-paths';
import { parseStateWaitQuery, PollStateStore } from './state';
import { composeSystemPrompt, petPersona } from './persona';
import { ScreenReader, screenContextOf, screenReaderAvailable } from './screen-context';
import { runAssistant } from './assistant/loop';
import { appendRecord, buildRecord, clearRecords, countRecords, readRecords } from './assistant/history';
import {
  GrantStore,
  isAssistantPermission,
  resolvePetWorkspace,
  resolveWorkspaceRoot,
  type AssistantPermission,
} from './assistant/permissions';
import type { ToolContext } from './assistant/tools';
import {
  HelperProcess,
  defaultElectronExe,
  dshHomeDir,
  electronLandingDir,
  ensureElectronDownload,
  hasGraphicalDisplay,
  resolveElectronPath,
} from './helper-process';

/** 插件行 id（与 cordis.patch.yml 一致） */
export const name = 'pet';
/** 需要注入的服务：webServer（路由）+ agentDefaultModel（当前服务商）+ credentials（凭证）+ llm（对话模型调用）+ commands（/balance 斜杠命令）+ connection（桌面 Helper「打开网站」用的已鉴权站点 URL） */
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection'];

/** 本包目录：宿主构建产物位于 lib/，其上一级即包根。 */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 包内 assets 根 */
const PACKAGE_ROOT_ASSETS = join(PACKAGE_ROOT, 'assets');

/** 包内表情包目录（表情包池的最后一环：assets/memes/<名称>.png） */
const PACKAGE_MEMES_DIR = join(PACKAGE_ROOT_ASSETS, 'memes');

/** 路由前缀 */
const ROUTE_PREFIX = '/dsh-pet-7340';

/**
 * 宿主是不是 **DSH 桌面应用**（Electron 宿主）。
 *
 * 判据只用 `process.versions.electron`：桌面应用以 `ELECTRON_RUN_AS_NODE=1` 跑宿主（见 dsh.cmd），
 * 该字段照样在；而 `dsh web` / 独立模式都是纯 Node 进程，取不到它。据此把「打开网站」自动分派：
 * 桌面宿主 → 唤起桌面应用窗口（helper 走 `dsh://open`），其余 → 浏览器打开站点。
 */
const isDesktopHost = (): boolean => Boolean(process.versions.electron);

/** 不同扩展名对应的 Content-Type 映射 */
const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.jsonc': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * 规范化并校验请求路径，确保它在 assets 根目录内（防路径穿越）。
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined
 */
function resolveAsset(root: string, rel: string): string | undefined {
  if (rel.length === 0) return undefined;
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/** 在 root 下解析并确认实体存在；非法（穿越）或不存在时返回 undefined */
function resolveExisting(root: string, rel: string): string | undefined {
  const candidate = resolveAsset(root, rel);
  return candidate && existsSync(candidate) ? candidate : undefined;
}

/**
 * 流式返回一个文件（带 Content-Type / 长度 / 缓存头）。
 *
 * Content-Length 必须取自**正在读的那个 fd**（open 事件里 fstat），不能先 stat 再另开流：用户往
 * $DSH_HOME/dsh-pet/main-animation/webm/ 复制或同名覆盖素材时，stat 与真正开始读之间文件会被截断/
 * 改写，一旦实际字节数少于声明的长度，这个响应就**永远不结束、也不报错**（浏览器表现为 stalled、
 * 视频 loadeddata 永不触发且无 error）——正是 issue #62 现场"数据断供"的一种成因。同一个 fd 的
 * fstat 拿到的大小与随后读出的字节天然一致。
 */
function sendFile(res: ServerResponse, file: string, contentType: string): void {
  const stream = createReadStream(file);
  stream.once('open', (fd) => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy(); // 客户端在开流前就放弃了
      return;
    }
    try {
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': fstatSync(fd).size,
        'cache-control': 'public, max-age=3600',
      });
    } catch {
      // 极端情况下 fstat 拿不到：不发长度头，交给 Node 用 chunked 收尾（长度天然一致，只是没声明）
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=3600' });
    }
    stream.pipe(res);
  });
  // 读失败（文件被删/权限/被占用）：直接断连，让客户端立刻看到失败，而不是无限等待
  stream.on('error', () => res.destroy());
  // 客户端提前断开（快速切动画时高频发生）→ 停读，别把整个文件读完
  res.on('close', () => stream.destroy());
}

// 配置的读取/校验/合并/保存全部收敛在 ./config（readAllConfig / saveUserConfig，host 自包含实现，
// 不 import src/shared —— DSH 单文件加载约束）。本文件不再保留任何配置逻辑，只消费成品返回值。

/** 该宠物是否参与桌面模式（Electron 透明窗） */
const isDesktopVisible = (display: unknown): boolean => display === 'desktop' || display === 'both';

/** 发送 JSON 响应（headers 可选：如 no-cache 触发计数） */
function sendJson(res: ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/** 发送纯文本响应（素材 404/400 等显式错误文案） */
function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/** 单次业务路由的应答（WebServer 注册与桌面 Helper 管道共用的同一契约；消费方各自落盘） */
type RouteResult =
  | { kind: 'json'; status: number; obj: unknown; headers?: Record<string, string> }
  | { kind: 'text'; status: number; body: string }
  | { kind: 'file'; file: string; contentType: string }
  /** 无需应答：调用方在挂起等待期间已断开（见 /playback 的等待分支）——消费方直接收尾，不写 */
  | { kind: 'none' };

/** 收集请求体（文本） */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve2, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve2(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 额外宠物（pet pack）说明：校验/扫描已收敛到 ./config（readAllConfig 内部逐字段合并），
// 这里不再有 host 侧拷贝——文件宠物与主宠物一样，统一从 readAllConfig 的成品读取。
// ---------------------------------------------------------------------------

/** 宿主插件主体：注册 `/dsh-pet-7340` 前缀路由 + 斜杠命令（/balance /pet /chat）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx（webServer/locale 等 service 无静态类型）
export function apply(ctx: any): void {
  // 用户数据根：配置与用户素材统一收敛于此（扩展包按 <插件id> 各自建目录）
  const dshHome = resolveDshHome();
  const userRoot = join(dshHome, 'dsh-pet');
  // 统一日志出口（单文件、按大小截断，见 ./log-file）：桌面版 DSH 没有控制台，
  // `ctx.logger` 只写宿主 stdout 等于把排障信息丢掉。放在最前面——下面的配置迁移、
  // 桌面判定、Helper 崩溃/重启都走它；`base` 保留终端输出，node 版行为不变。
  //
  // standalone / 独立应用已经把**自己的**文件 logger 挂在 ctx.logger 上（见 standalone/context.ts）：
  // 那时必须复用它，否则两个 logger 各自的缓冲与截断会写同一个文件、互相踩。
  const reusedLog = isFileLogger(ctx.logger) ? ctx.logger : undefined;
  const log =
    reusedLog ??
    createFileLogger({
      file: join(userRoot, 'logs.txt'),
      base: ctx.logger,
      debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
    });
  // 纯模块（./config、./chat、./whisper）拿不到 ctx.logger，用这个默认出口落盘
  setDefaultLogger(log);
  // 只在自己创建时负责收尾：复用的 logger 归 standalone/app 生命周期管，插件卸载不该把它关掉。
  if (!reusedLog) {
    ctx.effect(
      () => () => {
        void log.flush();
        log.dispose();
      },
      'dsh-pet: log file',
    );
  }
  /**
   * 软取宿主提供的**可选服务**（DSH 的 `ctx.get(name, required)` 语义：缺失返回 undefined，不抛）。
   *
   * 为什么不直接读 `ctx.standaloneAi`：DSH 的 ctx 是**严格 getter**，读一个没写进 `inject`
   * 的服务会**抛异常**（`cannot get property "standaloneAi" without inject`），而不是返回 undefined。
   * 独立模式独有的两个能力都没进 inject，裸读在 DSH 里必然炸：
   *   - 碎碎念周期 tick 每拍都抛 → catch 后不再排下一拍 → 自动碎碎念永久停摆（7440b96 起）；
   *   - /quit 的 `typeof ctx.shutdownApp` 每个请求都抛 → GET /quit 回 500，而不是 {canQuit:false}。
   * 与下面余额里取 `deepseekAccount` 的写法同源：可选服务一律软取，不进 inject。
   *
   * 最小 fake ctx（测试里的普通对象）没有 get：回落成属性读取，语义一致（缺字段即 undefined）。
   */
  const optionalService = (name: string): unknown => {
    const get = (ctx as { get?: (n: string, required?: boolean) => unknown }).get;
    if (typeof get === 'function') return get.call(ctx, name, false);
    return (ctx as unknown as Record<string, unknown>)[name];
  };

  /** 独立模式的碎碎念授权策略（可选能力）：DSH 宿主里是 undefined → 回落到只看 pet.whisperEnabled。 */
  const standaloneAiPolicy = (): StandaloneWhisperPolicy | undefined =>
    optionalService('standaloneAi') as StandaloneWhisperPolicy | undefined;

  // 用户主配置（可编辑层）与文件宠物目录；配置读取/合并统一走 readAllConfig（./config）。
  // 主配置是 **JSONC**（main-config.jsonc）——与包内默认 config.jsonc 同名同格式：
  // 「同步」写进去的就是带注释的原文，扩展名如实反映内容（旧版 main-config.json 只读回落 + 启动迁移）
  const userConfigPath = join(userRoot, 'main-config.jsonc');
  const legacyUserConfigPath = join(userRoot, 'main-config.json');
  const petConfigDir = join(userRoot, 'pet');
  // 配置路径集（readAllConfig 的唯一输入：内置默认 + 用户主配置 + 文件宠物目录）
  const configPaths: ConfigPaths = {
    defaultFile: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
    userFile: userConfigPath,
    legacyUserFile: legacyUserConfigPath,
    petDir: petConfigDir,
  };
  // 老用户一次性迁移：main-config.json → main-config.jsonc（重命名，内容一字不动；
  // 新文件已存在则不动旧文件）。失败不影响运行——读取侧对旧路径有回落。
  migrateUserConfig(configPaths, (msg) => log.info('[dsh-pet] ' + msg));

  // ---- 读屏与 AI 助手（2026-10-26 新增）----
  // 读屏：常驻一个 PowerShell UIA 子进程。**懒启动**——`screenContextEnabled` 为 false 时
  // 连进程都不 spawn（隐私 + 性能双重要求：不读屏时不该有任何后台进程在跑）。
  // 第二个参数是「脚本落盘目录」：生产环境本文件在 app.asar 内，PowerShell 打不开 asar 路径，
  // 必须先把 uia-reader.ps1 解到真实磁盘（见 screen-context.ts 的 materializeScript）。
  const screenReader = new ScreenReader(
    join(PACKAGE_ROOT, 'runtime', 'electron-helper', 'uia-reader.ps1'),
    join(userRoot, 'uia'),
  );
  // 助手工作区根：独立模式下 DSH_HOME=<安装目录>/data，上一级就是桌宠文件夹（符合「工作区只有桌宠文件夹」）。
  // 每只宠物在其下再分一个自己的干净目录（宠物工作区/<petId>/），互不覆盖。
  const assistantWorkspace = resolveWorkspaceRoot(dshHome);
  // 助手操作记录：JSONL 追加（一行一条），供设置页留痕。
  // 路径放在用户数据目录（不是工作区）：这是系统记录，不该让助手自己读写到。
  const assistantHistoryPaths = { file: join(userRoot, 'assistant-history.jsonl') };
  // 一次性授权表：审批通过后只对「同一个工具 + 同一个目标路径」放行，120 秒过期，用过即焚。
  const assistantGrants = new GrantStore();

  /**
   * 读当前生效的读屏 / 助手配置。
   *
   * 每次都现读 `readAllConfig`（配置随时可能被设置页改）：不做缓存，避免「改了开关要重启」。
   * 全部字段带安全缺省——配置缺失/非法时按**最保守**处理（读屏关、助手关、只读权限）。
   */
  const assistantConfigOf = (
    conf: Record<string, unknown>,
  ): {
    screenOn: boolean;
    excludes: string[];
    assistantOn: boolean;
    permission: AssistantPermission;
    network: boolean;
  } => ({
    screenOn: conf.screenContextEnabled === true,
    excludes: Array.isArray(conf.screenExcludePatterns)
      ? (conf.screenExcludePatterns as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    assistantOn: conf.assistantEnabled === true,
    // 非法值回落 readonly（默认最保守）：这是权限，宁可少给不能多给。
    permission: isAssistantPermission(conf.assistantPermission) ? conf.assistantPermission : 'readonly',
    network: conf.assistantNetworkEnabled !== false,
  });

  /**
   * 生成一段屏幕上下文（追加到 system 末尾）。
   *
   * 失败/关闭一律返回空串：**读不到屏幕绝不能拖死碎碎念与对话**——这是本功能的硬约束。
   */
  const screenSection = async (conf: Record<string, unknown>): Promise<string> => {
    const cfg = assistantConfigOf(conf);
    if (!cfg.screenOn) return '';
    try {
      const snap = await screenReader.capture(cfg.excludes);
      const section = screenContextOf(snap);
      // 诊断日志：没有它就无法区分「读屏关了」「读到了但被排除项拦了」「读到了但没注入」。
      // 只打长度与前 60 字（不打全文：屏幕内容可能含隐私，日志会留在盘上）。
      if (snap === undefined) {
        log.info('[dsh-pet] 读屏：本次未取到快照（窗口被排除项拦下 / 前台无焦点 / 读取失败）');
      } else {
        log.info(
          `[dsh-pet] 读屏：窗口「${snap.title.slice(0, 40)}」类=${snap.cls} ` +
            `${snap.pieces} 段/${snap.text.length} 字/耗时 ${snap.ms}ms` +
            (snap.truncated ? '（已截断）' : '') +
            ` → 注入 ${section.length} 字`,
        );
      }
      return section;
    } catch (e) {
      log.warn('[dsh-pet] 读屏失败（已跳过，不影响本次生成）：' + (e instanceof Error ? e.message : String(e)));
      return '';
    }
  };

  /**
   * 建（必要时）某宠物的干净工作区目录，返回其绝对路径。
   *
   * 位置：`<程序根>/宠物工作区/<petId>/`。**每次对话前都 ensure 一次**——
   * 用户手工删掉目录后助手不该报错，直接重建即可。
   * 创建失败（权限/磁盘）返回空串，调用方据此让助手明确失败，而不是拿一个不存在的路径瞎写。
   */
  const ensurePetWorkspace = async (petId: string): Promise<string> => {
    const dir = resolvePetWorkspace(assistantWorkspace, petId);
    try {
      await mkdir(dir, { recursive: true });
      return dir;
    } catch (e) {
      log.warn('[dsh-pet] 创建宠物工作区失败 pet=' + petId + '：' + (e instanceof Error ? e.message : String(e)));
      return '';
    }
  };

  /** 组装工具上下文（每只宠物自己的 workspace + 当前权限 + 共享授权表） */
  const toolContextOf = (petWorkspace: string, conf: Record<string, unknown>): ToolContext => {
    const cfg = assistantConfigOf(conf);
    return {
      workspaceRoot: petWorkspace,
      permission: cfg.permission,
      grants: assistantGrants,
      netTimeoutMs: 20_000,
      networkEnabled: cfg.network,
    };
  };

  /**
   * 待审批的越权动作。
   *
   * 语义：某次助手动作被权限挡下 → 记一条（含宠物、工具、目标、原始用户指令）→
   * 设置页拉到这条 → 用户点允许 → 按 `userText` **原样重放**那次对话（授权表已放行该动作）→ 删掉这条。
   * 只保留**最近 20 条**：老的不该无限堆积，超出的丢掉（用户没处理就是不想处理）。
   */
  interface PendingApproval {
    id: string;
    petId: string;
    tool: string;
    target: string;
    reason: 'readonly' | 'outside-workspace';
    message: string;
    /** 原始用户指令：允许后按这句重放 */
    userText: string;
    createdAt: number;
  }
  const pendingApprovals = new Map<string, PendingApproval>();
  /** 待审批上限：超出就丢掉最老的（用户没处理就是不想处理，不该无限堆积） */
  const MAX_PENDING_APPROVALS = 20;

  /** 记一条待审批；超过上限时淘汰最老的那条 */
  const pushPendingApproval = (item: PendingApproval): void => {
    pendingApprovals.set(item.id, item);
    while (pendingApprovals.size > MAX_PENDING_APPROVALS) {
      const oldest = [...pendingApprovals.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      pendingApprovals.delete(oldest.id);
    }
  };

  /**
   * 助手循环用的 llm 缝隙。
   *
   * 独立模式下 `ctx.standaloneAi.toolTurn` 存在；DSH 宿主里没有这个能力 → 返回 undefined，
   * `runAssistant` 会明确报 provider-missing（不假装成功）。
   */
  const assistantLlm = ():
    | {
        toolTurn(input: {
          system: string;
          messages: unknown[];
          tools: unknown[];
          signal?: AbortSignal;
        }): Promise<
          | { ok: true; kind: 'text'; text: string }
          | { ok: true; kind: 'tools'; toolCalls: Array<{ id: string; name: string; arguments: string }>; text: string }
          | { ok: false; reason: string; message: string }
        >;
      }
    | undefined => {
    const svc = optionalService('standaloneAi') as
      | { toolTurn?: (input: unknown) => Promise<unknown> }
      | undefined;
    if (!svc || typeof svc.toolTurn !== 'function') return undefined;
    return {
      toolTurn: (input) =>
        svc.toolTurn!(input) as ReturnType<
          NonNullable<ReturnType<typeof assistantLlm>>['toolTurn']
        > extends never
          ? never
          : Promise<
              | { ok: true; kind: 'text'; text: string }
              | { ok: true; kind: 'tools'; toolCalls: Array<{ id: string; name: string; arguments: string }>; text: string }
              | { ok: false; reason: string; message: string }
            >,
    };
  };

  /**
   * 助手模式的补充 system 段：告诉模型工作区在哪、当前权限是什么、能做什么。
   *
   * 为什么必须显式告知权限：模型不知道「我现在只读」，就会反复尝试写文件、
   * 每次都撞权限墙，然后给用户一句「我做不了」——而正确行为是**先说清楚需要提权**。
   */
  const assistantSystemHint = (workspace: string, permission: AssistantPermission, network: boolean): string => {
    const permText =
      permission === 'readonly'
        ? '【当前权限：只读】你不能写或删除任何文件，只能读工作区内的文件并联网查资料。'
        : permission === 'workspace'
          ? '【当前权限：工作区内修改】你可以读写工作区里的文件；工作区之外的路径会被拦下。'
          : '【当前权限：完全权限】你可以读写任意路径。请格外谨慎，删除或覆盖前先确认目标。';
    return (
      '【你可以动手做事】' +
      '你的工作区目录是：' +
      workspace +
      '（相对路径按这个目录解析）。' +
      permText +
      (network
        ? '你可以联网（web_search 搜索、fetch_url 抓网页）。'
        : '【联网已关闭】你不能搜索或抓网页；需要资料时告诉用户去设置页打开联网。') +
      '\n做事的原则：' +
      '① 先想清楚要做几步，再一步步调用工具；能一次读完的就别反复读。' +
      '② 工具失败时看错误信息再调整，不要重复同一个失败动作。' +
      // 这一条是 2026-10-26 实机验收后补的：模型原本遇到「可能要越权」就自己先拒绝，
      // 从不真正调用工具，于是权限层和审批 UI 全成了摆设——用户永远看不到「它想做什么」。
      // 正确行为是**照做、让权限层去拦**，拦住之后由用户决定放不放。
      '③ 用户要求的目标如果可能超出工作区或当前权限，**照样发起工具调用**——' +
      '权限层会拦下并让用户决定是否放行。**不要自己预先拒绝**，那样用户连「你想做什么」都不知道。' +
      '只有在你确实没有对应工具时才说不做。' +
      '④ **不要把你正在做什么、调用了什么工具说出来**——那些是你的内部动作，用户不需要看。' +
      '⑤ 全部做完后，用符合你人设的口吻说**一到两句**话，告诉用户结果就行了。' +
      '不要罗列步骤、不要写「已完成以下操作」这种报告腔。' +
      '⑥ 如果什么都没做成（被拦下 / 工具失败），就说清一件事：为什么没做成、需要用户做什么。'
    );
  };

  // 用户动画目录（thumb 播放时优先于包内素材；webm 放 main-animation/webm/，mov（macOS 定制）放 main-animation/mov/）
  const thumbUserRoot = join(userRoot, 'main-animation');
  // 用户表情包目录（碎碎念/对话配图的图片：优先于包内 assets/memes，加图不必改包）
  const memesUserRoot = join(userRoot, 'memes');
  /**
   * 表情包目录链 —— 与动画素材（/thumb）**同一套素材归属语义**：
   *   - `pet/<素材根>-memes/` 存在（种类自带表情包）：**只查它**，池与路由都不回落——
   *     查不到即 404 / 该条目剔除（与 `pet/<素材根>-animation/` 的独占规则逐字一致）；
   *   - 否则：用户目录 `$DSH_HOME/dsh-pet/memes/` 优先，其次包内 `assets/memes/`（逐文件合并，
   *     与「main-animation/<ext> → 包内 assets/<ext>」的主素材链同构）。
   * 池（readMemePool）与路由（/pic/memes）必须走**同一个函数**：池里能选的名字，
   * 路由必须取得到，否则气泡配图会图裂。
   * 素材根一律先过 resolveAsset：它来自 URL 段，Windows 上 %5C 解出的反斜杠不会被
   * rest.split('/') 切开，直接 join 会让 `..\..\x` 逃出用户根读盘（与 /thumb 同一道防线）。
   */
  const memeDirsFor = (assetRoot: string): string[] => {
    const own = resolveAsset(petConfigDir, assetRoot + '-memes');
    if (own !== undefined && existsSync(own)) return [own];
    return [memesUserRoot, PACKAGE_MEMES_DIR];
  };
  // 轮询统一状态（S）：前端 1s 轮询的**唯一**数据源（余额 / 工作状态 / 通知 / 宠物说话）。
  // 所有写入走 state.writeSection / writePet（由它统一更新 counter），见 ./state 的说明。
  const state = new PollStateStore();
  // 第三方右键菜单注册表（issue：第三方菜单项）：**进程内存态**，不落盘，重启即空。
  // 与 S 的关系：注册表本身写进 S 的 sections.menu（两端据此拼「更多」）；点击事件**不进 S**——
  // 它是触发不是状态，走 /menu/events 的读取即消费，只给注册它的那个 owner 看。见 ./menu 的说明。
  const menuRegistry = new MenuRegistry();
  // 对外 Cordis 服务（宿主半侧）：与页面侧的 petApi7340 同名，但分属两个容器，互不可见也互不覆盖。
  // 只暴露 register（返回注销函数，配合 ctx.effect 在卸载时自动清理）与 list（排障用）；
  // 不暴露 unregister：注销走返回值，避免任何插件都能注销别人的 provider。
  ctx.provide('petApi7340', {
    balance: {
      register: registerBalanceProvider,
      list: listBalanceProviders,
    },
  });
  // 播放记录表（issue #122 第 3 项「播放与完成回执」）：**由渲染端上报驱动**的状态机 + 等待者。
  // 与 S 无关：播放记录是 per-caller 资源（只有发起那次点播的调用方关心、有生命周期、数量随
  // 第三方调用方增长），塞进 1s 全局广播会让每个窗口为每个功能付流量。见 ./playback 的说明。
  const playback = new PlaybackStore();
  // 工作状态联动快照（/work-status 端点响应，浏览器 1s 轮询）：state=当前活动状态（null=空闲）、
  // task=当前任务详情、ts=最近变化时间（轮询侧检测变化用）。气泡文案不在此：浏览器读配置
  // events.workStatusTexts（host 不内置文案）。
  // 聚合与展示选择都在 WorkStatusStore（host/work-status.ts，纯逻辑可单测）：**state 与 task 都按
  // 会话存**——task 曾是全局单值，写过一次就跟着此后所有会话活动一直显示（issue #59）。
  // 进程内内存态：重启回空闲；每次会话事件有实际状态变化才更新（签名比对防刷屏）。
  const workStatus = new WorkStatusStore();
  /** 外部写入槽：固定会话 id，最后写入者生效；不做多写者仲裁/租约/会话管理 */
  const EXTERNAL_WORK_SESSION = 'api';
  let externalWorkSeq = 0;
  // 工作状态快照 → 写进 S（前端 1s 轮询 /state 后按 counter 变化渲染）。
  // **只在内容真的变了时才写**：每次写都会推进 counter，前端据此重播档位动画——
  // 会话事件很密（每个 tool/call 都来），无条件写会把动画刷成幻灯片。
  // 判据用**内容**（state + task）而不是 store 的 ts：ts 是 Date.now()（毫秒分辨率），
  // 同一毫秒内连改两次会被误判成"没变化"而漏写（测试里连发事件就会踩到）。
  // data 里不再带 ts：「变了没有」已由叶子 counter 承担，少一个会漂移的第二信号。
  //
  // **忙碌档抖动抑制（滞回）**：工具秒回时 `tool/call` 报 working、`tool/result` 报 result，
  // 一次回复里能来回切十几次；每切一次前端就把 10s 的片段从第 0 帧重播，观感即"一秒一刀"
  // （实测 6 次快工具调用 → 13 次换片，working 每次只活 1~2 秒）。
  // 判据**只看档位与时间**，而且**只压一个方向**：距上次写入不足 WORK_STATE_GAP_MS 的
  // `working → result` **整条不写**（档位与文案一起压住），挂一个 trailing 定时器到点重新
  // 取快照补写，所以最终状态一定落地，只是最多晚 GAP。
  // 反向 `result → working` **不压**：它意味着新一轮工具已经开工，晚 GAP 秒才显示"又开始干活"
  // 比多换一次片更糟——取舍是宁可多切一刀，也不让开工迟到。
  // 不把「文案没变」当条件：现在每个 tool/call 都会换文案，那个条件会恒为假、一次都压不住；
  // 文案随这次写入一起被压住，是这条规则的必然结果（不是遗漏）。
  //
  // 刻意**不压**的对象（"写完立刻可见"是既有契约，动它会把一串宿主回归测试打翻）：
  //   - 回空闲 / 终态（success、error）：反馈不能迟到；
  //   - 任何进/出忙碌档以外的变化（thinking、waiting、…）；
  //   - **同档位内**的文案更新（working 期间换一句工具详情）：那不是档位切换，不参与节流。
  // 为什么压在这里而不是两个前端：网页 overlay 与桌面 helper 消费的是同一个叶子，
  // 一处压住两端同时生效，也不必在前端各维护一份状态机。
  const WORK_STATE_GAP_MS = 5000;
  let publishedWork = '\u0000';
  let publishedState: string | null = null;
  let publishedWorkAt = 0;
  let workFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const publishWorkStatus = (): void => {
    const snap = workStatus.snapshot();
    const key = String(snap.state) + '\u0000' + String(snap.task);
    if (key === publishedWork) return;
    // 抖动判定：**只压 working → result 这一个方向**（同档只换文案不算抖动，照常立即写；
    // 反向 result → working 立即写，取舍见上面的注释）
    const busyFlip = publishedState === 'working' && snap.state === 'result';
    const wait = WORK_STATE_GAP_MS - (Date.now() - publishedWorkAt);
    if (busyFlip && wait > 0) {
      // 整条不写（档位与文案一起压住）：到点再取**最新**快照补写
      // （不要在这里缓存 snap——期间可能又变了）
      workFlushTimer ??= setTimeout(() => {
        workFlushTimer = null;
        publishWorkStatus();
      }, wait);
      return;
    }
    if (workFlushTimer !== null) {
      clearTimeout(workFlushTimer);
      workFlushTimer = null;
    }
    publishedWork = key;
    publishedState = snap.state;
    publishedWorkAt = Date.now();
    state.writeSection('workStatus', { state: snap.state, task: snap.task });
  };
  /** Electron 下载日志的收尾槽位保留时长（ms）：够看清「就绪 / 失败」，又不让这条日志一直盖住
   *  随后真实的工作状态（终态档在渲染端本来也会 10s 自动收起气泡）。 */
  const DOWNLOAD_SLOT_CLEAR_MS = 12 * 1000;
  let downloadSlotTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 写一条 Electron 下载日志进工作状态（前端当普通工作状态消费，**不改 /state 的 JSON 形状**）：
   * 桌面版用户没有控制台，这是他们唯一能看到「后台在下什么」的地方。
   *
   * 借外部写入槽 `api`（与 `POST /work-status` 同一个槽位）：不新增 section、不新增槽位常量。
   * 三个必须照做的细节：
   *   1. **先 setState 再 setTask**——`setTask` 在条目不存在时直接返回 false，文本会被吞掉；
   *   2. `seq` 必须递增——`setState` 在「同档位且 seq 不更新」时短路，而下载大部分时间都停在
   *      `working` 一档，不推进 seq 就什么都不会发生；
   *   3. 文案按 TASK_TEXT_MAX 截断（与 currentTaskFromTodo 同口径），否则气泡会被撑爆。
   * `terminal` = 这次是收尾（就绪 / 失败）：留一小会儿再清槽，让用户看得见。
   */
  const reportDownload = (text: string, state: HostWorkStatusState, terminal = false): void => {
    const points = Array.from(text);
    const task = points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : text;
    externalWorkSeq += 1;
    workStatus.setState(EXTERNAL_WORK_SESSION, state, externalWorkSeq);
    workStatus.setTask(EXTERNAL_WORK_SESSION, task);
    publishWorkStatus();
    if (!terminal) return;
    if (downloadSlotTimer !== null) clearTimeout(downloadSlotTimer);
    downloadSlotTimer = setTimeout(() => {
      downloadSlotTimer = null;
      if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
    }, DOWNLOAD_SLOT_CLEAR_MS);
    downloadSlotTimer.unref?.(); // 别把这个定时器钉进宿主的事件循环（退出时不该等它）
  };
  // 占用锁（issue #122 第 4 项「独立动作/气泡占用」）：**内存态**一把锁 + TTL，第三方联动期间
  // 独占这只宠物——除持锁者外谁都动不了它（随机链、碎碎念、余额、工作状态一概让路）。
  //
  // 它自己**不带定时器**：过期是懒判的，叶子里的 `expiresAt` 是唯一真相，渲染端据此**自己**
  // 解除静止；这里只负责把状态变化同步进 S 的 `pets.<id>.lock`。见 ./lock 的四条边界
  // （无锁 = 现状零变化 / 有界 / 续期即心跳 / 无定时器）。
  const lock = new LockStore({
    onChange: (petId, data) => state.writePet(petId, 'lock', data),
  });

  // 实况快照（issue #122 第 1 条）：桌面渲染端变化时上报，第三方用 GET /pose 读。
  // 网页端不走这里——它的位置**天生每个页面一份**，走页面内的 Cordis 服务 `petApi7340`。
  const pose = new PoseStore();

  /**
   * `?surface=` 的**参数级**校验（缺省 / 非法 → `bad-request`）。放在读盘之前：必然失败的请求
   * 不碰磁盘（与 pet 空串同一处境）。通过则给出收窄后的取值。
   */
  const surfaceParam = (params: URLSearchParams): { ok: true; want: Surface } | { ok: false; res: RouteResult } => {
    const want = normalizeSurface(params.get('surface'));
    if (want !== null) return { ok: true, want };
    return {
      ok: false,
      res: { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: SURFACE_TEXT } },
    };
  };

  /**
   * `?surface=` 与该宠物 `display` 的对齐校验（issue #122 第 1 条）：不满足 → `pet-not-displayed`
   * + **实际 display 原样回给调用方**（调用方据此一眼知道该怎么办），放行回 null。
   *
   * 这是**前置校验**，不是按面分发——指令照旧写进同一个叶子、两端内容照旧完全一致
   * （要"网页播 A、桌面播 B"用两只宠物表达，见 ./surface 的第 1 条边界）。
   */
  const surfaceMismatch = (pet: Record<string, unknown>, petId: string, want: Surface): RouteResult | null => {
    const display = String(pet.display ?? '');
    if (displayCovers(want, display)) return null;
    return {
      kind: 'json',
      status: 200,
      obj: {
        ok: false,
        reason: 'pet-not-displayed',
        message: petId + ' 的显示模式是 ' + display + '，不满足 surface=' + want,
        display,
      },
    };
  };

  /**
   * 决策函数**之后**的 surface 校验（`/anim`、`/broadcast`、`/bubble/clear`、`/position`、
   * `/throw` 共用）：这五条的 pet 解析住在各自的决策模块里，所以这里按 `petId` 再查一次实例取
   * `display`（配置已在手，成本可忽略）。放行回 null。
   *
   * 位置与 `lockBlocked` 一致——都在决策函数之后、任何副作用之前，所以校验顺序是
   * 「body → pet → surface → 锁」。
   */
  const surfaceBlocked = (
    cfg: Record<string, Record<string, unknown>>,
    petId: string,
    params: URLSearchParams,
  ): RouteResult | null => {
    const p = surfaceParam(params);
    if (!p.ok) return p.res;
    return surfaceMismatch(findPetInstance(cfg, petId)?.pet ?? {}, petId, p.want);
  };

  /**
   * 路由层的 pet 参数解析（`/lock`、`/lock/release`、`/whisper`、`/chat` 用——这四条没有独立决策层；
   * `/anim`、`/broadcast`、`/bubble/clear`、`/position`、`/throw` 的同一套校验住在各自的决策模块里，
   * 口径与这里逐字一致）：**必填**且必须真实存在。
   *
   * 两种失败分开报（issue #122 第 1 条「绝不默认退到列表第一只」）：
   * 没给 / 空串 → `pet-required`；给了但配置里没有 → `unknown-pet`。
   *
   * 收紧前这四条是 `get('pet') || resolveActivePetId() || 'main'`：缺省会落到"当前桌宠"
   * = **有效宠物列表第一只**（`/whisper`、`/chat` 更彻底——`?? ''` 直接空串：人设按 main 条目取、
   * 生成结果写进没人消费的 `pets[""].say`，还回 ok:true——钱花了、话丢了、调用方以为成功）。
   * 落点随用户 /pet 操作而变、失败也不报，第三方无从预期，故整条缺省链已删除：
   * pet 与 `/pet-display` 的 `id` 一样是必填项。
   *
   * `cfg` 传**惰性读取**：pet 空串时不必碰磁盘（与 /broadcast 的 text/duration 同一处境，
   * routes.test.ts 里"配置不可达"那一组断言正是靠这个顺序钉住的）。
   *
   * `opts.surface` = 是否同时校验 `?surface=`。**只对会产生渲染端可见效果的端点开**：
   * `/lock`、`/whisper`、`/chat` 的 POST。`/lock/release` 与 `/chat` 的 GET 不开——
   * 释放必须永远能成功（否则宠物中途被隐藏就撤不掉锁），读记忆与显示在哪一端无关。
   */
  const requirePet = (
    params: URLSearchParams,
    cfg: () => Record<string, Record<string, unknown>>,
    opts?: { surface?: boolean },
  ):
    | { ok: true; petId: string; entry: string; conf: Record<string, unknown>; pet: Record<string, unknown> }
    | { ok: false; res: RouteResult } => {
    const fail = (reason: 'pet-required' | 'unknown-pet', message: string): { ok: false; res: RouteResult } => ({
      ok: false,
      res: { kind: 'json', status: 200, obj: { ok: false, reason, message } },
    });
    const petId = String(params.get('pet') ?? '').trim();
    if (!petId) return fail('pet-required', 'pet 必填：要指定操作哪只桌宠');
    // surface 分两步：参数级校验在读盘之前（必然失败的请求不碰磁盘），显示模式校验在找到宠物之后。
    let want: Surface | null = null;
    if (opts?.surface === true) {
      const p = surfaceParam(params);
      if (!p.ok) return { ok: false, res: p.res };
      want = p.want;
    }
    // 一次查找同时给出"存在性"与"所属条目"（entry 即素材根，/chat 读记忆分桶要用）+ 条目配置
    // （/chat 取 chatMemoryRounds 要用）——调用方拿到的就是校验时那份快照里的值，不必再查一次。
    const found = findPetInstance(cfg(), petId);
    if (!found) return fail('unknown-pet', '没有这只桌宠：' + petId);
    if (want !== null) {
      const mismatch = surfaceMismatch(found.pet, petId, want);
      if (mismatch) return { ok: false, res: mismatch };
    }
    return { ok: true, petId, entry: found.entry, conf: found.conf, pet: found.pet };
  };

  /**
   * 动作端点的占用门禁（`/anim`、`/broadcast`、`/position`、`/throw`、`/bubble/clear` 共用）：
   * 放行回 null，否则直接给出路由应答。抽成一个函数，是为了让"哪些接口受占用约束"只有一处可查。
   *
   * **无锁时按「有没有带 `lock`」分流**：没带 → 返回 null（既有调用方一个字都不用改）；
   * 带了但查不到锁 → `lock-lost`，旧租约不能继续执行迟到请求。
   * 没带这一支就是「不传 lock = 现状零变化」（issue #122 最重要的边界）的落点。
   *
   * 位置放在决策函数**之后**：`petId` 要先解析出来才知道问哪只宠物的锁，而这时还没有任何副作用
   * （没写叶子、没建播放记录、没调模型）。所以"先判锁再干活"这个意图是满足的，只是与
   * body 校验的先后为「body → pet → 锁」——两者都不合法时报的是 body 的错。
   */
  const lockBlocked = (petId: string, params: URLSearchParams): RouteResult | null => {
    const g = lock.gate(petId, String(params.get('lock') ?? ''));
    if (g.ok) return null;
    return {
      kind: 'json',
      status: 200,
      obj:
        g.reason === 'lock-lost'
          ? { ok: false, reason: g.reason, cause: g.cause, message: g.message }
          : { ok: false, reason: g.reason, message: g.message },
    };
  };
  // 系统通知帧：host 监听 DSH 宿主事件生成通知帧（帧契约与 shared/notify.ts 一致），写进 S 的
  // sections.notify，浏览器 1s 轮询 /state 后弹 toast。
  // 背景：DSH 0.1.5 删除浏览器侧 api.events.mux/host 事件流，改为 host 转发通道——
  // 不依赖 DSH 版本间变化的事件 API。
  // **单槽**（后到覆盖先到）：同一秒来多条只弹最后一条。这是有意的取舍——1 秒内连弹多个系统通知
  // 本身没有意义（反而更烦），所以不再带 seq / 增量帧队列（改造前的 frames 数组机制已删）。
  const pushNotifyFrame = (frame: HostNotifyFrame): void => {
    state.writeSection('notify', frame);
  }; /** 每会话 turn 级标志（goal 续跑轮判定；不参与展示，仅修正 turn/end 终局语义） */
  const turnFlags = new Map<string, WorkStatusTurnContext>();
  /** 终态（success/error）展示窗口定时器：约 60s 后清掉该会话条目，陈旧完成态不再浮上来（Bug 2/3） */
  const terminalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const TERMINAL_KEEP_MS = 60 * 1000;
  /**
   * 每会话最近一条 todo 文案（就是 issue #59 那份）：工具跑完要把气泡「还」给它。
   * 没有这份缓存，`tool/result` 写 null 就只能回落到通用档位文案（「这一步处理好啦」），
   * 用户刚看到的清单进度会被抹掉。
   */
  const lastTodoText = new Map<string, string | null>();
  /**
   * 每会话「正在跑、且气泡上有具体描述」的工具数（不是布尔）：并行工具调用时，先返回的那个
   * 不该把仍在中途的另一个的具体描述顶掉——归零才恢复 todo 文案。
   * 只统计**拿到了目标**的调用（`toolDetailFromEvent` 返回非 null）：没写出描述就不该占位，
   * 否则一次没带参数的 `read` 会平白挡住 todo 文案。
   */
  const toolsInFlight = new Map<string, number>();
  const bumpToolsInFlight = (sessionId: string, delta: number): void => {
    const next = (toolsInFlight.get(sessionId) ?? 0) + delta;
    if (next > 0) toolsInFlight.set(sessionId, next);
    else toolsInFlight.delete(sessionId);
  };
  /** 取消某会话待执行的终态清理：会话已回到非终态，那次清理到点后既不清理也不重排，留着只会误导 */
  const cancelTerminalCleanup = (sessionId: string): void => {
    const t = terminalTimers.get(sessionId);
    if (t === undefined) return;
    clearTimeout(t);
    terminalTimers.delete(sessionId);
  };
  /** 排一个终态清理定时器（每会话一个，已排则跳过） */
  const scheduleTerminalCleanup = (sessionId: string): void => {
    if (terminalTimers.has(sessionId)) return;
    const t = setTimeout(() => {
      terminalTimers.delete(sessionId);
      const sessionState = workStatus.stateOf(sessionId);
      if (sessionState === 'success' || sessionState === 'error') {
        workStatus.clear(sessionId); // 条目连同它的任务详情文案一起消失，不残留到后续活动
        turnFlags.delete(sessionId);
        lastTodoText.delete(sessionId); // 会话都没了，这两份按会话记的缓存也一起清（防泄漏）
        toolsInFlight.delete(sessionId);
        publishWorkStatus(); // 清完要写 S：否则前端一直挂着那条陈旧完成态
      }
    }, TERMINAL_KEEP_MS);
    terminalTimers.set(sessionId, t);
  };
  // 通知活动门（issue #114）：「对话完成」不立刻弹，先挂起，到点确认这条会话确实没活了再弹
  // （在跑的下属子代理 / 团队成员、后台任务、活跃提醒任一非空 → 丢弃这一帧）。
  //
  // 为什么必须延迟而不是同步查：`workspace/session-activity` 的 turn 族读的是**活 Agent 的
  // status**，而 turn/end 是在回合体的 finally 里追加的——同步那一刻它自己还是 running，判据必然
  // 非空，照「任一非空就不弹」写会把每一条通知都吞掉（详见 notify-events.ts 的 hasBlockingActivity）。
  // 延迟同时让「成员刚变 idle、Lead 下一秒 send_message 又把它唤醒」的窗口过去（队友邮箱是入队后
  // 立刻投递、空闲目标会起一轮）。
  //
  // 判据不可用（宿主没组合 workspace、standalone 伪 ctx 没有 waterfall、调用抛错、返回值形状不对）
  // → 一律放行：宁可多弹一条，也不能让通知被一次宿主变更整体打哑。
  const NOTIFY_ACTIVITY_DELAY_MS = 1500;
  /** 每会话一个待查定时器（同会话连续收尾只保留最后一次：后到覆盖先到，与单槽帧同语义） */
  const notifyActivityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** waterfall 只用到签名本身：DSH 未导出该事件的请求/响应类型，这里宽松声明（与 ctx 同为 any 的现状一致） */
  type Waterfall = (name: string, request: unknown, next: () => Promise<unknown[]>) => Promise<unknown>;
  /** 这条会话是否还有在跑的活；判据不可用一律 false＝放行 */
  const sessionHasRunningWork = async (sessionId: string): Promise<boolean> => {
    const waterfall = (ctx as { waterfall?: Waterfall }).waterfall;
    if (typeof waterfall !== 'function') return false;
    try {
      const activity = await waterfall.call(ctx, 'workspace/session-activity', { sessionId }, () =>
        Promise.resolve([]),
      );
      return hasBlockingActivity(activity);
    } catch {
      return false; // 查询失败不阻塞通知（与「判据不可用时放行」同一策略）
    }
  };
  /** 排一个活动门定时器：到点确认空闲才推这一帧 */
  const scheduleCompletionNotify = (sessionId: string, event: unknown): void => {
    const prev = notifyActivityTimers.get(sessionId);
    if (prev !== undefined) clearTimeout(prev);
    notifyActivityTimers.set(
      sessionId,
      setTimeout(() => {
        notifyActivityTimers.delete(sessionId);
        void (async () => {
          if (await sessionHasRunningWork(sessionId)) return; // 还有活：等真正的收尾轮再弹
          const frame = reduceNotifyFrame(event as Parameters<typeof reduceNotifyFrame>[0]);
          // 这条延迟路径（活动门等 1.5s 确认没活了才推的「对话完成」）最常被点，同样要带会话 id
          if (frame) pushNotifyFrame(withSessionId(frame, sessionId));
        })();
      }, NOTIFY_ACTIVITY_DELAY_MS),
    );
  };
  // 命令「当前桌宠」（/pet 选择、/chat 使用）：全局单值不分会话；进程内内存，重启回默认第一只
  let activePetId = '';
  // 碎碎念周期调度的「上次生成时刻」（按宠物）：调度拍据此判断到没到点。
  // 改造前这份节流靠 whisperCache（缓存 + ts 比较），现在"该不该生成"由调度侧决定、
  // "生成结果"直接写 S——多端共享同一句由 S 天然保证，不再需要第二份缓存。
  const lastWhisperAt = new Map<string, number>();

  // 对话记忆文件（唯一读写方 = 本进程；浏览器/桌面两端都只是客户端 → 同一实例天然共享同一份记忆）。
  // 结构双层：{ <种类桶 assetRoot ?? petId>: { <实例 id>: { messages: ChatMemoryMessage[] } } }
  const memoryPath = join(userRoot, 'memory.json');
  // 对话写操作串行队列：read-modify-write 排队执行，防两端同时对话时交错写盘
  let chatQueue: Promise<void> = Promise.resolve();

  /** 读记忆文件：不存在 → 空；解析失败/根不是对象 → 记日志 + 空记忆（不备份、不改写源文件）
   *
   *  叶子形状见 ./memory-summary 的 `ChatMemoryEntry`：老文件只有 `messages`，缺 `summary` /
   *  `summarized` 即「尚未压缩」，**不需要迁移**——读取方一律按缺省值处理。 */
  const readMemory = async (): Promise<Record<string, Record<string, ChatMemoryEntry>>> => {
    let raw: string;
    try {
      raw = await readFile(memoryPath, 'utf8');
    } catch {
      return {}; // 文件不存在 = 尚无记忆
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, Record<string, ChatMemoryEntry>>;
    } catch (e) {
      log.error(
        `dsh-pet: 记忆文件无法解析（对话将从头开始）：${memoryPath}（${e instanceof Error ? e.message : String(e)}）`,
      );
      return {};
    }
  };

  const writeMemory = async (mem: Record<string, Record<string, ChatMemoryEntry>>): Promise<void> => {
    await mkdir(userRoot, { recursive: true });
    await writeFile(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
  };

  /** 把一次读写封进串行队列（同进程内防交错），返回 fn 的结果 */
  const withMemoryLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chatQueue.then(fn, fn);
    chatQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  // ---- 配置消费：唯一入口 readAllConfig（./config）——返回值绝对正确，这里只读字段，零校验 ----

  /** 某宠物的最终人设 system：**实例级** `pets[].whisperPrompt` 优先，没写回落到所属条目
   *  （写在该条目 `pets` 里的实例 → 那个条目；主配置的实例 → `main`）的 whisperPrompt（合并器已填默认）。
   *  拼装本身在 ./persona（纯函数、有单测）：人设正文 + 一句名字声明（name，缺失已按 id）+ 一行时间背景
   *  （日期/星期/时刻/时段/工作日或周末/节日）——碎碎念与对话共用同一份拼装。
   *  时间每次现算（这里传 new Date()），所以拿到的永远是**当前**时刻，不需要额外的刷新机制。
   *
   *  收 `findPetInstance` 的**命中结果**而不是 `(petId, cfg)`：两个调用方都已经解析过了，这里再查一次
   *  只会多出一处"查不到就兜底 main"的不可达分支。 */
  const petSystemPrompt = (found: { conf: Record<string, unknown>; pet: Record<string, unknown> }): string =>
    composeSystemPrompt({
      prompt: petPersona(found.conf, found.pet),
      name: String(found.pet.name ?? ''),
      id: String(found.pet.id ?? ''),
      now: new Date(),
    });

  /** 对话记忆轮数（1 轮 = 1 问 1 答）：该宠物**所属条目**的 chatMemoryRounds（合并器已填默认非负数字）。
   *  同样收**已解析的条目配置**：两个调用方都已经拿到 `findPetInstance` 的结果。 */
  const memoryRounds = (conf: Record<string, unknown>): number => {
    const v = Number(conf.chatMemoryRounds);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 5;
  };

  /** 生成/返回某宠物的一句碎碎念（周期 GET 与菜单手动触发共用的同一逻辑）：
   *  每只宠物独立生成（人设 = 它自己的 whisperPrompt，没写回落到所属条目）。生成成功就写进 S 的 pets.<id>.say——
   *  碎碎念 / 命令气泡 / 对话回复在前端本来就是**同一条展示链路**（同一个 triggerWhisper、
   *  同一个气泡槽、同一批 events.whisper 动画），所以合并成同一个叶子；"周期内不重复"由
   *  调度侧的 lastWhisperAt 保证，不再需要一份 whisperCache（多端共享也由 S 天然保证）。
   *  配图（whisperImageEnabled 开启时）：从表情包池**随机抽 1 张**，把描述注入指令并随文本一起写。
   *
   *  失败**带回真实 reason**（含 `unknown-pet`：目标宠物在"校验那次读"与这里之间被删掉了）。
   *  成功**带回生成的文本**（与同时写进叶子的那份完全相同）——调用方拿到就不必再拉一拍 /state。 */
  const publishWhisper = async (
    petId: string,
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet'; message?: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    // 宠物在"校验那次读"（requirePet / resolveActivePetId / 周期调度各自读的那一份）与这里之间被删了
    // ——配置随时可能被设置页 / 右键菜单 / 手改文件改动，两次读之间就是窗口。
    // **明确失败：不生成、不写 S**。写下去就是一只已不存在宠物的幽灵叶子（/state 里常驻到进程重启）。
    if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
    // 读屏上下文（2026-10-26）：开关打开时抓一次前台窗口，把「用户在干什么」追加到 system 末尾。
    // 失败返回空串 -> system 与原来逐字一致，绝不因读屏失败而改变碎碎念行为。
    const screen = await screenSection(found.conf);
    const system = screen === '' ? petSystemPrompt(found) : petSystemPrompt(found) + '\n' + screen;
    // 配图：全局开关关闭 / 池为空 / 池内图片全缺失 → 纯文本（不报错，退化为原行为）
    const meme =
      found.conf.whisperImageEnabled === true
        ? pickMeme(readMemePool(found.conf.memes, memeDirsFor(found.entry)))
        : undefined;
    // 模型：条目配置的 whisperModel 优先（留空 = 不指定）；生成侧失败会回落到当前对话的模型重试一次
    const result = await generateWhisper(ctx, system, meme, configuredModel(found.conf, 'whisperModel'));
    if (!result.ok) {
      // 失败**不写 S**（与改造前一致：静默跳过 + console.warn，不伪造文案、不弹错误气泡）
      log.warn(
        '[dsh-pet] 碎碎念生成失败 pet=' +
          petId +
          ' reason=' +
          result.reason +
          (result.message ? ' ' + result.message : ''),
      );
      // 真实 reason **原样带回**给调用方。改造前这里只回布尔值，路由只能把失败硬编码成
      // `generate-error`——独立模式下 `generateWhisper` 明明算出了 `provider-missing`，
      // 却在边界被吞掉（API.md 描述的降级 reason 正是它）。
      return result;
    }
    state.writePet(petId, 'say', result.image ? { text: result.text, image: result.image } : { text: result.text });
    // 成功也留一行（此前只有失败有日志）：调度拍了、生成也回来了，但「成功」在文件里毫无痕迹，
    // 于是「没触发」与「触发了并且成功」无法区分。
    log.info(
      `[dsh-pet] 碎碎念生成成功 pet=${petId}，${result.text.length} 字` +
        (result.image ? `，配图=${result.image}` : ''),
    );
    // 文本随返回值带出，且与刚写进叶子的**是同一个变量**：两条出口给同一份文本，不是一个真相两个版本
    return { ok: true, text: result.text, ...(result.image ? { image: result.image } : {}) };
  };

  /** 取（必要时创建）某宠物在记忆文件里的叶子，并把坏结构就地修好。
   *
   *  抽成函数是因为它现在有**三个**调用方（chatWithPet / GET /chat / POST /chat/compress），
   *  三处各写一遍「bucket 不存在就建、messages 不是数组就重建」必然漂移——尤其那句 error 日志
   *  重复三份之后，改措辞就得记得改三处。
   *
   *  坏结构（数组/标量）按空桶重建；`messages` 不是数组的条目按新会话处理，避免 push 到坏对象上崩溃。 */
  const memoryEntryOf = (
    mem: Record<string, Record<string, ChatMemoryEntry>>,
    entryKey: string,
    petId: string,
  ): ChatMemoryEntry => {
    const bucket =
      mem[entryKey] && typeof mem[entryKey] === 'object' && !Array.isArray(mem[entryKey])
        ? mem[entryKey]
        : (mem[entryKey] = {});
    const existing = bucket[petId];
    if (existing !== undefined && (!existing || !Array.isArray(existing.messages))) {
      log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按新会话处理：${memoryPath}`);
    }
    return existing && Array.isArray(existing.messages) ? existing : (bucket[petId] = { messages: [] });
  };

  /** 执行一次记忆压缩（**调用方必须已在 withMemoryLock 内**）。
   *
   *  流程：判定要不要压 → 调模型摘要（把旧摘要一起喂进去合并）→ 写回 `summary`/`summarized`/`summaryTs`。
   *
   *  为什么失败时**不写**任何东西：摘要生成失败（无模型 / 超时 / 空流）时若把 `summarized` 往前推，
   *  被跳过的那些消息就永久从上下文里消失、却没有摘要承载它们——那是**静默丢记忆**，比不压缩糟得多。
   *  所以失败一律原样返回，`summarized` 不动，下轮对话再试。
   *
   *  @param opts.force 手动压缩：忽略开关与触发线
   *  @returns 成功带回压缩后的记忆概览；失败带回原因（调用方决定怎么报给用户） */
  const compressMemory = async (
    mem: Record<string, Record<string, ChatMemoryEntry>>,
    entry: ChatMemoryEntry,
    conf: Record<string, unknown>,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: true; overview: MemoryOverview } | { ok: false; reason: string }> => {
    const policy = compressPolicyOf(conf);
    const plan = planCompression(entry, policy, opts);
    if (!plan) {
      // 手动压缩也可能落到这里（没有新内容可压）：这不是错误，如实回执即可
      return { ok: false, reason: 'nothing-to-compress' };
    }
    const chunk = entry.messages.slice(plan.from, plan.to);
    const userText = buildSummaryUserText(entry.summary ?? '', chunk);
    const result = await generateMemorySummary(
      ctx,
      SUMMARY_SYSTEM_PROMPT,
      userText,
      configuredModel(conf, 'chatModel'),
    );
    if (!result.ok) {
      log.warn(
        '[dsh-pet] 记忆压缩失败 reason=' + result.reason + (result.message ? ' ' + result.message : ''),
      );
      return { ok: false, reason: result.reason };
    }
    const summary = normalizeSummary(result.text);
    if (!summary) {
      // 模型返回了纯空白/只有围栏 → 归一后为空。同样不能推进 summarized（见上面注释）
      log.warn('[dsh-pet] 记忆压缩失败：摘要归一后为空，不推进游标');
      return { ok: false, reason: 'empty-summary' };
    }
    entry.summary = summary;
    entry.summarized = plan.nextSummarized;
    entry.summaryTs = Date.now();
    await writeMemory(mem);
    log.info(
      `[dsh-pet] 记忆压缩完成：${plan.to - plan.from} 条 → ${summary.length} 字摘要（已摘要 ${plan.nextSummarized}/${entry.messages.length} 条）`,
    );
    return { ok: true, overview: overviewOf(entry) };
  };

  /** 与某只宠物对话：截取最近记忆 → 生成回复 → 写入记忆 → 把回复写进 S 的 pets.<id>.say。
   *  配图（chatImageEnabled 开启时）：把表情包清单交给模型按语境选一张，命中池内才随回复写回。
   *  成功**带回回复文本**（与同时写进叶子的那份完全相同）——调用方拿到就不必再拉一拍 /state。 */
  const chatWithPet = async (
    petId: string,
    text: string,
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet'; message?: string }
  > =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      // 宠物在"校验那次读"与这里之间被删了——本函数还要先排 withMemoryLock 的串行队列（等前一次生成
      // 跑完，窗口可能是**秒级**），所以这一支是真会命中的。
      // **明确失败：不生成、不写记忆也不写叶子**。否则会在 memory.json 里**永久**留下一个已删宠物的
      // 分桶，外加一只幽灵叶子（/state 里常驻到进程重启）。
      if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
      const rounds = memoryRounds(found.conf);
      // 记忆**先读**：system 要拼「长期记忆」段（摘要常驻提示词），所以读盘必须排在拼装之前。
      const mem = await readMemory();
      const entry = memoryEntryOf(mem, found.entry, petId);
      // 人设：实例级 whisperPrompt 优先，没写回落所属条目（与碎碎念同一拼装）。
      // 末尾追加长期记忆段——`memorySection` 在摘要为空时返回空串，拼出来的 system 与改造前**逐字一致**，
      // 所以没压缩过的宠物行为不变。
      const system = petSystemPrompt(found) + memorySection(entry.summary ?? '');
      // 配图：开关关闭 → 空池（指令与解析都不介入，与旧行为逐字一致）；目录链按所属条目取。
      // 张数上限（chatImageLimit，0 = 不限制）：整张清单每条消息都要附，截断后费用上限可控。
      const pool =
        found.conf.chatImageEnabled === true
          ? limitPool(readMemePool(found.conf.memes, memeDirsFor(found.entry)), Number(found.conf.chatImageLimit))
          : [];
      // rounds = 0（用户关掉历史）→ 空历史；否则截尾部 rounds 轮（1 轮 = 1 问 1 答）。
      // 不能写 slice(-rounds * 2)：-0 在 JS 里 === 0，slice(-0) 返回整个数组而不是空。
      // 已摘要的那部分**本来就不该进上下文**（它们的内容已由摘要承载），从 summarized 之后开始截。
      const live = entry.messages.slice(summarizedOf(entry));
      const list = sliceMemoryRounds(live, rounds);
      const acfg = assistantConfigOf(found.conf);

      // ---- 助手模式（2026-10-26）：assistantEnabled 打开时，对话改走「多步工具循环」 ----
      // 与普通对话的关系：**同一个人设、同一份记忆**，区别只在于模型可以真的动手，
      // 且思考过程不弹给用户（只进日志），用户看到的还是最后那句带人设的回复。
      if (acfg.assistantOn) {
        const petWorkspace = await ensurePetWorkspace(petId);
        if (petWorkspace === '') {
          return { ok: false, reason: 'generate-error', message: '无法创建宠物工作区目录，助手暂时不可用。' };
        }
        // 屏幕上下文在这里也拼一次（助手同样要知道用户在干什么）
        const screen = await screenSection(found.conf);
        const assistantSystem =
          (screen === '' ? system : system + '\n' + screen) +
          '\n' +
          assistantSystemHint(petWorkspace, acfg.permission, acfg.network);
        const runStart = Date.now();
        const outcome = await runAssistant({
          llm: assistantLlm(),
          system: assistantSystem,
          history: list.map((m) => ({ role: m.role, content: m.content })),
          userText: text,
          toolCtx: toolContextOf(petWorkspace, found.conf),
          log: (level, message) => (level === 'warn' ? log.warn(message) : log.info(message)),
        });
        // 留痕（无论成功/被拦/失败都记一条）：
        // 「AI 动过我电脑里的什么」是事后唯一的追责依据，所以失败也要落盘。
        // 写盘失败只在日志里 warn，绝不影响本次对话的结果。
        const record = (status: 'ok' | 'blocked' | 'failed', reply: string, blockedTarget?: string): void => {
          const rec = buildRecord({
            petId,
            petName: String(found.pet.name ?? ''),
            permission: acfg.permission,
            userText: text,
            status,
            reply,
            steps: outcome.steps,
            ms: Date.now() - runStart,
            ...(blockedTarget ? { blockedTarget } : {}),
          });
          void appendRecord(assistantHistoryPaths, rec).then((ok) => {
            if (!ok) log.warn('[dsh-pet] 助手操作记录写入失败（不影响对话）');
          });
        };
        // 权限被挡：记下待审批，把提示弹给用户；本条不写记忆（这次没做成）
        if (!outcome.ok && outcome.reason === 'needs-approval') {
          const id = 'apr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          pushPendingApproval({
            id,
            petId,
            tool: outcome.blocked.tool,
            target: outcome.blocked.target,
            reason: outcome.blocked.reason,
            message: outcome.blocked.message,
            userText: text,
            createdAt: Date.now(),
          });
          const tip = outcome.blocked.message + '（在设置页点「允许」后我会重试这一次）';
          state.writePet(petId, 'say', { text: tip });
          record('blocked', tip, outcome.blocked.target);
          return { ok: false, reason: 'generate-error', message: tip };
        }
        if (!outcome.ok) {
          const msg = outcome.message;
          state.writePet(petId, 'say', { text: msg });
          record('failed', msg);
          return { ok: false, reason: 'generate-error', message: msg };
        }
        // 成功：记忆存正文（动作明细不进对话历史，避免把工具日志当聊天记录读回去）
        const now2 = Date.now();
        entry.messages.push({ role: 'user', content: text, ts: now2 });
        entry.messages.push({ role: 'assistant', content: outcome.text, ts: now2 });
        await writeMemory(mem);
        try {
          await compressMemory(mem, entry, found.conf);
        } catch (e) {
          log.warn('[dsh-pet] 自动记忆压缩异常（已忽略，不影响本次回复）：' + (e instanceof Error ? e.message : String(e)));
        }
        state.writePet(petId, 'say', { text: outcome.text });
        log.info(
          `[dsh-pet] 助手完成 pet=${petId}，${outcome.steps.length} 步动作：` +
            outcome.steps.map((s) => s.name + (s.ok ? '✓' : '✗')).join(' '),
        );
        record('ok', outcome.text);
        return { ok: true as const, text: outcome.text };
      }

      // 模型：条目配置的 chatModel 优先（留空 = 不指定）；生成侧失败会回落到当前对话的模型重试一次
      const generated = await generateChat(ctx, system, list, text, pool, configuredModel(found.conf, 'chatModel'));
      if (!generated.ok) return generated;
      const now = Date.now();
      entry.messages.push({ role: 'user', content: text, ts: now });
      // 记忆只存正文（配图属展示层，不进上下文——否则下次请求会把标记当历史读回去）
      entry.messages.push({ role: 'assistant', content: generated.text, ts: now });
      await writeMemory(mem);
      // 自动压缩：**回复已经写盘并且已经拿到文本**，压缩放在最后且失败不冒泡——
      // 摘要只是长期记忆的优化，绝不能让"这次回复"因为压缩失败而失败（用户会看到一句话都发不出去）。
      // 放在这里而不是对话开头：本轮的新消息已经落盘，压缩后 `summarized` 推进的位置把本轮也考虑进去，
      // 下一轮就能直接读新摘要。
      try {
        await compressMemory(mem, entry, found.conf);
      } catch (e) {
        log.warn('[dsh-pet] 自动记忆压缩异常（已忽略，不影响本次回复）：' + (e instanceof Error ? e.message : String(e)));
      }
      // 回复写进 S（与碎碎念同一个叶子：前端本来就是同一条展示链路）
      state.writePet(
        petId,
        'say',
        generated.image ? { text: generated.text, image: generated.image } : { text: generated.text },
      );
      // 同一份文本随返回值带出（叶子照写，不是二选一）
      return { ok: true as const, text: generated.text, ...(generated.image ? { image: generated.image } : {}) };
    });

  /**
   * 当前生效宠物列表 = readAllConfig 成品拍平（main + 文件宠物全部条目；合并器已保证 id 唯一、
   * 字段填满），命令与桌面模式都从这里取。
   */
  const effectivePetList = (): Record<string, unknown>[] => flattenPetList(readAllConfig(configPaths));

  /** 余额刷新周期（秒）：成品 main 条目的 eventsRefreshSec.balance（合并器已填默认；非法兜底 1800） */
  const balancePeriodSec = (cfg: Record<string, Record<string, unknown>>): number => {
    const ers = cfg.main?.eventsRefreshSec as Record<string, unknown> | undefined;
    const n = Number(ers?.balance);
    return Number.isFinite(n) && n > 0 ? n : 1800;
  };

  /** 碎碎念周期（秒）：该宠物**所属条目**的 eventsRefreshSec.whisper（合并器已填默认；非法兜底 300）。
   *  收**已解析的条目配置**：唯一调用方是周期调度，而它的 `petId` 就是从**同一份 cfg** 拍平出来的，
   *  所以这里再查一次只会多出一处"查不到就兜底 main"的不可达分支。 */
  const whisperPeriodSec = (conf: Record<string, unknown>): number => {
    const ers = conf.eventsRefreshSec as Record<string, unknown> | undefined;
    const n = Number(ers?.whisper);
    return Number.isFinite(n) && n > 0 ? n : 300;
  };

  /**
   * 刷新余额并写入 S —— host 侧**唯一**的余额查询点。
   *
   * 改造前是每个客户端各自按自己的定时器去查（浏览器一个 + 桌面每窗口一个）：同一份外部 API
   * 被重复请求、两端还可能看到新旧不一致的数据。现在只有这里查，两端都从 /state 读同一份结果。
   *
   * 失败也写进 S（reason 区分 unsupported / credential-missing / fetch-error）——余额不可用要弹
   * 文字说明气泡，不能静默；意外异常同样落成 fetch-error，不吞。
   *
   * @param manual 这次刷新是不是"用户要的"（/balance 命令、桌面「查看余额」菜单）。
   *   标记随数据一起写进叶子：只有 host 知道是谁要的，前端据此决定余额不可用时要不要**必弹**
   *   文字说明（decideBalanceNotice 的 explicit；周期刷新则只在原因变化时弹一次，免得反复刷屏）。
   */
  /**
   * 账号服务要求的调用方身份（`AccountClientMetadata`）：Platform 用它派生五个客户端头，
   * 只影响**请求来源标识**与**服务端本地化文案**，不参与余额数值与币种。
   *
   * - version：本插件版本（读自身 package.json；读不到回落 '0.0.0'——该字段只是标识）
   * - locale：本插件是中文产品，固定 `zh-CN`（Platform 侧归一到 zh_CN）
   * - timezoneOffsetSeconds：本机 UTC 偏移（东八区为 +28800）
   */
  const accountClientMetadata = (): { version: string; locale: string; timezoneOffsetSeconds: number } => {
    let version = '0.0.0';
    try {
      const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof raw.version === 'string' && raw.version.length > 0) version = raw.version;
    } catch {
      // 读不到不影响查询：version 只是平台侧的来源标识
    }
    return { version, locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
  };

  const refreshBalance = async (manual = false): Promise<void> => {
    // 开始 + 结果各一行：此前成功路径**完全静默**，logs.txt 里既看不出「有没有查」，
    // 也看不出「查了但余额没变」，排错只能靠人肉盯 /state。
    log.info(`[dsh-pet] 余额刷新开始（${manual ? '手动' : '周期'}）`);
    const mark = <T>(v: T): T | (T & { manual: true }) => (manual ? { ...v, manual: true } : v);
    try {
      const sel = ctx.agentDefaultModel.currentSelection();
      const result = await queryBalance(
        sel.provider,
        async (ref) => {
          const rc = await ctx.credentials.resolve(credentialRef(ref));
          return rc?.value;
        },
        // `deepseek-account`（免费额度 / 平台登录）没有 API Key：它的凭证是 DSH 账号服务
        // 持有的授权记录，只能经 getBalance 查询。账号服务是**可选**服务（软取，不放进
        // inject）——没装账号插件时它不在场，此时该路由报 credential-missing 而不是崩。
        async () => {
          const account = ctx.get('deepseekAccount', false);
          if (!account) return undefined;
          return account.getBalance(accountClientMetadata());
        },
      );
      state.writeSection('balance', mark(result));
      // 失败也写 S（前端弹文字说明），日志同样留一条：否则「查了、失败了」与「根本没查」
      // 在文件里长得一模一样。成功用 info，失败用 warn（亮度不同，扫一眼就能分辨）。
      if (result.ok) {
        log.info(`[dsh-pet] 余额刷新成功 provider=${result.provider}（${result.shape}）`);
      } else {
        log.warn(
          `[dsh-pet] 余额刷新失败 provider=${result.provider} reason=${result.reason}` +
            (result.message ? ' ' + result.message : ''),
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      state.writeSection(
        'balance',
        mark({
          ok: false,
          provider: 'unknown',
          reason: 'fetch-error',
          message,
        }),
      );
      log.warn('[dsh-pet] 余额刷新异常：' + message);
    }
  };

  /** 当前交互桌宠 id：/pet 已选且仍存在 → 该宠物；未选/已失效 → 有效宠物列表第一只（进程内，重启回默认） */
  const resolveActivePetId = (): string => {
    try {
      const eff = effectivePetList();
      if (eff.length === 0) return '';
      if (activePetId && eff.some((p) => String(p.id) === activePetId)) return activePetId;
      return String(eff[0].id);
    } catch {
      return activePetId;
    }
  };

  /** 宠物的显示名（name，缺失回落 id）——命令文案用 */
  const petDisplayName = (pet: Record<string, unknown>): string => {
    const n = String(pet.name ?? '').trim();
    return n || String(pet.id ?? '');
  };

  let hasDesktopPet = false;
  /**
   * 桌面模式是否**曾经**成功启动过（粘性，仅本插件生命周期内有效）。
   * 把「没有桌面宠物就不启动」放宽成「从来没有过桌面宠物才不启动」：桌面宠物被全部改成
   * web/none 之后，Helper 仍会带着空宠物列表重启并常驻——只为了把托盘（桌面端显示开关）留着，
   * 那是此时唯一还能在**桌面侧**把宠物切回桌面的入口，Helper 一退它就没了。
   * 但它只在托盘还开着时才值得：`trayEnabled` 为 false 时没人需要那个图标，常驻就只是空进程
   * （0 窗口 / 0 托盘 / 0 Dock），于是判据收紧成 `desktopModeEverActive && trayOn`。
   * 纯浏览器用户（从未有过桌面宠物）不受影响：照旧不探测、不下载、不拉起 Electron。
   */
  let desktopModeEverActive = false;
  /**
   * 系统托盘是否开启（main 条目的 trayEnabled，缺失按开）。与 hasDesktopPet 同一次读盘取得——
   * 它们在同一个判据里一起用，分两次读只会多解析一遍配置。
   */
  let trayOn = true;
  const refreshDesktop = (): void => {
    hasDesktopPet = false;
    try {
      const merged = readAllConfig(configPaths);
      const pets = flattenPetList(merged);
      const desktopPets = pets.filter((p) => isDesktopVisible(p.display));
      hasDesktopPet = desktopPets.length > 0;
      trayOn = merged.main?.trayEnabled !== false;
      // 诊断日志（issue #168）：设置页显示「仅桌面」却始终没有 helper 进程时，这一行能立刻
      // 分辨「宿主读到的 display 就是 web」还是「读到了 desktop」——此前这个判定完全不可见。
      // 托盘开关同样只在这一行里可见：加了它之后「为什么没有托盘/为什么留着空进程」都靠这里看。
      log.info(
        `[dsh-pet] 桌面判定：pets=${pets.length}，桌面可见=${desktopPets.length}` +
          `（${desktopPets.map((p) => String(p.id)).join(',') || '无'}）→ hasDesktopPet=${hasDesktopPet} tray=${trayOn}`,
      );
      // 启动时就把每只宠物的助手工作区建好。
      //
      // 为什么必须在这里做（2026-10-27 用户报「宠物工作区目前是两个，但我们有3个桌宠」）：
      // 原来只有**真的发起一次助手对话**才会按需 mkdir（ensurePetWorkspace），
      // 于是从没用过助手的那只宠物永远没有目录 —— 看起来像漏了一只。
      // 工作区是"每只宠物一个干净目录"的承诺，属于配置事实，不该等第一次对话才成立。
      //
      // 内联 mkdir 而不是调 ensurePetWorkspace：那个 helper 定义在文件更下方，
      // 这里在 `const` 之前调用会踩 TDZ。同时它失败只 warn，不影响启动。
      for (const p of pets) {
        const id = String(p.id ?? '');
        if (!id) continue;
        void mkdir(resolvePetWorkspace(assistantWorkspace, id), { recursive: true }).catch((e) => {
          log.warn('[dsh-pet] 创建宠物工作区失败 pet=' + id + '：' + (e instanceof Error ? e.message : String(e)));
        });
      }
    } catch (e) {
      log.warn(`[dsh-pet] 宠物配置非法，桌面模式已跳过：${e instanceof Error ? e.message : String(e)}`);
    }
  };
  refreshDesktop();

  /** 桌面可见宠物列表（[{id,size}]）：透传 Helper 决定创建几个局部窗口（每宠物一个）。 */
  const desktopPetList = (): Array<{ id: string; size: number }> => {
    try {
      return effectivePetList()
        .filter((p) => isDesktopVisible(p.display))
        .map((p) => ({ id: String(p.id), size: Number(p.size) }));
    } catch {
      return [];
    }
  };

  let helper: HelperProcess | undefined;
  let startRetryTimer: NodeJS.Timeout | undefined;
  let electronEnsure: Promise<void> | undefined;
  let disposed = false;
  /** 「无图形环境」提示只在进程生命周期内打一次，避免守护循环刷屏 */
  let displayWarned = false;
  /** 「无桌面宠物 → 跳过」的 info 只打一次：纯网页用户每次启动都会走这条短路，不该刷屏 */
  let noDesktopSkipped = false;
  /** webServer 端口等待次数：只用于日志节流，不改变重试行为 */
  let portWaitAttempts = 0;
  /**
   * 宿主即应用（`src/app/main.ts`）：本进程**自己就是** Electron 主进程，窗口由它直接建。
   *
   * 这时两条旧路径都必须短路，而且缺一不可：
   *   - `launchHelper` —— 否则会 spawn 第二个 electron.exe（同一个 exe 自我复制，用户看到两只宠物）；
   *   - `startHelper`  —— 否则即使拦下 spawn，仍会走 `ensureElectronDownload()`，在用户机器上白下
   *     一整套 Electron（实测 347 MB），双击启动变成一次大下载。
   *
   * 用环境变量而不是 ctx 服务：`apply()` 的 ctx 契约已经够大，不想为一个布尔再撑一次。
   */
  const inProcessHost = process.env.DSH_PET_IN_PROCESS === '1';

  /** 用已确认存在的 Electron 路径拉起桌面 Helper（每只桌面宠物一个局部小窗口）。 */
  const launchHelper = (electronPath: string | undefined): void => {
    if (inProcessHost) return; // 应用模式：窗口由本进程建，绝不 spawn
    if (helper || disposed) return;
    // 无桌面宠物时：只有「桌面模式曾启用过**且**托盘还开着」才值得为托盘常驻，否则不启动
    if (!hasDesktopPet && !(desktopModeEverActive && trayOn)) return;
    const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0;
    if (!port || port <= 0) {
      // webServer 可能尚未完成监听（OS 分配端口时 port 短暂为 0）：延迟重试。
      // 诊断日志（issue #168）：这条重试以前完全静默——端口长期不就绪时，桌面宠物
      // 「连尝试都没有」且没有任何线索。这里只加可见性，重试节奏与次数保持原样。
      portWaitAttempts += 1;
      if (portWaitAttempts === 1) {
        log.info(`[dsh-pet] webServer 端口尚未就绪（port=${String(port)}），每 500ms 重试拉起桌面 Helper`);
      } else if (portWaitAttempts % 20 === 0) {
        log.warn(
          `[dsh-pet] 已等待 webServer 端口 ${(portWaitAttempts * 500) / 1000}s 仍未就绪` +
            `（port=${String(port)}），桌面 Helper 尚未拉起`,
        );
      }
      if (!startRetryTimer) {
        startRetryTimer = setTimeout(() => {
          startRetryTimer = undefined;
          launchHelper(electronPath);
        }, 500);
        startRetryTimer.unref?.();
      }
      return;
    }
    portWaitAttempts = 0;
    const origin = `http://127.0.0.1:${port}`;
    // 右键「打开网站」交出去的是裸 origin：DSH 只在 `GET /` 接受本进程的启动令牌，换发绑定 authority 的
    // 签名 Cookie，其余请求一律 401 —— 默认浏览器没有该 authority 的 Cookie 时必然打不开（#87）。
    // 令牌等价登录态：只经子进程环境变量递到 helper 内存，不落盘、不进日志；authority 必须保持
    // 127.0.0.1（与 localhost 算两套 Cookie），故这里传 origin 而不是另拼地址。
    const siteUrl = ctx.connection.authenticatedUrl(origin);
    // 桌面渲染端也从同一份 handlePetRoute 拿成品配置（每只宠物一个局部小窗口；经管道，不走 HTTP——
    // DSH Desktop 2.0.3+ 会拦插件自拉进程的裸 HTTP 请求，浏览器访问闸门只放行带令牌的请求）
    const configUrl = `${origin}${ROUTE_PREFIX}/config`;
    helper = new HelperProcess(
      {
        electronPath,
        env: {
          DSH_PET_CONFIG_URL: configUrl,
          // 已鉴权站点 URL（含本进程启动令牌）：只供 helper 的「打开网站」使用，任何日志都不许出现它
          DSH_PET_SITE_URL: siteUrl,
          // 宿主形态决定工具项「打开网站」的去向（同名菜单项，两端两种语义）：
          //   desktop = 宿主是 DSH 桌面应用 → 唤起桌面应用主窗口（helper 走 dsh://open，见 main.js）
          //   site    = dsh web / 独立模式 → 系统默认浏览器打开站点（原行为，别破坏）
          DSH_PET_OPEN_TARGET: isDesktopHost() ? 'desktop' : 'site',
          DSH_PET_SCALE: '1',
          // 打开 bridge 协议：main.js 注册 dsh-pet-bridge scheme，把渲染端请求经管道转给宿主
          DSH_PET_BRIDGE: '1',
          // 每只桌面宠物一个局部小窗口：透传宠物列表（[{id,size}]）
          DSH_PET_PETS: JSON.stringify(desktopPetList()),
        },
        // bridge 协议处理器 = HTTP 路由同一份 handlePetRoute（业务逻辑唯一，两端天然一致）；
        // 素材过文件路径（main.js 自行读盘），json/text 过 body
        bridgeHandler: async (req) => {
          const result = await handlePetRoute(req.url ?? '/', req.method ?? 'GET', req.body);
          if (result.kind === 'file') {
            // file 分支恒 200（404/400 已由 text 分支表达）
            return { id: req.id, status: 200, contentType: result.contentType, file: result.file };
          }
          if (result.kind === 'text') {
            return { id: req.id, status: result.status, contentType: 'text/plain; charset=utf-8', body: result.body };
          }
          if (result.kind === 'none') {
            // 无需应答：管道侧不传 abort signal，正常到不了这里；保底给个空 204
            return { id: req.id, status: 204, contentType: 'text/plain; charset=utf-8', body: '' };
          }
          return {
            id: req.id,
            status: result.status,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(result.obj),
          };
        },
      },
      log,
    );
    try {
      helper.start();
      desktopModeEverActive = true; // 此后即使桌面宠物清零也保留 Helper：托盘常驻，可随时切回来
      log.info(`dsh-pet desktop helper started (config: ${configUrl})`);
    } catch (e) {
      log.warn(`dsh-pet desktop helper start failed: ${e instanceof Error ? e.message : String(e)}`);
      helper = undefined;
    }
  };

  /** 拉起桌面 Helper：先探测本机 Electron；缺失时进程内异步下载
   *  （不 spawn 子进程，CLI node 与 DSH Desktop 均适用），下载完成后自动拉起。 */
  const startHelper = (): void => {
    if (inProcessHost) return; // 应用模式：不探测、不下载 Electron
    if (helper || electronEnsure || disposed) return;
    if (!hasDesktopPet && !(desktopModeEverActive && trayOn)) {
      // 诊断日志（issue #168）：这条短路以前完全静默，是「桌面模式凭空消失：无进程、无目录、
      // 无提示」的直接成因。用 info 而非 warn——纯网页用户这是正常状态；只打一次避免刷屏。
      // 托盘关掉后这里也会命中：没人需要那个图标，空常驻没有意义（见 desktopModeEverActive 注释）。
      if (!noDesktopSkipped) {
        noDesktopSkipped = true;
        log.info(
          `[dsh-pet] 无桌面宠物（display 均为 web/none）且无需保留托盘（tray=${trayOn}），已跳过桌面 Helper 启动`,
        );
      }
      return;
    }
    // 无图形显示环境（Linux 服务器 / 容器）：直接放弃，不探测、不下载、不拉起。
    // 否则 Electron 会「拉起即崩」，被守护循环反复重启并刷满 core dump。
    if (!hasGraphicalDisplay()) {
      if (!displayWarned) {
        displayWarned = true;
        log.warn(
          '[dsh-pet] 未检测到图形显示环境（DISPLAY/WAYLAND_DISPLAY 均为空），已跳过桌面宠物。' +
            '浏览器内宠物不受影响；如需在服务器上启用桌面模式，请配置 Xvfb 后设置 DSH_PET_DESKTOP_FORCE=1。',
        );
      }
      return;
    }
    const found = resolveElectronPath();
    if (found) {
      launchHelper(found);
      return;
    }
    // 诊断日志（issue #168）：只报「没找到」不够用——最常见的情形是「文件明明存在」，
    // 但不在实际查询的路径上（DSH_HOME 不一致）。把真正查的路径一起打出来。
    log.warn(
      `[dsh-pet] 未找到 Electron 可执行文件：DSH_HOME=${dshHomeDir()}，查找路径=${defaultElectronExe()}` +
        `，DSH_PET_ELECTRON_PATH=${process.env.DSH_PET_ELECTRON_PATH ?? '(未设置)'}`,
    );
    log.warn(`[dsh-pet] 开始下载 Electron 到 ${defaultElectronExe()} ...`);
    electronEnsure = ensureElectronDownload({
      // 下载全过程写进工作状态气泡（用户没有控制台，只能靠它看进度与失败原因）
      onLog: ({ text, level, done }) =>
        reportDownload(text, level === 'warn' ? 'error' : done ? 'success' : 'working', done),
      // 同一份进度也落盘：气泡只在有宠物显示时可见，桌面版 Helper 起不来时它就没有载体
      logger: log,
    })
      .then((path) => {
        if (path) {
          launchHelper(path);
        } else {
          log.warn(
            '[dsh-pet] Electron download failed; desktop pet unavailable. Set DSH_PET_ELECTRON_PATH and restart, or retry later.',
          );
        }
      })
      .finally(() => {
        electronEnsure = undefined;
      });
  };

  /** 停止桌面 Helper（保留配置，可再次拉起）。宿主退出/插件卸载路径：不等它退干净（见 stopAndWait）。 */
  const stopHelper = (reason = 'settings-change'): void => {
    if (startRetryTimer) {
      clearTimeout(startRetryTimer);
      startRetryTimer = undefined;
    }
    helper?.stop(reason);
    helper = undefined;
  };

  /** 停止并**等旧 helper 真正退出**：配置变更触发的"停旧起新"专用（issue #64）。 */
  const stopHelperAndWait = async (reason: string): Promise<void> => {
    if (startRetryTimer) {
      clearTimeout(startRetryTimer);
      startRetryTimer = undefined;
    }
    const old = helper;
    helper = undefined;
    await old?.stopAndWait(reason);
  };

  /**
   * 宠物配置（display / size 等）变更后：重解析桌面宠物，**等旧 helper 退出**再拉起新的。
   *
   * 为什么要等（issue #64）：Electron 收到 SIGTERM 后关窗是异步的（几百 ms 起），"发完 kill 就 spawn
   * 新进程"会让旧窗口（旧大小）与新窗口（新大小）短暂共存——用户看到的就是"改完大小冒出来第二只宠物"。
   * 为什么要串行：连续保存会触发多次重启，两次重启交错同样会同时拉起两个 helper，所以用队列串起来。
   * 队列自身绝不留下 rejected 状态，否则后续保存再也不会重启 helper。
   */
  let desktopSyncQueue: Promise<void> = Promise.resolve();
  const syncDesktop = (force = false): Promise<void> => {
    desktopSyncQueue = desktopSyncQueue
      .then(async () => {
        // 同进程宿主（独立应用，DSH_PET_IN_PROCESS=1 / src/app 走 createRequire 加载 Helper）：
        // 下面三步**全是空转**——launchHelper 与 startHelper 都 `if (inProcessHost) return`，
        // stopHelperAndWait 也没有 helper 进程可停。于是改 display 之后窗口集合永不变化
        // （托盘勾选、右键「显示位置」都改得动配置文件却看不见效果）。
        // Helper 已在同一进程里挂了 globalThis.__dshPetSyncWindows（见 runtime/electron-helper/main.js），
        // 由它按成品配置对账窗口；拿不到这个钩子（BRIDGE 模式）才走原来的重启链路。
        const bridgeSync = (globalThis as { __dshPetSyncWindows?: (force?: boolean) => unknown }).__dshPetSyncWindows;
        if (inProcessHost && typeof bridgeSync === 'function') {
          refreshDesktop();
          // 不 await：钩子内部要请求本进程的 /config（走网络），await 会把 configQueue 拖长；
          // 且调用方（/pet-display、/reload）本来就不等重启结果。
          void Promise.resolve()
            .then(() => bridgeSync(force))
            .catch((e: unknown) => {
              log.warn(`[dsh-pet] 桌面窗口对账失败：${e instanceof Error ? e.message : String(e)}`);
            });
          return;
        }
        refreshDesktop();
        await stopHelperAndWait('desktop-config-change');
        startHelper();
      })
      .catch((e: unknown) => {
        log.warn(`[dsh-pet] 重启桌面 Helper 失败：${e instanceof Error ? e.message : String(e)}`);
      });
    return desktopSyncQueue;
  };

  /** 扩展名 → 素材子目录名（webm → webm/，mov → mov/；其余落在动画目录平级放行） */
  const animSubdirFor = (ext: string): string => (ext === '.mov' ? 'mov' : 'webm');

  /** 包内动画素材根：按扩展名取子目录（webm/ 随包发布；mov/ 不存在时为 404 兜底，仅 macOS 自维护）。 */
  const assetRootFor = (ext: string): string => join(PACKAGE_ROOT, 'assets', animSubdirFor(ext));

  /** 用户动画根：按扩展名取子目录（main-animation/webm 或 main-animation/mov）。 */
  const userRootFor = (ext: string): string => join(thumbUserRoot, animSubdirFor(ext));

  // 配置请求覆盖完整读改写：下一次更新必须读取前一次完成后的配置。
  // GET /config 同样排队，避免写入尚未完成时读到空文件而回退内置默认。
  let configQueue: Promise<void> = Promise.resolve();

  /** 单次业务路由(WebServer 注册 → HTTP 落盘 / 桌面 Helper 管道 → scheme 应答,共用同一份实现):
   *  输入只需 rawUrl(/dsh-pet-7340/... + 查询) + method + body 文本;返回 RouteResult(JSON/文本/文件),
   *  消费方各自落盘——业务逻辑只有一份,两端天然一致(硬契约:浏览器/桌面行为严格对齐)。
   *  signal（可选）：调用方断开时**中止挂起等待**（只有 /playback 的 wait 分支会用到）。
   *  管道侧不传——桌面渲染端不查 /playback；HTTP 侧由注册处按 res 的 close 触发。 */
  const handlePetRoute = async (
    rawUrl: string,
    method: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<RouteResult> => {
    const url = new URL(rawUrl, 'http://localhost');
    const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
    const run = (): Promise<RouteResult> => dispatchPetRoute(url, rest, method, body, signal);
    if (rest === 'config' || (rest === 'pet-display' && method === 'POST')) {
      const pending = configQueue.then(run, run);
      configQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    }
    return run();
  };

  const dispatchPetRoute = async (
    url: URL,
    rest: string,
    method: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<RouteResult> => {
    // 成品配置：/dsh-pet-7340/config（GET 读取合并成品 / PUT 保存用户层 / POST 同步内置默认）
    if (rest === 'config') {
      if (method === 'GET') {
        // 唯一配置入口：readAllConfig 返回绝对正确的完成品聚合（{ main:{...}, test1:{...} }），
        // 浏览器/桌面/设置页直接消费，无需任何校验/兜底
        try {
          // 动态配置必须杀缓存（与 /state 同口径）：消费端会「发现配置版本变化 → 重拉 /config」，
          // 这一次 GET 若命中缓存就会拿回旧配置，那套机制直接失效。
          return {
            kind: 'json',
            status: 200,
            obj: readAllConfig(configPaths),
            headers: { 'cache-control': 'no-cache, no-store' },
          };
        } catch (e) {
          return { kind: 'json', status: 500, obj: { error: e instanceof Error ? e.message : String(e) } };
        }
      }
      if (method === 'PUT') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body ?? '');
        } catch {
          return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
        }
        try {
          // 透传保留：读当前磁盘上的用户文件原对象，把非白名单顶层字段（physics/whisperPrompt/
          // chatMemoryRounds/...）带回给 saveUserConfig——设置页保存不再抹掉用户手改的精调配置。
          // **必须走 JSONC 容忍解析器**（readUserConfig）：用户层可能是「同步」写入的带 // 注释
          // 的 config.jsonc 原文，用严格 JSON.parse 会在这里抛错并被吞掉 → existing 变 undefined
          // → 白名单重建 → 用户的高级字段全丢（老 bug 的复发路径，已由守卫测试钉住）。
          const existing = readUserConfig(configPaths);
          const clean = saveUserConfig(parsed, existing);
          if (!clean) {
            return {
              kind: 'json',
              status: 400,
              obj: {
                error:
                  'invalid pet config: expected { pets:[{name?,id,size,balanceEnabled,display,position:{corner,marginX,marginY}}] }（id 为非空字符串且去除首尾空白后唯一；display 为 web/desktop/both/none 之一；可选顶层 notificationsEnabled / whisperImageEnabled / chatImageEnabled / trayEnabled 布尔；可选宠物布尔 whisperEnabled / workStatusEnabled / fixedEnabled）',
              },
            };
          }
          // 损坏预检：用户层存在但连 JSONC 都解析不了（真损坏）→ **先不写盘**。
          // 保存是白名单重建，existing 读不出来就等于把文件里剩下的内容整份丢掉，而且静默——
          // 所以回 409 让设置页弹窗（取消 = 不动文件；确认 = 带 ?force=1 强行重建）。
          if (url.searchParams.get('force') !== '1' && userConfigUnparsable(configPaths)) {
            return {
              kind: 'json',
              status: 409,
              obj: { error: 'user config is unparsable', needConfirm: true, userFile: userConfigPath },
            };
          }
          await mkdir(userRoot, { recursive: true });
          await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');
          void syncDesktop(); // display/size 等可能变化：重解析桌面宠物并重启 Helper（异步，不阻塞保存响应）
          // 响应体 = 保存后的**成品聚合**（与 GET /config 同一份，字段已填满）：
          // 设置页把它直接交给容器的 flattenConfigPets 拍平渲染——客户端的条目级字段
          // （动画池/权重/物理参数/工作状态文案）只有这一处填充，不再有第二份补吹实现。
          return { kind: 'json', status: 200, obj: readAllConfig(configPaths) };
        } catch (e) {
          ctx.logger?.warn?.(`[dsh-pet] config save failed: ${e instanceof Error ? e.message : String(e)}`);
          return { kind: 'json', status: 500, obj: { error: 'failed to save config' } };
        }
      }
      if (method === 'POST') {
        // 同步：把内置默认配置（assets/config.jsonc 原文，含注释）整份写入用户配置——
        // 既是「恢复默认」（合并结果 = 内置默认），又给用户留下一份可直接编辑的完整配置，
        // 不必再自己从包内复制一份（见 config.ts 的 syncUserConfigFromDefault）。
        try {
          syncUserConfigFromDefault(configPaths);
        } catch (e) {
          // 默认文件缺失 / 用户目录不可写：显式 500，绝不静默留下半个配置文件
          return { kind: 'json', status: 500, obj: { error: e instanceof Error ? e.message : String(e) } };
        }
        void syncDesktop(); // 配置变了：重解析桌面宠物并重启 Helper（异步，不阻塞响应）
        return { kind: 'json', status: 200, obj: readAllConfig(configPaths) };
      }
      return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
    }

    // 单只宠物的显示位置（桌面端右键「关闭桌面显示」→ POST /pet-display）。
    // 高频操作，故只收 id + display 两个参数，不要求调用方回传整段 pets（那是 PUT /config 的形态：
    // 客户端做读-改-写既容易误伤同层其它宠物，也拿不准该写哪一层）。
    // 层归属由服务端反查：id 在合并后被 mergePet 保证**全局唯一**（重复实例会被跳过、不进聚合），
    // 所以 findPetInstance 的结果没有歧义；反过来让客户端传 entry 只会多出"参数与真实归属不符"的
    // 新失败面（还平白把 entry 暴露成拼文件路径的输入）。
    // 写入语义与 PUT /config 完全一致：saveUserConfig 白名单重建 + existing 透传——用户手改的
    // whisperPrompt / memes 等非白名单字段不许被抹掉（见 ./config 里那段老 bug 的注释）。
    if (rest === 'pet-display') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      // 失败一律 **HTTP 200 + `{ok:false, reason, message}`**（与其他动作端点同一口径）：
      // 缺 id / display 非法 / 宠物不存在 / 写盘失败全是**业务错误**，不是"资源未找到"或"请求非法"，
      // 用 400/404 会让调用方把业务结论当成传输层故障。200 不代表改动生效——必须看 body 的 ok。
      // 只有 405（方法错）与 400（JSON 坏了）仍是协议层错误码，全插件只有这两处不是 200。
      const fail = (reason: string, message: string): RouteResult => ({
        kind: 'json',
        status: 200,
        obj: { ok: false, reason, message },
      });
      let payload: { id?: unknown; display?: unknown };
      try {
        payload = JSON.parse(body ?? '') as { id?: unknown; display?: unknown };
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
      const nextDisplay = String(payload.display ?? '');
      // id **必填**（与 9 条 `?pet=` 路由同一对词汇：没给 → pet-required；不存在 → unknown-pet）
      if (!petId) return fail('pet-required', 'pet 必填：要指定操作哪只桌宠');
      if (!PET_DISPLAY_SET.has(nextDisplay)) {
        return fail('bad-request', `display 必须是 web / desktop / both / none：${nextDisplay}`);
      }
      let merged: Record<string, Record<string, unknown>>;
      try {
        merged = readAllConfig(configPaths);
      } catch (e) {
        return fail('generate-error', e instanceof Error ? e.message : String(e));
      }
      // 命中不到有两种可能：id 根本不存在，或该实例在合并时**因 id 与其它条目重复被跳过**（于是不在
      // 聚合里）。两种都只能按"没有这只桌宠"报——绝不能凭 id 去猜它"应该"属于哪个文件。
      const hit = findPetInstance(merged, petId);
      if (!hit) return fail('unknown-pet', `没有这只桌宠：${petId}`);
      // 目标层：main → 用户主配置；其余 → 文件宠物自己的配置（.json 或 .jsonc，定位统一走 ./config）
      let layerPath: string;
      let layerDir: string;
      let existing: Record<string, unknown> | undefined;
      if (hit.entry === 'main') {
        layerPath = userConfigPath;
        layerDir = userRoot;
        existing = readUserConfig(configPaths);
      } else {
        const file = readPetConfigEntry(configPaths, hit.entry);
        if (!file) {
          return fail('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
        }
        layerPath = file.path;
        layerDir = petConfigDir;
        existing = file.raw;
      }
      // 整段替换语义：saveUserConfig 重建的是整个 pets 数组，必须带上**该层全部**宠物，只把目标
      // 那只的 display 换掉（漏掉别的 = 把它们从配置里删掉）。
      const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
      const pets = layerPets.map((p) => (String(p.id) === petId ? { ...p, display: nextDisplay } : p));
      const clean = saveUserConfig({ pets }, existing);
      if (!clean) return fail('bad-request', '宠物配置非法');
      try {
        await mkdir(layerDir, { recursive: true });
        await writeFile(layerPath, JSON.stringify(clean, null, 2), 'utf8');
      } catch (e) {
        return fail('generate-error', e instanceof Error ? e.message : String(e));
      }
      // 配置变更信号（**只在写盘成功之后**：失败时不该动版本号，否则浏览器白重拉一次 /config）。
      // 这是全插件**唯一**写 sections.config 的地方：保存 / 同步配置的调用方自己就拿到了成品聚合
      // （响应体），桌面端由下面的 syncDesktop() 重启，都不需要这个信号；
      // 而桌面端右键改 display 时浏览器页面**不是发起方**，只能靠它发现「配置被别处改过」。
      state.writeSection('config', {});
      // 占用锁：改成 `none`（桌面端右键「关闭桌面显示」）＝ 用户主动隐藏/关闭，属于**抢占**——
      // 撤销本轮占用（cause: preempted）。不做的话宠物会被锁到 TTL 到点，而用户明明已经把它藏了
      // （issue #122：「用户主动停止、隐藏或关闭时，也应能取消联动，避免宠物被永久锁住」）。
      // 只认 `none`：web/desktop/both 是换显示位置，不是"用户接管"。
      if (nextDisplay === 'none') lock.release({ petId, force: true });
      // 不 await：发起者很可能就是**即将被这次重载换掉的**桌面 Helper（与 /reload 同一处境）。
      // 写盘已经落定，重启结果不需要回给调用方。
      void syncDesktop();
      // 响应体 = 改动后的**成品聚合**（与 PUT / POST /config 同形）：调用方（浏览器端右键菜单）
      // 直接把它交给 petBridge.reload，不必再发一次 GET /config —— 与设置页保存走的是同一条路，
      // 也就不会拿到可能陈旧的配置（现场表现：不返回聚合时浏览器端要刷新才生效）。
      return { kind: 'json', status: 200, obj: readAllConfig(configPaths) };
    }

    // 桌面端「重载配置」（右键菜单 → POST /reload）：重启桌面 Helper，全部桌面宠物窗口按最新配置重建。
    // 与保存走**同一条**重启路径（syncDesktop：串行队列 + 等旧进程真正退出再起新的），
    // 所以宠物数量 / display / size 的变化同样生效——渲染端就地重拉配置做不到这几项
    // （每只宠物一个窗口，是宿主启动时按 DSH_PET_PETS 建的）。
    // 注意：发起者就是**即将被重启的那个 helper**，本响应不保证送达，因此不 await 重启、立刻回 200。
    if (rest === 'reload') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      // force：重载 = 用户主动要求「照配置重来一遍」，哪怕对账签名没变也要重建窗口
      // （例如配置里改的是位置/人设这类窗口以外的东西，用户仍期望看到刷新）
      void syncDesktop(true);
      return { kind: 'json', status: 200, obj: { reloading: true } };
    }

    // 托盘「退出」（桌面 Helper 的托盘菜单 → GET 探能力 / POST 执行，issue #178）。
    // 为什么不是 helper 自己 app.quit()：BRIDGE 模式下 helper 由宿主拉起，它退出会被**当成崩溃**按
    // 指数退避重启（helper-process.ts），点了只是闪一下、进程还在；必须由宿主执行「停 Helper + 关服务 +
    // 退出」。这个能力只有独立模式提供（standalone 伪 ctx 上的 shutdownApp，见 src/standalone/context.ts）：
    // DSH 内的桌面模式没有它 —— 关掉整个 DSH 不该由一只宠物的托盘决定，故 canQuit:false、菜单项不出现。
    // 不调 syncDesktop：退出不是重启，reload 那条守卫仍要求它恰好出现 4 次。
    if (rest === 'quit') {
      // 能力按**请求时**软取：DSH 宿主没有这个服务（裸读属性会抛，见 optionalService 的说明），
      // 于是拿到 undefined → canQuit:false，退出菜单项不出现；独立模式取得到 → 菜单可用。
      const quit = optionalService('shutdownApp');
      const canQuit = typeof quit === 'function';
      if (method === 'GET') return { kind: 'json', status: 200, obj: { canQuit } };
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      // 失败按动作端点口径回 200 + 结构化结果（与 /pet-display 一致）：不支持退出不是协议层错误。
      if (!canQuit) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'unsupported', message: '宿主未提供退出能力（DSH 内请关闭桌面模式）' },
        };
      }
      // 不 await：收尾会先停掉发起请求的这个 Helper，响应不保证送达（与 /reload 同一处境）。
      // 推到下一拍再执行，让本次 200 先写出去。
      setImmediate(() => {
        try {
          (quit as (reason: string) => void)('托盘退出');
        } catch (e: unknown) {
          log.warn(`[dsh-pet] 托盘退出失败：${e instanceof Error ? e.message : String(e)}`);
        }
      });
      return { kind: 'json', status: 200, obj: { ok: true } };
    }

    // 配置文件路径 + 存储位置清单（设置页「高级配置」与「卸载与存储」展示用）
    if (rest === 'config/meta') {
      return {
        kind: 'json',
        status: 200,
        obj: {
          user: userConfigPath,
          default: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
          animations: thumbUserRoot,
          memes: memesUserRoot,
          // 统一日志出口（就是上面那个 logger 的 file：三种模式都落在 $DSH_HOME/dsh-pet/logs.txt）：
          // 桌面版没有控制台，用户反馈「宠物不出现 / 闪退」时只能靠这个文件。
          logs: log.file,
          // 全部落盘位置（本包用户数据 / Electron 运行时 / 桌面端缓存 / 下载缓存 / 插件本体）：
          // 前两条直接传真实写入方的路径，不在这里重拼目录名
          storage: storageEntries({
            userDataRoot: userRoot,
            electronDir: electronLandingDir(),
            home: homedir(),
            packageRoot: PACKAGE_ROOT,
          }),
          // profile 名（拼卸载命令 dsh plugin --profile <名> remove dsh-pet；反推不出时为空串）
          profile: profileNameFrom(PACKAGE_ROOT) ?? '',
        },
      };
    }

    // 第三方右键菜单（供别的插件注册自己的菜单项）。四个方法：
    //   POST   /menu/item    注册（该 owner 的菜单项**整体覆盖**；body = { owner, labels, target? }，
    //                        target 选填 web / desktop / both，缺省 both）
    //   DELETE /menu/item    清除该 owner 的全部菜单项（幂等）
    //   GET    /menu/events  查询触发（读取即消费；?wait= 长轮询）
    //   POST   /menu/click   渲染端点击上报（内部通道，第三方不调）
    // 业务失败一律 200 + { ok:false, reason, message }（与 /anim、/lock 等同口径）；
    // 400 只留给「JSON 坏了」，405 只留给方法错。
    // 注册表在进程内存（./menu），快照写进 S 的 sections.menu：两端右键菜单据此拼「更多」，
    // 因此注册后**不用重启桌面 Helper**，下一拍 /state 就到了（长轮询下几乎是立即）。
    if (rest === 'menu/item') {
      if (method === 'DELETE') {
        const result = menuRegistry.clear(url.searchParams.get('owner') ?? '');
        if (!result.ok) {
          return { kind: 'json', status: 200, obj: { ok: false, reason: result.reason, message: result.message } };
        }
        state.writeSection('menu', { items: menuRegistry.snapshot() });
        return { kind: 'json', status: 200, obj: { ok: true, removed: result.removed } };
      }
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? '');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const result = menuRegistry.register(parsed);
      if (!result.ok) {
        return { kind: 'json', status: 200, obj: { ok: false, reason: result.reason, message: result.message } };
      }
      // 写入会唤醒所有挂起的长轮询；两端拿到新 counter 就重拼菜单（下一次右键即生效）
      state.writeSection('menu', { items: menuRegistry.snapshot() });
      return { kind: 'json', status: 200, obj: { ok: true } };
    }

    if (rest === 'menu/events') {
      if (method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      const owner = url.searchParams.get('owner') ?? '';
      const rawWait = Number(url.searchParams.get('wait') ?? '0');
      const waitMs = Number.isFinite(rawWait) && rawWait > 0 ? Math.min(rawWait, MENU_WAIT_MAX_MS) : 0;
      // 挂起等待期间调用方断开：不额外处理（最多白挂 MENU_WAIT_MAX_MS，无状态残留）
      const events = await menuRegistry.poll(owner, waitMs);
      // owner 不存在（没注册过 / 被清除了 / 宿主重启过）：业务失败，仍是 200
      if (events === null) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'unknown-owner', message: '这个 owner 没有注册，重新注册即可' },
        };
      }
      return { kind: 'json', status: 200, obj: { ok: true, events } };
    }

    if (rest === 'menu/click') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? '');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      // delivered=false（项已不在）= 正常竞态：渲染端拿的是上一拍快照，仍回 200
      return { kind: 'json', status: 200, obj: menuRegistry.click(parsed) };
    }

    // 可选模型清单（设置页「AI 模型」两个下拉框的数据源）：与 DSH 自己的模型选择器**同源**——
    // 都来自宿主 llm 服务：listProviders = 已注册的实时服务商路由，listModels(provider) = 该路由下的模型。
    // 只读、无副作用；某个服务商列模型失败（适配器不支持 / 网络）只让它空着，不拖垮整张清单。
    // 服务商路由一个都没注册时回落到 listConfigurableProviders（适配器声明可配置的路由），
    // 免得下拉框空着——那种路由调用失败会由生成侧的回落兜住。
    if (rest === 'models') {
      if (method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      try {
        const llm = ctx.llm as
          | {
              listProviders?: () => Array<{ id?: unknown; name?: unknown }>;
              listConfigurableProviders?: () => Array<{ provider?: unknown; displayName?: unknown }>;
              listModels?: (provider: string) => Promise<Array<{ id?: unknown; name?: unknown }>>;
            }
          | undefined;
        const named = (id: unknown, name: unknown): { id: string; name: string } => {
          const pid = String(id ?? '');
          return { id: pid, name: String(name ?? '') || pid };
        };
        let providers = (typeof llm?.listProviders === 'function' ? llm.listProviders() : []).map((p) =>
          named(p?.id, p?.name),
        );
        if (providers.length === 0 && typeof llm?.listConfigurableProviders === 'function') {
          providers = llm.listConfigurableProviders().map((p) => named(p?.provider, p?.displayName));
        }
        providers = providers.filter((p) => p.id);
        const catalog = await Promise.all(
          providers.map(async (p) => {
            let models: Array<{ id: string; name: string }> = [];
            try {
              const list = await llm?.listModels?.(p.id);
              models = (Array.isArray(list) ? list : []).map((m) => named(m?.id, m?.name)).filter((m) => m.id);
            } catch {
              /* 单个服务商列不出模型：留空即可（下拉框里该服务商只有「跟随当前对话」可选） */
            }
            return { ...p, models };
          }),
        );
        return { kind: 'json', status: 200, obj: { providers: catalog } };
      } catch (e) {
        return { kind: 'json', status: 500, obj: { error: e instanceof Error ? e.message : String(e) } };
      }
    }

    // 轮询统一状态（S）：/dsh-pet-7340/state（GET，no-cache）——前端轮询的**唯一**数据源
    // （余额 / 工作状态 / 通知 / 配置变更信号 / 宠物说话，形状见 ./state）。
    // 只读、纯内存、**零副作用**：绝不在这里触发外部调用或模型生成——那会把所有人的轮询拖死；
    // 也**不在这里碰磁盘**（早先这里现算配置文件的 mtime 指纹，等于每拍读一次盘，
    // 桌面端一窗一宠各自轮询 → N 倍；配置变更信号已改走 sections.config 叶子）。
    //
    // **长轮询**：带 `?since=&timeout=`（成对必填）时，若调用方手里的版本与当前相同就**挂起**，
    // 直到任意叶子被写过（立刻返回）或超时。不带这两个参数 = 立刻返回全量（改造前的语义）。
    // 等待语义与 GET /playback/{id} 的 wait 是同一套：上限同值、断线走同一个 signal 收尸、
    // 卸载走 cancelAll()。区别只有一个——那边的唤醒条件是"某条记录进入某个状态"，
    // 这边是"任意叶子被写过"，所以等待者是全局集合，一次写入唤醒所有人。
    if (rest === 'state') {
      if (method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      const headers = { 'cache-control': 'no-cache, no-store' };
      const parsed = parseStateWaitQuery(url.searchParams.get('since'), url.searchParams.get('timeout'));
      if (parsed.kind === 'error') return { kind: 'json', status: 400, obj: { error: parsed.error } };
      const current = state.read();
      // 两者都没传 → 立刻返回；已经有新东西 → 也立刻返回（别白等一整个 timeout）。
      // timeout=0 走挂起分支，下一拍就醒，等价"立刻返回"，这里不特判。
      if (parsed.kind === 'none' || current.counter !== parsed.since) {
        return { kind: 'json', status: 200, obj: current, headers };
      }
      const since = parsed.since;
      return await new Promise<RouteResult>((resolveWait) => {
        let settled = false;
        /** 收尾：只认第一次（唤醒 / 超时 / 取消 / 调用方断开 都可能先后到达） */
        const settle = (result: RouteResult): void => {
          if (settled) return;
          settled = true;
          resolveWait(result);
        };
        // 唤醒时**才** read()：store 保证"叶子已写定"之后才叫醒，所以这里拿到的一定是新状态
        const cancel = state.wait({
          since,
          timeoutMs: parsed.timeoutMs,
          onWake: () => settle({ kind: 'json', status: 200, obj: state.read(), headers }),
        });
        // 调用方断开：取消等待者（清掉它的超时定时器），以"无需应答"收尾。
        const onAbort = (): void => {
          cancel();
          settle({ kind: 'none' });
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    // 外部写入工作状态：/dsh-pet-7340/work-status
    //   POST   = 设置固定外部槽 `api` 的档位（可选任务文案）；任务文案省略 = 保留原值，null = 清空
    //   DELETE = 清空外部槽回空闲（幂等）
    // 只解决"外部程序把状态告诉桌宠"，不做多写者仲裁/租约/会话管理；
    // 外部槽与 DSH 会话一起参与现有优先级（waiting > error > working > thinking > result > success）。
    if (rest === 'work-status') {
      if (method === 'DELETE') {
        if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
        return { kind: 'text', status: 204, body: '' };
      }
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      if (Buffer.byteLength(body ?? '', 'utf8') > 8 * 1024)
        return { kind: 'json', status: 413, obj: { error: 'body too large' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? '');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      const payload = parsed as { state?: unknown; task?: unknown };
      const state = payload.state;
      if (typeof state !== 'string' || !(HOST_WORK_STATUS_STATES as readonly string[]).includes(state))
        return { kind: 'json', status: 400, obj: { error: 'invalid state' } };
      let task: string | null | undefined;
      if (Object.prototype.hasOwnProperty.call(payload, 'task')) {
        if (payload.task === null) {
          task = null;
        } else if (typeof payload.task === 'string') {
          const trimmed = payload.task.trim();
          if (trimmed === '') {
            task = null;
          } else if (Array.from(trimmed).length > TASK_TEXT_MAX) {
            return {
              kind: 'json',
              status: 400,
              obj: { error: `task too long (max ${TASK_TEXT_MAX} code points)` },
            };
          } else {
            task = trimmed;
          }
        } else {
          return { kind: 'json', status: 400, obj: { error: 'invalid task' } };
        }
      }
      externalWorkSeq += 1;
      workStatus.setState(EXTERNAL_WORK_SESSION, state as HostWorkStatusState, externalWorkSeq);
      if (task !== undefined) workStatus.setTask(EXTERNAL_WORK_SESSION, task);
      publishWorkStatus();
      return {
        kind: 'json',
        status: 200,
        obj: {
          state: workStatus.stateOf(EXTERNAL_WORK_SESSION) ?? state,
          task: workStatus.taskOf(EXTERNAL_WORK_SESSION),
        },
      };
    }

    // 余额：/dsh-pet-7340/balance（POST = 立即刷新一次并写入 S，返回 {ok}）
    // 动作端点，**不返回余额数据**——数据只有一个出口（/state），这里只负责"让它刷新"。
    // 改造前这里是 GET（直接查余额）+ /balance/trigger（1s 计数轮询）两个端点，都已删除：
    // 前端不再各自定时查余额（host 定时器统一查，两端共享一份），也不再需要计数轮询中转。
    if (rest === 'balance') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      await refreshBalance(true); // manual：用户主动要的，余额不可用时前端必弹文字说明
      // ok 只表示"这次刷新动作完成了"；余额本身是否可用在 S 的 data 里（ok:false 会弹文字说明气泡）
      return { kind: 'json', status: 200, obj: { ok: true } };
    }

    // 占用锁：/dsh-pet-7340/lock?pet=<id>          （POST = 取锁 / 续期，二合一）
    //         /dsh-pet-7340/lock/release?pet=<id>  （POST = 释放）
    //
    // issue #122 第 4 项「独立动作/气泡占用」。一把锁、**全有全无**：拿锁 → 回 lockId；占用期间
    // 除持锁者外全静音（5 个动作端点要带 `?lock=`，内部自动来源各自让路）；释放 → 一切复原。
    //
    // 与 /playback 的分工：那个是"这一次点播播完没有"的**回执**，这个是"这段时间归谁控制"的**租约**。
    // 锁自己占一个叶子（`pets.<id>.lock`）：渲染端必须能读到它才能冻结自己——宿主停不掉一段
    // 正在播的视频，"完全静止"最终是渲染端执行的。
    //
    // 取锁 / 续期**二合一**（`lockId` 给了 = 续期）：续期是持锁者每隔几秒就要做一次的**心跳**，
    // 而这一次调用同时就是"我的锁还在吗"的探测器——丢了会回 lock-lost + cause，所以不需要
    // 单独的"查锁"端点。真值表与墓碑语义见 ./lock 的 acquire。
    //
    // 失败一律 HTTP 200 + ok:false（与其他动作端点口径一致）；只有 405 / 400 不是 200。
    if (rest === 'lock' || rest === 'lock/release') {
      const isRelease = rest === 'lock/release';
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? 'null');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      try {
        // pet **必填**且必须真实存在（与 /anim、/broadcast 同一口径，见 requirePet）
        // surface 只对**取锁**这一支校验：`/lock/release` 必须永远能成功（否则宠物中途被隐藏就撤不掉锁）
        const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: !isRelease });
        if (!who.ok) return who.res;
        const petId = who.petId;
        if (isRelease) {
          const d = lock.release({ petId, lockId: o.lockId, force: o.force });
          if (!d.ok) {
            const obj: Record<string, unknown> = { ok: false, reason: d.reason, message: d.message };
            if (d.reason === 'lock-lost') obj.cause = d.cause;
            return { kind: 'json', status: 200, obj };
          }
          // 幂等：当前没有锁同样回 ok（"让锁消失"这个意图在空状态下已经成立）
          return { kind: 'json', status: 200, obj: { ok: true } };
        }
        const d = lock.acquire({ petId, lockId: o.lockId, ttl: o.ttl });
        if (!d.ok) {
          const obj: Record<string, unknown> = { ok: false, reason: d.reason, message: d.message };
          if (d.reason === 'locked') obj.expiresAt = d.expiresAt; // 让对方知道何时能重试
          if (d.reason === 'lock-lost') obj.cause = d.cause;
          return { kind: 'json', status: 200, obj };
        }
        return {
          kind: 'json',
          status: 200,
          obj: { ok: true, lockId: d.lockId, petId: d.petId, expiresAt: d.expiresAt },
        };
      } catch (e) {
        // 配置读取失败等（安装损坏）→ 显式失败，不静默（与其他动作端点同一口径）
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 碎碎念：/dsh-pet-7340/whisper?pet=<id>（POST = 立即让桌宠新说一句，返回 {ok,text,image?}）
    // 文本**照旧**写进 S 的 pets.<id>.say（碎碎念/命令气泡/对话回复同一个叶子），同时随响应带回——
    // 两条出口给的是同一份文本；其它消费端（网页/桌面/第三方监听）仍从 /state 读。
    // 手动语义不受 whisperEnabled 门控：那个字段只关自动周期（与改造前一致）。
    if (rest === 'whisper') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      try {
        // pet **必填**且必须真实存在：收紧前这里是 `?? ''`——空串会让人设/配图按 main 条目取、
        // 生成结果写进没人消费的 `pets[""].say`，还回 ok:true（钱花了、话丢了、调用方以为成功）。
        const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: true });
        if (!who.ok) return who.res;
        const r = await publishWhisper(who.petId);
        if (r.ok) {
          return {
            kind: 'json',
            status: 200,
            obj: { ok: true, text: r.text, ...(r.image ? { image: r.image } : {}) },
          };
        }
        // 真实 reason 原样透出（独立模式是 `provider-missing`，见 ./whisper 的联合体）——
        // 不再把一切失败糊成 generate-error，调用方据此能分清"没配模型"与"生成炸了"。
        const obj: Record<string, unknown> = { ok: false, reason: r.reason };
        if (r.message) obj.message = r.message;
        return { kind: 'json', status: 200, obj };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 第三方投喂：/dsh-pet-7340/broadcast?pet=<id>（POST = 把一段**外部给定的**文本写进桌宠气泡）
    // 与 /whisper 的区别：这个**不生成**，调用方自己给文本——宿主侧其他插件（女仆巡检等）
    // 想说自己的话时用它，桌宠就成了那套人格的"实体"（见 issue #76）。
    // 写入 S 的 pets.<id>.say —— 与碎碎念/对话回复**同一个叶子**，两端 1s 内自动显示，前端零改动。
    // 动作端点，只回 {ok}；文本本身从 /state 读。
    // 校验（不通过一律 HTTP 200 + ok:false，与 /chat 的失败口径一致）：
    //   text 必填、trim 后非空（**不设长度限制，也不限频**：内容与频率由调用方自己负责）；
    //   pet **必填**（空串 → pet-required），且须真实存在（否则 unknown-pet）；
    //   image / url **配图的两种形态，二选一**（两个都给 = bad-request）：
    //     image 只认**该条目表情包池内的名称**（池内命中即用其规范名）；
    //     url 是第三方自带的完整地址，不查池（issue #122 第 1 条：素材由第三方自己托管），
    //     scheme 由宿主卡在 http/https。**宿主不做代理**：跨域由浏览器强制，插件绕不过去。
    //   duration 可选，气泡显示时长（ms）；缺省 10s，`0` = 字面意思「不显示」，负数/非有限数拒绝；
    //   anim 可选，是否联动 events.whisper 动画；只有严格 false 才关闭（宽松口径）。
    if (rest === 'broadcast') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? 'null');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      // 空文本不需要读配置就能判定：先短路，别为一个必然失败的请求去碰磁盘
      if (!normalizeBroadcastText(o.text)) {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: 'text 为空' } };
      }
      // duration 同理：判定不需要配置，先短路（anim 没有非法值，宽松口径下永远有结论）
      const duration = normalizeBroadcastDuration(o.duration);
      if (duration === null) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'bad-request', message: 'duration 必须是 ≥0 的有限数字（毫秒）' },
        };
      }
      const anim = normalizeBroadcastAnim(o.anim);
      try {
        const cfg = readAllConfig(configPaths);
        const d = decideBroadcast({
          cfg,
          requested: String(url.searchParams.get('pet') ?? ''),
          text: o.text,
          image: o.image,
          url: o.url,
          duration,
          anim,
          memeDirs: memeDirsFor,
        });
        if (!d.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: d.reason, message: d.message } };
        // 显示端对齐：不满足 → pet-not-displayed（+ 实际 display），早于锁门禁
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        // 占用门禁：有锁时只有持锁者能投喂（无锁恒放行，见 lockBlocked）
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        // duration / anim 写**解析后的生效值**（缺省也已填成显式值）：/state 里因此能看到
        // 实际生效的时长与联动开关，调用方不用自己猜缺省是多少。
        // 配图两种形态二选一（判定层保证）：url 形态写 url，名称形态写池内规范名，都没有则纯文本。
        const pic = d.url !== undefined ? { url: d.url } : d.image !== undefined ? { image: d.image } : {};
        state.writePet(d.petId, 'say', { text: d.text, ...pic, duration: d.duration, anim: d.anim });
        return { kind: 'json', status: 200, obj: { ok: true } };
      } catch (e) {
        // 配置读取失败等（安装损坏）→ 显式失败，不静默
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 清空气泡：/dsh-pet-7340/bubble/clear?pet=<id>（POST = 收起该宠物**当前正显示的说话气泡**）
    // 与 /broadcast 的关系：投喂写气泡，这个收气泡；两者共用同一个叶子（pets.<id>.say）。
    // 清空靠叶子里的 `{ clear: true }` 标记——**空文本表达不了这个动作**：消费端的 readSay
    // 会把空文本判成非法、整拍跳过，所以必须有一个独立的形态（见 src/shared/state.ts 的 SayCue）。
    // 只收说话气泡：余额气泡、工作状态气泡、以及 anim/position/throw 三个叶子**都不动**
    // （气泡与动作是两把锁，分别释放——issue #122 第 5 条）。
    // 幂等：当前没有气泡也回 { ok: true }（"让气泡消失"这个意图在空状态下已经成立）。
    // 无请求体；动作端点，只回 {ok}。
    if (rest === 'bubble/clear') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      try {
        const cfg = readAllConfig(configPaths);
        const d = decideBubbleClear({
          cfg,
          requested: String(url.searchParams.get('pet') ?? ''),
        });
        if (!d.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: d.reason, message: d.message } };
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        state.writePet(d.petId, 'say', { clear: true });
        return { kind: 'json', status: 200, obj: { ok: true } };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 点播动画：/dsh-pet-7340/anim?pet=<id>（POST = 让桌宠播一段动画）
    // 两种形态**二选一**（issue #122 第 1 条）：
    //   name = 池内的动画名。效果与右键菜单点「动作」树**完全一致**——两端都复用同一个菜单动作
    //     处理函数（浏览器 handleMenuAction / 桌面 sprite.onMenuAction），宿主只负责把名字送到。
    //     写入 S 的 pets.<id>.anim，前端发现 counter 变化后换源播放（**名字即文件名**）。
    //   url = 第三方自带的素材完整地址。**不查动画池**（素材在别人手里，池里当然没有这个名字），
    //     前端拿到后**直接换源播一次，不走菜单语义**——裸地址没有"文字类要镜像修正 /
    //     移动类走真实位移"这些属性。scheme 由宿主卡在 http/https。
    // 动作端点，只回 {ok}（成功时另带回执编号 playbackId）。
    // 校验（不通过一律 HTTP 200 + ok:false，与其他动作端点口径一致）：
    //   name / url 必须**恰好给一个**：两个都给或都不给 = 意图不明 → bad-request；
    //   name 必须在该宠物 animations 配置能点到的集合内
    //   （播放端对不存在的动画没有兜底：名字即文件名 → 404 → 加载失败 → 表现为"点了没反应"，
    //    所以必须在这里拦住，而不是写进 S 让前端白跑一趟）；
    //   url 必须是 http/https 的完整地址（`file:` 会让桌面端渲染进程能读本地任意文件）；
    //   pet **必填**（空串 → pet-required），且须真实存在（否则 unknown-pet）；
    //   facing **可选**（left / right）：给了就必须合法（非法 → bad-request），**没给就不动朝向**
    //     ——叶子里连字段都不写，渲染端保持宠物当前朝向（不是"回落 left"）。显式值优先于渲染端
    //     "文字类动画点播前强制朝左"那条镜像修正（调用方明确要哪个朝向就给哪个）。
    if (rest === 'anim') {
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? 'null');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      try {
        const cfg = readAllConfig(configPaths);
        const d = decideAnim({
          cfg,
          requested: String(url.searchParams.get('pet') ?? ''),
          name: o.name,
          url: o.url,
          facing: o.facing,
        });
        if (!d.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: d.reason, message: d.message } };
        // 显示端对齐：不满足 → pet-not-displayed（+ 实际 display），早于锁门禁
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        // 占用门禁：持锁者自己的点播照放行（那是它的演出），别人一律拒
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        // 播放回执：受理时建记录（accepted），并把编号随叶子一起下发——渲染端据此上报。
        // 记录里的标识：name 形态是动画名，url 形态就是那个地址（纯记录，不参与任何判定）。
        // 叶子形状：name 与 url **恰好一个**（判定层保证），消费端按字段名决定走不走菜单语义
        // ——url 是裸地址，没有"文字类要镜像修正 / 移动类走真实位移"这些属性。
        // `facing` 只在调用方**显式给了**时才进叶子：没给 = 不动朝向，叶子里连字段都没有
        //（消费端据此区分"没要求"和"要求 left"，不会把缺省当成 left）。
        const record = playback.create(d.petId, d.url ?? d.name ?? '');
        state.writePet(d.petId, 'anim', {
          ...(d.url !== undefined ? { url: d.url } : { name: d.name }),
          playbackId: record.playbackId,
          ...(d.facing === undefined ? {} : { facing: d.facing }),
        });
        return { kind: 'json', status: 200, obj: { ok: true, playbackId: record.playbackId } };
      } catch (e) {
        // 配置读取失败等（安装损坏）→ 显式失败，不静默
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 位置与抛掷：/dsh-pet-7340/position 与 /dsh-pet-7340/throw（POST）——两条**运动指令**。
    //
    // 与 /anim 同族：受理后写进 S 的宠物叶子（pets.<id>.position / pets.<id>.throw），由渲染端消费。
    // 位置**不引入任何新运动学**：`mode` 三选一（instant 一帧到位 / spring 拖拽那套过阻尼弹簧 /
    // line 按 duration 毫秒直线走到），三条路都是渲染端已经有的；抛掷复用已有的 startThrow
    // （角度/力度换算成初速度），下游的重力/反弹/摩擦/落地 Q 弹/宠物间碰撞一概照旧。
    // 所以这里只做校验与夹取（纯逻辑在 ./motion-cue，可离线单测）。
    //
    // 位置：x/y 是宠物**中心**的归一化坐标（0~1），越界**夹取**并把实际生效值回给调用方。
    // 抛掷：angle 单位度（0 = 正右，逆时针为正）；power 是力度倍率（1.0 = 1200 px/s 软钳速前）。
    //
    // 与用户拖拽撞车时**静默丢弃**：渲染端发现手指正按在宠物身上就丢掉这一拍，但仍然回 ok:true
    // （动作端点只表示"受理了"，不表示"生效了"，与 /anim 同一契约）。宿主判不了拖拽状态——
    // 那只有渲染端知道（见两端的 active 标志），所以这里不做拒绝。
    if (rest === 'position' || rest === 'throw') {
      const isPosition = rest === 'position';
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? 'null');
      } catch {
        return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
      }
      const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      try {
        const cfg = readAllConfig(configPaths);
        const requested = String(url.searchParams.get('pet') ?? '');
        if (isPosition) {
          const d = decidePosition({
            cfg,
            requested,
            x: o.x,
            y: o.y,
            mode: o.mode,
            duration: o.duration,
          });
          if (!d.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: d.reason, message: d.message } };
          const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
          if (noSurface) return noSurface;
          const blocked = lockBlocked(d.petId, url.searchParams);
          if (blocked) return blocked;
          // 叶子按模式收敛成最小形状：非 line 模式不带 duration（见 positionLeafData）
          state.writePet(d.petId, 'position', positionLeafData(d));
          // 回**夹取后**的实际生效值：调用方不必自己算边界，也不会误以为越界值被照单全收
          return { kind: 'json', status: 200, obj: { ok: true, x: d.x, y: d.y } };
        }
        const d = decideThrow({ cfg, requested, angle: o.angle, power: o.power });
        if (!d.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: d.reason, message: d.message } };
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        state.writePet(d.petId, 'throw', { angle: d.angle, power: d.power });
        return { kind: 'json', status: 200, obj: { ok: true } };
      } catch (e) {
        // 配置读取失败等（安装损坏）→ 显式失败，不静默（与 /anim 同一口径）
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 实况：/dsh-pet-7340/pose?pet=<id>        （GET  = 第三方读**桌面端**的实况快照）
    //       /dsh-pet-7340/pose/report?pet=<id> （POST = **桌面渲染端**上报，内部通道）
    //
    // 为什么只有桌面端走这条路：桌面宠物**一窗一只**，位置全局唯一一份 → 宿主快照语义干净；
    // 而网页端的位置**天生每个页面一份**（开两个标签页时两边本来就不同），塞进宿主快照必然是
    // 错的（后写者覆盖先写者）。所以网页端走**页面内**的 Cordis 只读服务 `petApi7340`
    // （src/client/pose.ts）——两边**字段名与坐标口径完全一致**（中心点归一化 0~1，与 /position
    // 同源），只是"取"的方式不同。
    //
    // 上报是**变化时推 + 节流**（拖拽 / 走位 / 抛掷 / position 指令 / turn 转身），不是轮询。
    //
    // 本端点**不要求 `surface`**：它是**读**端点（`GET /chat`、`GET /playback` 同样不带），而且它
    // 的定义域本身只有一个面。宠物配置上就不在桌面显示时用 `pet-not-displayed` 明说。
    if (rest === 'pose' || rest === 'pose/report') {
      const isReport = rest === 'pose/report';
      if (isReport && method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      if (!isReport && method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      // 协议层错误（非法 JSON）先报：与 /anim 同一顺序
      let parsedPose: unknown;
      if (isReport) {
        try {
          parsedPose = JSON.parse(body ?? 'null');
        } catch {
          return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
        }
      }
      try {
        const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
        if (!who.ok) return who.res;
        if (isReport) {
          const p = normalizePoseInput(parsedPose);
          if (!p.ok) return { kind: 'json', status: 200, obj: { ok: false, reason: p.reason, message: p.message } };
          pose.set(who.petId, p.pose);
          return { kind: 'json', status: 200, obj: { ok: true } };
        }
        // 桌面端实况只对"显示在桌面"的宠物有意义：配置上就不在桌面 → 明确不可用（附实际 display）
        const display = String(who.pet.display ?? '');
        if (!displayCovers('desktop', display)) {
          return {
            kind: 'json',
            status: 200,
            obj: {
              ok: false,
              reason: 'pet-not-displayed',
              message: who.petId + ' 的显示模式是 ' + display + '；桌面端实况只对 display 含 desktop 的宠物有',
              display,
            },
          };
        }
        const snap = pose.get(who.petId);
        if (snap === undefined) {
          return {
            kind: 'json',
            status: 200,
            obj: {
              ok: false,
              reason: 'pose-unavailable',
              message: '还没收到过这只宠物的桌面端实况（桌面端没起来，或刚重启还没来得及上报）',
            },
          };
        }
        return { kind: 'json', status: 200, obj: { ok: true, petId: who.petId, ...snap } };
      } catch (e) {
        // 配置读取失败等（安装损坏）→ 显式失败，不静默（与其他端点同一口径）
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 播放回执：/dsh-pet-7340/playback/<id>        （GET 查询，可挂起等待）
    //           /dsh-pet-7340/playback/<id>/report （POST，**渲染端上报**）
    //
    // 记录由**渲染端上报驱动**（见 ./playback）：host 只知道"受理了"，不知道播没播完——
    // 所以没有 /report 就没有真实回执，查询永远停在 accepted。
    // 与 S 无关：播放记录是 per-caller 资源（只有发起那次点播的调用方关心、有生命周期、
    // 数量随第三方调用方增长），放进 1s 全局广播会让每个窗口为每个功能付流量。
    // 前缀守卫写成**字面量比较**：一是把正则尝试限定在 playback 段（更快、边界更明确），
    // 二是让 scripts/check-openapi.mjs 的「文档 ↔ 路由实现」对齐检查能认出这条路由
    //（它靠 rest 与单引号段名的字面量比较从实现里提取路由，纯正则形式的匹配它看不见；
    //  注意注释里别把那个比较原样写出来，会被同一条正则当成一条真实路由）。
    const playbackPath = rest === 'playback' || rest.startsWith('playback/') ? parsePlaybackPath(rest) : undefined;
    if (playbackPath) {
      const playbackId = playbackPath.playbackId;
      // ---- 上报（渲染端 → host）：开始播 / 播完 / 失败 / 被打断时各来一次 ----
      if (playbackPath.isReport) {
        if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
        let reported: unknown;
        try {
          reported = JSON.parse(body ?? 'null');
        } catch {
          return { kind: 'json', status: 400, obj: { error: 'invalid JSON body' } };
        }
        const o = reported && typeof reported === 'object' ? (reported as Record<string, unknown>) : {};
        const outcome = playback.report(playbackId, o.status, o.reason);
        if (outcome === 'unknown') return { kind: 'json', status: 404, obj: { error: 'unknown playback' } };
        if (outcome === 'invalid') return { kind: 'json', status: 400, obj: { error: 'invalid status' } };
        // ok / ignored 都回 200：上报是幂等的，"已经这样了"对上报方就是成功
        // （迟到的 ended 不许覆盖 cancelled——终态保护在 ./playback 里）
        return { kind: 'json', status: 200, obj: { ok: true } };
      }
      // ---- 查询（第三方调用方）----
      if (method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      const record = playback.get(playbackId);
      if (!record) return { kind: 'json', status: 404, obj: { error: 'unknown playback' } };
      const parsed = parseWaitQuery(url.searchParams.get('wait'), url.searchParams.get('timeout'));
      if (parsed.kind === 'error') return { kind: 'json', status: 400, obj: { error: parsed.error } };
      // 两者都没传 = 立刻返回（兜底 / 调试 / 只想知道当下状态的调用方）
      if (parsed.kind === 'none') {
        return { kind: 'json', status: 200, obj: { ...record, matched: false } };
      }
      const { wait: waitList, timeoutMs } = parsed;
      // 已经是等的状态之一 → 立刻返回，别白等一整个 timeout
      if (waitList.includes(record.status)) {
        return { kind: 'json', status: 200, obj: { ...record, matched: true } };
      }
      // 挂起等待：状态进入 wait 集合立刻唤醒（matched:true）；到点回当时的记录（matched:false）。
      // timeout=0 时 playback.wait 下一拍就唤醒，等价"立刻返回"，这里不特判。
      return await new Promise<RouteResult>((resolveWait) => {
        let settled = false;
        /** 收尾：只认第一次（唤醒 / 超时 / 取消 / 调用方断开 都可能先后到达） */
        const settle = (result: RouteResult): void => {
          if (settled) return;
          settled = true;
          resolveWait(result);
        };
        const cancel = playback.wait({
          playbackId,
          wait: waitList,
          timeoutMs,
          // 唤醒时**不需要**再取消：store 在回调前已把等待者摘掉（超时定时器也清了）
          onWake: (r, matched) => settle({ kind: 'json', status: 200, obj: { ...r, matched } }),
        });
        // get 之后记录被清理（极端竞态）→ 立刻 404，不挂
        if (cancel === undefined) {
          settle({ kind: 'json', status: 404, obj: { error: 'unknown playback' } });
          return;
        }
        // 调用方断开：取消等待者（清掉它的超时定时器），以"无需应答"收尾。
        // 监听不摘也无妨：signal 只被这次请求持有，请求结束后整条引用链一起回收。
        const onAbort = (): void => {
          cancel();
          settle({ kind: 'none' });
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    // 手动压缩记忆：POST /dsh-pet-7340/chat/compress?pet=<id>
    //   把「尚未摘要」的早期对话压成一段摘要（自动压缩之外的手动入口；右键菜单「压缩记忆」调它）。
    //   与 /chat 的 POST 共用 withMemoryLock：否则手动压缩与正在进行的对话会各自 read-modify-write，
    //   后写的那个把前一个的结果覆盖掉（对话丢了回复 / 压缩丢了摘要）。
    //   放在 `rest === 'chat'` 之前：两者是**精确匹配**，顺序其实无所谓，但把子路径写在父路径前面
    //   读起来不会让人以为 /chat/compress 会掉进 /chat 分支。
    if (rest === 'chat/compress') {
      if (method !== 'POST') {
        return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      }
      try {
        const cfg = readAllConfig(configPaths);
        const who = requirePet(url.searchParams, () => cfg);
        if (!who.ok) return who.res;
        const result = await withMemoryLock(async () => {
          // 锁内**重新读配置与记忆**：进锁前排的队可能等了几十秒，期间用户可能改了压缩阈值
          // 或把这只宠物删了。用锁外那份快照会让"刚被删掉的宠物"照样被压缩并写回分桶。
          const cfgNow = readAllConfig(configPaths);
          const foundNow = findPetInstance(cfgNow, who.petId);
          if (!foundNow) return { ok: false as const, reason: 'unknown-pet', message: '没有这只桌宠：' + who.petId };
          const mem = await readMemory();
          const entry = memoryEntryOf(mem, foundNow.entry, who.petId);
          const r = await compressMemory(mem, entry, foundNow.conf, { force: true });
          // 回执同时写进 S 的 say 叶子：手动压缩是**用户主动点的**，必须有个看得见的答复，
          // 否则点完什么都没发生，用户只会以为菜单坏了。走 S 而不是本地 DOM——
          // 与碎碎念/对话回复同一条展示链路，浏览器端点了菜单也能看到（单一数据出口）。
          if (!r.ok) {
            const msg =
              r.reason === 'nothing-to-compress'
                ? '还没有需要压缩的对话'
                : r.reason === 'provider-missing'
                  ? '压缩失败：当前没有可用的模型'
                  : '压缩失败：' + r.reason;
            state.writePet(who.petId, 'say', { text: msg });
            return { ok: false as const, reason: r.reason, message: msg };
          }
          const o = r.overview;
          state.writePet(who.petId, 'say', {
            text: `记忆已压缩：${o.summarized} 条旧对话 → ${o.summary.length} 字摘要`,
          });
          return { ok: true as const, memory: o };
        });
        return { kind: 'json', status: 200, obj: result };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 实例级人设卡：GET/POST /dsh-pet-7340/pet-persona?pet=<id>
    //   独立模式的设置页没有 DSH 插件那套「配置面板」，人设（pets[].whisperPrompt）在那里
    //   完全无从写入，用户只能手改 JSON 文件——这就是「网页配置页面没有写人设卡的地方」。
    //   本端点只做一件很窄的事：读/写**某一只**宠物的实例级 whisperPrompt，
    //   写入语义与 PUT /config 完全一致（saveUserConfig 白名单重建 + existing 透传），
    //   空串 = 删除覆盖（回落到所属条目的人设），与设置页"清空即删"的语义一致。
    if (rest === 'pet-persona') {
      if (method !== 'GET' && method !== 'POST') {
        return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      }
      try {
        const cfg = readAllConfig(configPaths);
        const who = requirePet(url.searchParams, () => cfg);
        if (!who.ok) return who.res;
        const petId = who.petId;
        if (method === 'GET') {
          const own = who.pet.whisperPrompt;
          return {
            kind: 'json',
            status: 200,
            obj: {
              ok: true,
              pet: { id: petId, name: String(who.pet.name ?? ''), display: String(who.pet.display ?? '') },
              // 实例级覆盖（可能为空 = 没有覆盖）
              persona: typeof own === 'string' ? own : '',
              // 所属条目级人设：让设置页能显示"留空时实际生效的是哪一段"
              entryPersona: typeof who.conf.whisperPrompt === 'string' ? who.conf.whisperPrompt : '',
              // 最终生效的 system（含名字行与时间背景），供设置页预览
              system: petSystemPrompt({ conf: who.conf, pet: who.pet }),
            },
            headers: { 'cache-control': 'no-cache, no-store' },
          };
        }
        const parsed = (JSON.parse(body ?? 'null') as Record<string, unknown> | null) ?? {};
        const raw = parsed.persona;
        if (raw !== undefined && raw !== null && typeof raw !== 'string') {
          return {
            kind: 'json',
            status: 200,
            obj: { ok: false, reason: 'bad-request', message: 'persona 必须是字符串' },
          };
        }
        const next = typeof raw === 'string' ? raw.trim() : '';
        // 人设**不设长度上限**（2026-10-27 用户明确要求）。
        //
        // 理由：人设是用户自己的创作，写多长、每次多花多少 token 是他们自己的取舍，
        // 产品不该替他们定上限。这里原先硬拒 >4000 字，导致用户贴一份完整角色卡
        // （实测 哥伦比娅.txt 2323 字 / 纳西妲.txt 1935 字，但更长的设定集轻松破万）
        // 会被静默拒绝。
        //
        // 唯一保留的边界是**结构性**的：必须是字符串、非空才写、空串表示删除覆盖。
        // 真正的兜底交给下游——模型上下文超限时由 provider 报错，那才是准确的位置。 
        // 与 /pet-display 同一条写盘路径：找到目标层 → 整段替换该层 pets（只改目标那只）
        let layerPath: string;
        let layerDir: string;
        let existing: Record<string, unknown> | undefined;
        if (who.entry === 'main') {
          layerPath = userConfigPath;
          layerDir = userRoot;
          existing = readUserConfig(configPaths);
        } else {
          const file = readPetConfigEntry(configPaths, who.entry);
          if (!file) {
            return {
              kind: 'json',
              status: 200,
              obj: { ok: false, reason: 'generate-error', message: `宠物条目配置文件找不到：${who.entry}` },
            };
          }
          layerPath = file.path;
          layerDir = petConfigDir;
          existing = file.raw;
        }
        const layerPets = Array.isArray(who.conf.pets) ? (who.conf.pets as Record<string, unknown>[]) : [];
        const pets = layerPets.map((p) => {
          if (String(p.id) !== petId) return p;
          const copy = { ...p };
          if (next) copy.whisperPrompt = next;
          else delete copy.whisperPrompt;
          return copy;
        });
        const clean = saveUserConfig({ pets }, existing);
        if (!clean) {
          return {
            kind: 'json',
            status: 200,
            obj: { ok: false, reason: 'bad-request', message: '宠物配置非法' },
          };
        }
        await mkdir(layerDir, { recursive: true });
        await writeFile(layerPath, JSON.stringify(clean, null, 2), 'utf8');
        // 人设不进窗口几何，无需对账；但要让浏览器端知道"配置版本变了"
        state.writeSection('config', {});
        const after = readAllConfig(configPaths);
        const hit = findPetInstance(after, petId);
        return {
          kind: 'json',
          status: 200,
          obj: {
            ok: true,
            persona: next,
            system: hit ? petSystemPrompt(hit) : '',
          },
        };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 对话历史（压缩前原文 + 压缩后摘要）：GET /dsh-pet-7340/chat/history?pet=<id>
    //   与 GET /chat 的区别：那边只给"当前还在上下文里的窗口"（已摘要的部分**不返回**），
    //   这里给**全量**原始消息 + 那段摘要本身，供设置页的「对话历史」页对照查看。
    //   只读，不改任何状态；分页用 ?limit=（默认 200，上限 2000）+ ?offset=。
    if (rest === 'chat/history') {
      if (method !== 'GET') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      try {
        const cfg = readAllConfig(configPaths);
        const who = requirePet(url.searchParams, () => cfg);
        if (!who.ok) return who.res;
        const petId = who.petId;
        const mem = await readMemory();
        const rawEntry = mem[who.entry]?.[petId];
        const rawMessages = rawEntry?.messages;
        const all = Array.isArray(rawMessages)
          ? rawMessages.filter((m) => m && typeof m.content === 'string')
          : [];
        const offsetRaw = Number(url.searchParams.get('offset') ?? '0');
        const limitRaw = Number(url.searchParams.get('limit') ?? '200');
        const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 200;
        const summarized = rawEntry ? summarizedOf(rawEntry) : 0;
        return {
          kind: 'json',
          status: 200,
          obj: {
            ok: true,
            pet: { id: petId, name: String(who.pet.name ?? '') },
            // 全量原文（含已被摘要覆盖的那部分——那正是「压缩前原文」）
            total: all.length,
            offset,
            limit,
            messages: all.slice(offset, offset + limit).map((m, i) => ({
              role: String(m.role ?? ''),
              content: String(m.content ?? ''),
              ts: typeof m.ts === 'number' ? m.ts : undefined,
              // 是否已被压缩（下标 < summarized 即已进摘要）
              summarized: offset + i < summarized,
            })),
            // 压缩后摘要（同一份 overviewOf，与 /chat 一致）
            memory: rawEntry ? overviewOf(rawEntry) : overviewOf({ messages: [] }),
            // 摘要覆盖的原文段落：给设置页做"原文 ↔ 摘要"对照用
            summarizedCount: summarized,
          },
          headers: { 'cache-control': 'no-cache, no-store' },
        };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 助手 / 读屏的开关读写：/dsh-pet-7340/assistant/settings
    //   GET  —— 当前 5 个字段 + 每只宠物的工作区绝对路径（设置页「读屏与助手」区用）
    //   POST —— { screenContextEnabled?, screenExcludePatterns?, assistantEnabled?,
    //             assistantPermission?, assistantNetworkEnabled? } 部分更新
    // 为什么单独一条而不是走 /config：设置页只该改这几个字段，走 /config 的整包 PUT
    // 要求调用方先拿到并回传完整 pets 数组，漏一个字段就可能把用户配置改坏。
    if (rest === 'assistant/settings') {
      const cfgNow = readAllConfig(configPaths);
      const mainNow = cfgNow.main ?? {};
      if (method === 'GET') {
        const pets = flattenPetList(cfgNow).map((p) => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? ''),
          workspace: resolvePetWorkspace(assistantWorkspace, String(p.id ?? '')),
        }));
        return {
          kind: 'json',
          status: 200,
          obj: {
            ok: true,
            screenContextEnabled: mainNow.screenContextEnabled === true,
            screenExcludePatterns: Array.isArray(mainNow.screenExcludePatterns)
              ? mainNow.screenExcludePatterns
              : [],
            assistantEnabled: mainNow.assistantEnabled === true,
            assistantPermission: isAssistantPermission(mainNow.assistantPermission)
              ? mainNow.assistantPermission
              : 'readonly',
            assistantNetworkEnabled: mainNow.assistantNetworkEnabled !== false,
            workspaceRoot: assistantWorkspace,
            pets,
            /** 读屏能力是否可用（pwsh 找不到时为 false，设置页据此禁用开关并说明原因） */
            /** 读屏能力是否可用（脚本随包存在 + 系统有 PowerShell；否则设置页禁用开关并说明） */
            screenAvailable: screenReaderAvailable(join(PACKAGE_ROOT, 'runtime', 'electron-helper', 'uia-reader.ps1')),
          },
          headers: { 'cache-control': 'no-cache, no-store' },
        };
      }
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let patch: Record<string, unknown>;
      try {
        patch = JSON.parse(body ?? 'null') as Record<string, unknown>;
      } catch {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: '请求体不是合法 JSON' } };
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: '请求体必须是对象' } };
      }
      // 逐字段校验（与读取侧同一套 topFieldValid 语义），非法值直接拒，不做部分写入
      //
      // ⚠️ pets 必须取**用户层原文**，不能取合并结果 `cfgNow.main.pets`：
      // 合并器会把默认值填满每只宠物，把那份写回用户层等于把默认值固化成用户的显式设置，
      // 以后改内置默认就再也影响不到这个用户了（与 /pet-persona「整段替换该层 pets」同一口径）。
      const existing = readUserConfig(configPaths);
      const existingPets = Array.isArray(existing?.pets)
        ? (existing.pets as unknown[])
        : Array.isArray(cfgNow.main?.pets)
          ? (cfgNow.main.pets as unknown[])
          : [];
      const next: Record<string, unknown> = { pets: existingPets };
      for (const key of [
        'screenContextEnabled',
        'screenExcludePatterns',
        'assistantEnabled',
        'assistantPermission',
        'assistantNetworkEnabled',
      ]) {
        if (patch[key] === undefined) continue;
        next[key] = patch[key];
      }
      const saved = saveUserConfig(next, existing);
      if (!saved) {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: '提交的值不合法' } };
      }
      try {
        await mkdir(dirname(userConfigPath), { recursive: true });
        await writeFile(userConfigPath, JSON.stringify(saved, null, 2) + '\n', 'utf8');
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
      // 权限档位变了 → 之前的一次性授权必须失效（降权后旧授权不能继续用）
      assistantGrants.clear();
      state.writeSection('config', {});
      // 配置变更后按新设置重建各宠物工作区（新加的宠物也要有目录）
      for (const p of flattenPetList(readAllConfig(configPaths))) {
        void ensurePetWorkspace(String(p.id ?? ''));
      }
      return { kind: 'json', status: 200, obj: { ok: true } };
    }

    // 助手操作记录：/dsh-pet-7340/assistant/history
    //   GET    —— ?limit=N（默认 100，上限 1000）返回最近 N 条，新的在前
    //   DELETE —— 清空全部记录
    // 记录内容见 assistant/history.ts 的文件头注释（存什么、不存什么、体积边界）。
    if (rest === 'assistant/history') {
      if (method === 'GET') {
        const limitRaw = Number(url.searchParams.get('limit') ?? '100');
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 100;
        const items = await readRecords(assistantHistoryPaths, limit);
        const total = await countRecords(assistantHistoryPaths);
        return {
          kind: 'json',
          status: 200,
          obj: { ok: true, total, limit, items },
          headers: { 'cache-control': 'no-cache, no-store' },
        };
      }
      if (method === 'DELETE') {
        const ok = await clearRecords(assistantHistoryPaths);
        return { kind: 'json', status: 200, obj: ok ? { ok: true } : { ok: false, message: '清空失败' } };
      }
      return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
    }

    // 助手待审批队列：/dsh-pet-7340/assistant/approvals
    //   GET  —— 列出待审批的越权动作（设置页轮询/打开时拉一次）
    //   POST —— { id, allow: true|false } 处理一条：允许 = 记一次性授权并按原指令重放；拒绝 = 只删掉
    // 设计意图：越权动作**不静默失败**。用户能看到「它想干什么、想改哪个文件」，
    // 由人来决定这一次是否放行；批准只覆盖这一个动作这一个路径，不是永久开洞。
    if (rest === 'assistant/approvals') {
      if (method === 'GET') {
        return {
          kind: 'json',
          status: 200,
          obj: {
            ok: true,
            workspace: assistantWorkspace,
            items: [...pendingApprovals.values()]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((a) => ({
                id: a.id,
                petId: a.petId,
                tool: a.tool,
                target: a.target,
                reason: a.reason,
                message: a.message,
                createdAt: a.createdAt,
              })),
          },
          headers: { 'cache-control': 'no-cache, no-store' },
        };
      }
      if (method !== 'POST') return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      let parsed: { id?: unknown; allow?: unknown };
      try {
        parsed = JSON.parse(body ?? 'null') as { id?: unknown; allow?: unknown };
      } catch {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: '请求体不是合法 JSON' } };
      }
      const id = String(parsed?.id ?? '');
      const item = pendingApprovals.get(id);
      if (!item) {
        return { kind: 'json', status: 200, obj: { ok: false, reason: 'unknown-approval', message: '这条审批不存在或已处理' } };
      }
      pendingApprovals.delete(id);
      if (parsed?.allow !== true) {
        return { kind: 'json', status: 200, obj: { ok: true, allowed: false } };
      }
      // 允许：只放行「这个工具 + 这个目标路径」一次，然后按原用户指令重放整轮
      assistantGrants.grant(item.tool, item.target);
      try {
        const replayed = await chatWithPet(item.petId, item.userText);
        return {
          kind: 'json',
          status: 200,
          obj: replayed.ok
            ? { ok: true, allowed: true, text: replayed.text }
            : { ok: false, allowed: true, reason: replayed.reason, message: replayed.message },
        };
      } catch (e) {
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, allowed: true, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 对话：/dsh-pet-7340/chat?pet=<id>
    //   GET  —— 最近记忆窗口（截尾 chatMemoryRounds 轮），弹窗打开时展示（一次性读，不是轮询）
    //   POST —— 携带历史生成回复并写入记忆；回 {ok,text,image?}，回复同样写 S 的 pets.<id>.say
    // 记忆唯一读写方 = host（memory.json；浏览器/桌面两端都只是客户端）→
    // 同一实例的浏览器与桌面天然共享同一份记忆；文件全存不删，
    // 请求只截尾部 chatMemoryRounds 轮（1 轮 = 1 问 1 答；合并器已按条目填默认）。
    if (rest === 'chat') {
      if (method !== 'GET' && method !== 'POST') {
        return { kind: 'json', status: 405, obj: { error: 'method not allowed' } };
      }
      try {
        // `?rounds=`：GET 专属的查看参数——只决定这次读多少轮（不写记忆，也不改变后续对话
        // 往上下文里带多少，所以 POST 不认它）。与 surface 同一处境：参数级校验放在读盘之前。
        const roundsRaw = method === 'GET' ? url.searchParams.get('rounds') : null;
        let roundsOverride: number | null = null;
        if (roundsRaw !== null && roundsRaw.trim() !== '') {
          const n = Number(roundsRaw);
          if (!Number.isInteger(n) || n < 0 || n > 200) {
            return {
              kind: 'json',
              status: 200,
              obj: { ok: false, reason: 'bad-request', message: 'rounds 必须是 0–200 的整数（不传则用配置）' },
            };
          }
          roundsOverride = n;
        }
        // pet **必填**且必须真实存在：收紧前这里是 `?? ''`——人设/配图按 main 条目取，记忆会以那个
        // （不存在的）id 新建一个分桶，回复写进没人消费的 `pets[""].say`，还回 ok:true。
        // 惰性 + 记忆化：pet 空串时完全不读配置；GET 分支复用同一次读取。
        let cfgCache: Record<string, Record<string, unknown>> | undefined;
        const cfg = (): Record<string, Record<string, unknown>> => (cfgCache ??= readAllConfig(configPaths));
        // surface 只对 POST 校验：GET 是读记忆，跟宠物显示在哪一端无关
        const who = requirePet(url.searchParams, cfg, { surface: method === 'POST' });
        if (!who.ok) return who.res;
        const petId = who.petId;
        if (method === 'GET') {
          const mem = await readMemory();
          const rawEntry = mem[who.entry]?.[petId];
          const rawMessages = rawEntry?.messages;
          // 记忆文件是合法 JSON 但 messages 不是数组时，slice() 会抛 slice is not a function：
          // 按空历史处理并记一行日志，不因为一条坏数据让整个历史接口报错。
          const list = Array.isArray(rawMessages) ? rawMessages.filter((m) => m && typeof m.content === 'string') : [];
          if (rawMessages !== undefined && !Array.isArray(rawMessages)) {
            log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按空历史处理：${memoryPath}`);
          }
          // 传了 ?rounds= 就用传的（含 0 = 空历史），没传才回落到配置
          const rounds = roundsOverride ?? memoryRounds(who.conf);
          // 与 chatWithPet 同一语义：rounds = 0 → 空历史（slice(-0) 会返回整个数组，见上）。
          // 已摘要部分不进 messages 返回：弹窗展示的是"当前还在上下文里的对话"，摘要另由 memory 字段给出。
          const summarized = rawEntry ? summarizedOf(rawEntry) : 0;
          const messages = sliceMemoryRounds(list.slice(summarized), rounds);
          // memory：记忆概览（摘要正文 + 游标 + 待压缩轮数）。老文件没有摘要字段 → 全零/空串，
          // 前端据此决定要不要显示"已压缩 N 条"与"压缩记忆"按钮的可用态。
          const memory = rawEntry ? overviewOf(rawEntry) : overviewOf({ messages: [] });
          return { kind: 'json', status: 200, obj: { ok: true, messages, rounds, memory } };
        }
        if (method === 'POST') {
          const parsed = (JSON.parse(body ?? 'null') as Record<string, unknown> | null) ?? {};
          const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
          if (!text) {
            return { kind: 'json', status: 200, obj: { ok: false, reason: 'bad-request', message: '消息为空' } };
          }
          if (text.length > 2000) {
            return {
              kind: 'json',
              status: 200,
              obj: { ok: false, reason: 'bad-request', message: '消息过长（限 2000 字）' },
            };
          }
          const result = await chatWithPet(petId, text);
          return { kind: 'json', status: 200, obj: result };
        }
      } catch (e) {
        // 配置已由 readAllConfig 保证正确（不再有 config-error 分支）；其余（IO/LLM）→ generate-error
        return {
          kind: 'json',
          status: 200,
          obj: { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    // 动画文件：/dsh-pet-7340/thumb/<素材根>/<file>，扩展名 webm（默认）/ mov（macOS 定制）。
    // 素材归属按「是否存在该宠物的独立素材目录 `pet/<petId>-animation/`」判定：
    //   - 存在（pet pack 宠物）：只查自己的目录，查不到即 404 显式报错——绝不混用
    //   - 不存在（**所有主配置宠物**，main 与用户添加的任意多只）：主素材链
    //     main-animation/<webm|mov> 优先 → 包内 assets/<webm|mov>（与宠物数量无关，多只共用）
    // mov（HEVC-with-Alpha）为 macOS Safari/WKWebView 定制格式：默认不随包发布，
    // 用户从 GitHub Release（assets-mov）下载后放 main-animation/mov/，并把客户端播放
    // 扩展名常量（src/shared/constants.ts 的 ANIMATION_EXT / 产物 lib/client.js）改为 .mov。
    // 注意：font / pic 是扁平的 /<scope>/<file>，只有 thumb 是 /<scope>/<petId>/<file>——
    // 这里先拆 scope，再按 scope 各自拆剩余段，避免 font/pic 被误当作 petId 吞掉文件段。
    const [scope, ...restParts] = rest.split('/');
    if (scope === 'font') {
      const fontRoot = join(PACKAGE_ROOT, 'assets', 'fonts');
      const fontFile = resolveExisting(fontRoot, restParts.join('/'));
      if (fontFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: font not found' };
      const ext = fontFile.slice(fontFile.lastIndexOf('.')).toLowerCase();
      return { kind: 'file', file: fontFile, contentType: MIME[ext] ?? 'application/octet-stream' };
    }

    // 通知图标：/dsh-pet-7340/pic/<file> → 包内 assets/pic（方形 png，系统通知 icon 用）
    // 表情包：/dsh-pet-7340/pic/memes/<素材根>/<名称>.png → 按素材根走 memeDirsFor 的目录链
    // （种类独占目录 → 用户目录 → 包内），与 /thumb 同一套素材归属语义；名称含中文，URL 段已在上方解码。
    // 旧的两段形式 /pic/memes/<名称>.png 保留：等价于素材根 main 的目录链（未升级的客户端照常取到包内图）。
    if (scope === 'pic') {
      if (restParts[0] === 'memes') {
        const segs = restParts.slice(1);
        // 段数 ≥ 2 = <素材根>/<名称…>；恰好 1 段 = 旧扁平形式。表情包名称即文件名（不含子目录），
        // 所以两种形式不歧义；素材根与 /thumb 的 petId 同规矩：含分隔符 / 保留字符即显式 400。
        const scoped = segs.length >= 2;
        const assetRoot = scoped ? segs[0] : 'main';
        if (scoped && (assetRoot.length > 64 || ID_FORBIDDEN.test(assetRoot))) {
          return { kind: 'text', status: 400, body: 'dsh-pet: invalid asset root' };
        }
        const rel = (scoped ? segs.slice(1) : segs).join('/');
        let picFile: string | undefined;
        for (const dir of memeDirsFor(assetRoot)) {
          picFile = resolveExisting(dir, rel);
          if (picFile !== undefined) break;
        }
        if (picFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: pic not found' };
        const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
        return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
      }
      const picRoot = join(PACKAGE_ROOT, 'assets', 'pic');
      const picFile = resolveExisting(picRoot, restParts.join('/'));
      if (picFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: pic not found' };
      const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
      return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
    }

    // 点击音效：/dsh-pet-7340/sound/<file> → 包内 assets/sound（当前只有 click-duck.wav）。
    // 与 font 同一种扁平形式（<scope>/<file>）：只有包内一份，不做用户目录覆盖。
    if (scope === 'sound') {
      const soundRoot = join(PACKAGE_ROOT, 'assets', 'sound');
      const soundFile = resolveExisting(soundRoot, restParts.join('/'));
      if (soundFile === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: sound not found' };
      const ext = soundFile.slice(soundFile.lastIndexOf('.')).toLowerCase();
      return { kind: 'file', file: soundFile, contentType: MIME[ext] ?? 'application/octet-stream' };
    }

    if (scope !== 'thumb') {
      return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>' };
    }
    // thumb 是三段式：/<scope>/<petId>/<file>——从这里再拆宠物 id 与文件名
    const [petId, ...nameParts] = restParts;
    if (!petId || nameParts.length === 0) {
      return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>' };
    }
    // petId 是**标识符**（= pet/<名>-animation/ 的 <名>，来源是 pet/ 下的文件名前缀），不是路径片段：
    // 含分隔符/保留字符即显式 400，早于任何路径拼接判定。合法名（含中文）照常——
    // 用非法字符类而不是 ASCII 白名单。非法输入不再静默回落到主素材池（攻击尝试与"没有独立素材"可区分），
    // 也给下面的 resolveAsset 之外再留一道结构性防线。
    if (ID_FORBIDDEN.test(petId)) {
      return { kind: 'text', status: 400, body: 'dsh-pet: invalid pet id' };
    }
    const fileName = nameParts.join('/');
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (ext !== '.webm' && ext !== '.mov') {
      return { kind: 'text', status: 400, body: 'dsh-pet: unsupported animation format (expected .webm or .mov)' };
    }
    // 素材归属（按是否存在该宠物的独立素材目录判定，绝不静默混用）：
    //   - 存在 `pet/<petId>-animation/`（pet pack 宠物，URL 段 = 素材根 assetRoot）：
    //     只查自己的目录，查不到即 404 显式报错——绝不回落**别的素材**
    //     （唯一例外：同名的 webm/mov 互换，即下方 mov 缺失时退回 webm）
    //   - 不存在（**所有主配置宠物**：main 及用户添加的任意多只，共用全局动画池）：
    //     主素材链——用户 main-animation/<ext 子目录> 优先，其次包内 assets/<ext 子目录>
    // extraAnimDir 必须先过 resolveAsset：petId 是解码后的 URL 段，Windows 上 %5C 解出的
    // 反斜杠不会被 rest.split('/') 切开，直接 join 会让 `..\..\x` 逃出用户根读盘。
    const extraAnimDir = resolveAsset(petConfigDir, petId + '-animation');
    /** 按扩展名查同名素材（专属目录优先；否则用户根 → 包内根） */
    const findAnim = (e: string): string | undefined => {
      const name = fileName.replace(/\.(webm|mov)$/i, '') + e;
      return extraAnimDir !== undefined && existsSync(extraAnimDir)
        ? resolveExisting(extraAnimDir, name)
        : (resolveExisting(userRootFor(e), name) ?? resolveExisting(assetRootFor(e), name));
    };
    let file = findAnim(ext);
    let servedExt = ext;
    // mov（HEVC-with-Alpha，macOS 定制）不随包发布：缺失时退回同名 webm。
    // 宿主是唯一知道素材在不在的一方——宁可让 Safari 播黑底（webm 的 alpha 被丢弃），
    // 也不能让整段动画 404（表现就是宠物完全不显示）。
    if (file === undefined && ext === '.mov') {
      const fb = findAnim('.webm');
      if (fb !== undefined) {
        file = fb;
        servedExt = '.webm';
      }
    }
    if (file === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: asset not found' };
    return { kind: 'file', file, contentType: MIME[servedExt] ?? 'application/octet-stream' };
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          // 挂起等待（/playback?wait=）期间调用方可能提前断开：据此中止等待，
          // 否则那个等待者要一直留到超时才回收。'close' 在正常应答后也会触发，但那时监听已摘掉。
          const abort = new AbortController();
          const onClose = (): void => abort.abort();
          res.on('close', onClose);
          try {
            const body = req.method === 'PUT' || req.method === 'POST' ? await readBody(req) : undefined;
            const result = await handlePetRoute(req.url ?? '/', req.method ?? 'GET', body, abort.signal);
            res.off('close', onClose);
            if (result.kind === 'json') sendJson(res, result.status, result.obj, result.headers);
            else if (result.kind === 'text') sendText(res, result.status, result.body);
            else if (result.kind === 'none') {
              /* 调用方已断开：不再写（写了会抛） */
            } else sendFile(res, result.file, result.contentType); // 非 async：流在 open 后自己 pipe，错误内部收口
          } catch (e) {
            res.off('close', onClose);
            // 连接已断（挂起等待被中止后也可能撞上）→ 不再写，避免二次抛错
            if (!res.destroyed && !res.writableEnded) {
              sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
            }
          }
        },
      }),
    'dsh-pet: /dsh-pet-7340 asset route',
  );

  // 工作状态联动：监听 DSH 会话事件 → 聚合"当前活动状态"（WorkStatusStore → 展示快照）。
  // 消费的事件：turn/start、user/message（goal 续跑轮判定）、tool/call（update_goal 收尾判定）、
  // tool/result、approval/asked、turn/end、todo/write（只更新任务详情文案，不切档位）。
  // 纯监听不调用模型；有宠物启用 workStatusEnabled 时才被浏览器侧消费（host 侧恒轻量监听）。
  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session: unknown, event: unknown) => {
      const type = (event as { type?: string } | null)?.type;
      if (!type) return;
      const sessionId = String(
        (session as { id?: unknown; header?: { id?: unknown } } | null)?.header?.id ??
          (session as { id?: unknown } | null)?.id ??
          'unknown',
      );
      if (type === 'todo/write') {
        // 任务详情文案：只写**该会话**的条目（state/task 同源，不再有全局字段，也就不可能串会话）。
        // 会话没有活动条目（已空闲/已清理）→ 不动：它不会被展示，写进去只会成为一条"幽灵文案"。
        // 清单里再无 in_progress/pending 时 currentTaskFromTodo 返回 null，等于把旧文案清掉、
        // 气泡回落到档位文案（issue #59 缺陷 3：档位文案不该被一条历史记录永久屏蔽）。
        const text = currentTaskFromTodo(event as { data?: { todos?: Array<{ status?: string; content?: string }> } });
        // 缓存无条件更新：工具跑完要靠它把气泡恢复回来（见下方 tool/call 的接线）
        lastTodoText.set(sessionId, text);
        // 工具正在执行时不覆盖气泡：「修改 index.ts」比清单里那句更能说明此刻在动什么
        if ((toolsInFlight.get(sessionId) ?? 0) > 0) return;
        if (workStatus.has(sessionId)) {
          workStatus.setTask(sessionId, text);
          publishWorkStatus(); // 任务文案变化也要写 S（气泡内容靠它更新）
        }
        return;
      }
      if (type === 'user/message') {
        // 目标续跑轮判定：自动轮的消息带 source.kind==='goal'（round>0），该轮属自动续跑，
        // 其 turn/end completed 只是"本轮完成"，不是整个任务完成
        const source = (event as { data?: { source?: { kind?: string } } })?.data?.source;
        if (source?.kind === 'goal') {
          const flags = turnFlags.get(sessionId) ?? { goalRound: false, closing: null };
          flags.goalRound = true;
          turnFlags.set(sessionId, flags);
        }
        return; // user/message 不驱动档位动画
      }
      if (type === 'turn/start') {
        turnFlags.set(sessionId, { goalRound: false, closing: null }); // 新一轮：清 turn 级标志
        // 新一轮也开始新的任务上下文：清掉上一轮留下的任务详情文案（issue #59），否则它会一直挂着。
        // 代价：goal 续跑这类多轮任务，每轮开头会回落一瞬档位文案，直到本轮（通常在开头几步内）
        // 再写一次 todo 清单。
        workStatus.setTask(sessionId, null);
        lastTodoText.delete(sessionId); // 上一轮的清单文案，不该被下一轮的工具跑完时「恢复」回来
        toolsInFlight.delete(sessionId); // 上一轮若有工具没等到 tool/result（被打断），别拖累这一轮
        publishWorkStatus(); // 清掉上一轮任务文案也要写 S
      }
      if (
        type === 'tool/call' &&
        String((event as { data?: { name?: unknown } })?.data?.name ?? '') === GOAL_UPDATE_TOOL
      ) {
        // update_goal complete/blocked = 本轮是该目标的收尾轮，其 completed 才是真完成
        const action = goalUpdateAction(String((event as { data?: { arguments?: unknown } })?.data?.arguments ?? ''));
        if (action) {
          const flags = turnFlags.get(sessionId) ?? { goalRound: false, closing: null };
          flags.closing = action;
          turnFlags.set(sessionId, flags);
        }
      }
      const next = reduceWorkStatus(
        event as { type?: string; data?: Record<string, unknown> & { reason?: { kind?: string } } },
        turnFlags.get(sessionId),
      );
      if (!next) {
        // turn/end 的 null（aborted / 未知 kind）＝该会话回合已结束：清掉会话状态，让展示回到空闲或
        // 落到其他活跃会话，防止回合被打断后永久卡在上一档；其他事件的 null 是"不关心"，忽略。
        if (type === 'turn/end') {
          turnFlags.delete(sessionId);
          cancelTerminalCleanup(sessionId); // 条目都要清了，别留一个到点后无事可做的定时器
          lastTodoText.delete(sessionId); // 按会话记的两份缓存跟着会话一起消失（防泄漏）
          toolsInFlight.delete(sessionId);
          workStatus.clear(sessionId); // 条目连同任务详情文案一起消失（clear 内部会重算展示）
          publishWorkStatus(); // 回合被打断 → 回到空闲：前端据此收起常驻气泡
        }
        return;
      }
      const seq = Number((event as { seq?: unknown }).seq ?? 0);
      // 工具详情（「修改 index.ts」这类具体描述）：比通用档位文案有用得多，workStatusEnabled
      // 的宠物直接把它当气泡文本。
      // **必须在 setState 之后写**：`setTask` 要求会话条目已存在（work-status.ts:229），而条目
      // 正是 setState 建出来的——顺序反了这一句会被静默丢弃（不报错，最难查的那种）。
      const detail =
        type === 'tool/call' ? toolDetailFromEvent(event as { data?: { name?: unknown; arguments?: unknown } }) : null;
      const changed = workStatus.setState(sessionId, next, seq);
      if (detail !== null) {
        // 有具体描述才「占位」：占位期间 todo/write 不覆盖它（见 todo/write 分支）
        bumpToolsInFlight(sessionId, 1);
        workStatus.setTask(sessionId, detail);
      } else if (type === 'tool/result') {
        if ((toolsInFlight.get(sessionId) ?? 0) > 0) bumpToolsInFlight(sessionId, -1);
        // 占位全清空：把气泡还给最近一条 todo 文案（没有就 null → 回落档位文案）
        if ((toolsInFlight.get(sessionId) ?? 0) === 0) {
          workStatus.setTask(sessionId, lastTodoText.get(sessionId) ?? null);
        }
      }
      publishWorkStatus(); // 档位或文案变了 → 写 S（内容没变时它自己会短路，不产生多余写入）
      // 同会话同状态不重复更新（防刷屏）：写已经落定，这里只负责跳过终态清理的重排
      if (!changed) return;
      // 终态只展示短暂窗口后自动清理：陈旧完成态不再浮上来（Bug 3 的一环，顺带缓解 Bug 2 残留）。
      // 回到非终态则取消那次待执行的清理——否则它到点时会话已非终态，既不清也不重排，
      // 条目（连同旧任务文案）就永久留下了。
      if (next === 'success' || next === 'error') scheduleTerminalCleanup(sessionId);
      else cancelTerminalCleanup(sessionId);
    });
    return () => {
      dispose();
      for (const t of terminalTimers.values()) clearTimeout(t);
      terminalTimers.clear();
    };
  }, 'dsh-pet: work-status session events');

  // 系统通知：监听 DSH 宿主事件 → 生成通知帧入队（浏览器轮询 /state 读到后弹 toast）。
  // 与 work-status 同一 session/event 源，但职责各自独立（通知帧 = 事件 → toast 的一对一映射，
  // 不做状态聚合）。帧契约与 shared/notify.ts 完全一致，浏览器侧映射零改动。
  //   事件源：turn/end（完成/失败/截断）、approval/asked（权限申请）、
  //          tool/call（ask_user_question：用户选择）、agent/error（无回合位置失败，0.1.5 新增）。
  //   两道门：会话门 #82（shouldNotifySession：子代理/委派不发）+ 活动门 #114（只拦「对话完成」，
  //          延迟确认这条会话确实没活了再弹，见上方 scheduleCompletionNotify）。
  // 纯监听不调用模型；通知是浏览器网页端能力，桌面模式不消费本队列（不影响任何宠物行为）。
  ctx.effect(() => {
    const sessionDispose = ctx.on(
      'session/event',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session: any, event: any) => {
        // 会话门（issue #82）：子代理 / 委派会话不发通知——你等的是父对话，不是某一路子代理跑完。
        // 判据用 header.origin（不是 parentSession，那会把普通 fork 的主对话一起静音），
        // 判据不可用时放行，绝不把通知整体打哑。详见 notify-events.ts 的 shouldNotifySession。
        if (!shouldNotifySession(session)) return;
        // 活动门（issue #114）：「对话完成」延迟确认这条会话确实没活了再弹——团队会话里 Lead 的
        // 这一轮结束 ≠ 团队收工，成员还在跑时弹「对话完成」是误报。生成失败/输出截断、权限申请、
        // 用户选择不过这道门，直接放行（理由见 notify-events.ts 的 isCompletionTurnEnd）。
        if (isCompletionTurnEnd(event)) {
          scheduleCompletionNotify(sessionIdOf(session), event);
          return;
        }
        const frame = reduceNotifyFrame(event as Parameters<typeof reduceNotifyFrame>[0]);
        // 帧带上"这条通知是哪条会话发出的"：点击时网页据此跳到那条会话（见 withSessionId）
        if (frame) pushNotifyFrame(withSessionId(frame, sessionIdOf(session)));
      },
    );
    // agent/error（agent-loop dispatch.emit）：无回合位置的生成失败；0.1.5 新增，
    // 旧版无此事件 = 少一条通知（turn/end error 分支已覆盖大部分失败场景），不报错。
    // **两道门都管不到它**：载荷只有 { turn, step, error }，不带会话标识，无从判定来源。
    const errorDispose = ctx.on(
      'agent/error',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        pushNotifyFrame(agentErrorFrame(payload?.error));
      },
    );
    return () => {
      // 卸载时清掉待查的定时器：否则插件已卸载，到点还去写一次 S
      for (const t of notifyActivityTimers.values()) clearTimeout(t);
      notifyActivityTimers.clear();
      sessionDispose();
      errorDispose();
    };
  }, 'dsh-pet: notify frames');

  // /balance 斜杠命令：触发一次余额刷新（写 S → 前端 1s 轮询看到后弹气泡）。
  // fire-and-forget：回执不等外部 API（查询可能要几秒），立刻回；结果一律从 S 看
  // （成功播档位动画 + 余额气泡；服务商不支持 / 缺凭证 / 抓取失败则弹文字说明气泡，绝不静默）。
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'balance',
        description: '手动触发桌宠余额显示（立即弹出余额气泡）',
        handler: () => {
          void refreshBalance(true); // manual：命令是用户主动敲的
          return { kind: 'success', text: '已触发桌宠余额显示' };
        },
      }),
    'dsh-pet: /balance command',
  );

  // 余额周期刷新：host 侧唯一定时器（前端不再有任何余额定时器）。
  // 周期**每次重新读配置** eventsRefreshSec.balance → 改了配置下一拍自然跟上。
  // 没有任何启用余额的宠物时跳过查询：尊重配置，不白花外部 API 调用。
  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function arm(sec: number): void {
      if (disposed) return;
      timer = setTimeout(() => void tick(), Math.max(1000, sec * 1000));
    }
    async function tick(): Promise<void> {
      let sec: number;
      try {
        const cfg = readAllConfig(configPaths);
        sec = balancePeriodSec(cfg);
        // 没有任何启用余额的宠物 → 不查（省外部调用）；配置改了下一拍自然跟上
        if (flattenPetList(cfg).some((p) => p.balanceEnabled === true)) await refreshBalance();
        else log.info('[dsh-pet] 余额周期跳过：没有启用余额的宠物');
      } catch (e) {
        // 读配置抛错 = 安装损坏（readAllConfig 只在**内置默认**缺失/损坏时抛，用户层写坏只会告警回退）：
        // 不再重排——每 30 分钟重试一次没有意义，而且会白占一个常驻定时器。修好安装后重启 DSH 即可。
        // 留一行 warn：这条路径会让余额周期**永久停摆**，此前全静默，与「查了但没变化」无法区分。
        log.warn(
          '[dsh-pet] 余额周期读配置失败，周期刷新已停止（重启 DSH 后恢复）：' +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      arm(sec);
    }
    void tick(); // 启动即拉一次（与改造前客户端"先拉一次再定时"一致）
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, 'dsh-pet: balance poll');

  // 碎碎念周期：host 侧调度（前端不再有任何碎碎念定时器）。
  // 一拍 = 读一次配置 + 给"到点"的宠物各生成一句；下一拍按**最短周期**排（多数部署只有一个
  // 周期值，那它就是那个值）。用"读一次配置 + 逐宠物比对 lastWhisperAt"而不是每宠一个定时器：
  // 宠物随配置增删、周期随条目改，固定拍天然跟上，不用维护一堆定时器的生命周期。
  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function arm(sec: number): void {
      if (disposed) return;
      timer = setTimeout(() => void tick(), Math.max(1000, sec * 1000));
    }
    function tick(): void {
      let next = 300;
      try {
        const cfg = readAllConfig(configPaths);
        const now = Date.now();
        let min = Infinity;
        // 每一拍的账：检查几只、到点几只、没到点几只、跳过几只（带原因）。只用于日志，调度行为不变。
        let checked = 0;
        let due = 0;
        let notDue = 0;
        const skipped: string[] = [];
        // 本拍要到点的宠物：收集起来统一串行生成（见下面 duePets 那段注释）
        const duePets: string[] = [];
        for (const pet of flattenPetList(cfg)) {
          const petId = String(pet.id ?? '');
          if (!petId) continue;
          // petId 就是从**同一份 cfg** 拍平出来的，所以必然命中（findPetInstance 与 flattenPetList
          // 搜索同一集合）；查不到只可能是两者口径漂移——跳过这一拍，**不猜也不兜底 main**。
          const found = findPetInstance(cfg, petId);
          if (!found) continue;
          checked += 1;
          const schedule = automaticWhisperSchedule(
            standaloneAiPolicy(),
            pet.whisperEnabled === true,
            whisperPeriodSec(found.conf),
          );
          if (!schedule.enabled) {
            // 两种「没启用」分开记：宠物自己关掉，与独立模式没授权，处理方式完全不同
            skipped.push(
              petId + ': ' + (pet.whisperEnabled === true ? '独立模式未授权自动碎碎念' : 'whisperEnabled=false'),
            );
            continue;
          }
          const sec = schedule.periodSec;
          min = Math.min(min, sec);
          if (now - (lastWhisperAt.get(petId) ?? 0) < sec * 1000) {
            notDue += 1;
            continue;
          }
          // 占用锁：这只宠物被占用时**跳过这一拍**——不生成也不补（碎碎念是瞬时事件，过期即弃）。
          // 而且**不推进 lastWhisperAt**：锁一放开，下一拍就该照常说。
          // 宿主侧只挡这一处 **per-pet** 来源；两个**全局段**（balance / workStatus）不在这里挡——
          // 它们所有宠物共用一份，宿主"跳过写入"会连带静音别的宠物；那两处由渲染端按宠物忽略
          // （见 src/client/pet.ts 的冻结判定），代价是叶子照常推进、渲染端自己不看。
          if (lock.locked(petId)) {
            skipped.push(petId + ': 占用锁跳过');
            continue;
          }
          due += 1;
          log.info(`[dsh-pet] 碎碎念到点 pet=${petId}（周期 ${sec}s），开始生成`);
          lastWhisperAt.set(petId, now);
          duePets.push(petId);
        }
        // 【为什么是串行】独立模式的 AI 是**单实例单并发**（ai-provider 的 `if (active) throw
        // 'Standalone AI is busy'`）。旧实现同一拍里为每只宠物各 `void publishWhisper(...)`，
        // 两只宠物同时到点 → 第二只必然撞上 busy 直接失败（日志里那条
        // `碎碎念生成失败 pet=xxx reason=generate-error Standalone AI is busy` 就是它）。
        // 改成按顺序一条一条生成：先到先得，后一只排队等前一只结束。整体仍是异步的
        // （不 await 在 tick 里），调度节拍不受影响。
        if (duePets.length > 0) {
          void (async () => {
            for (let i = 0; i < duePets.length; i += 1) {
              if (i > 0) await new Promise((r) => setTimeout(r, 800));
              try {
                await publishWhisper(duePets[i]);
              } catch {
                /* 单只失败不影响后续宠物 */
              }
            }
          })();
        }
        if (Number.isFinite(min)) next = min;
        // 每拍一行汇总：调度是否还在跑、下一拍多久、为什么跳过，全在这一行里（300s 一条，量可忽略）
        log.info(
          `[dsh-pet] 碎碎念调度：检查 ${checked} 只 → 到点 ${due}、未到点 ${notDue}、跳过 ${skipped.length}` +
            (skipped.length > 0 ? `（${skipped.join('；')}）` : '') +
            `；下一拍 ${next}s`,
        );
      } catch (e) {
        // 读配置抛错 = 安装损坏（同余额定时器）：不再重排，别白占常驻句柄。
        // 但必须留一行 warn：这条路径会让自动碎碎念**永久停摆**，此前它是全静默的。
        log.warn(
          '[dsh-pet] 碎碎念调度读配置失败，自动碎碎念已停止（重启 DSH 后恢复）：' +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      arm(next);
    }
    void tick(); // 启动即生成一次（与改造前客户端首拉就生成一致）
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, 'dsh-pet: whisper poll');

  // /pet 斜杠命令：选择「当前桌宠」（/chat 对话的目标）。浏览器端另有 commandUi 装饰的选择框
  // （裸输 /pet 回车或菜单点选时弹出，选中后提交 /pet <id> 走同一 handler）；手输参数认 id 或名字
  // （name 可重复：唯一命中才认，重名报错列出候选 id）。
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'pet',
        description: '选择桌宠（/chat 对话的目标；支持选择框或手输 id/名字）',
        input: { hint: '[宠物 id 或名字]（留空查看当前）' },
        handler: ({ rawInput }: { rawInput: string }) => {
          const arg = rawInput.trim();
          let eff: Record<string, unknown>[];
          try {
            eff = effectivePetList();
          } catch {
            eff = [];
          }
          if (!arg) {
            const cur = resolveActivePetId();
            const found = eff.find((p) => String(p.id) === cur);
            return {
              kind: 'success',
              text: '当前桌宠：' + (found ? petDisplayName(found) : cur || '（无可交互桌宠）'),
            };
          }
          const byId = eff.find((p) => String(p.id) === arg);
          if (byId) {
            activePetId = String(byId.id);
            return { kind: 'success', text: '已选择桌宠：' + petDisplayName(byId) };
          }
          const byName = eff.filter((p) => petDisplayName(p) === arg);
          if (byName.length === 1) {
            activePetId = String(byName[0].id);
            return { kind: 'success', text: '已选择桌宠：' + petDisplayName(byName[0]) };
          }
          if (byName.length > 1) {
            return {
              kind: 'error',
              text:
                '「' +
                arg +
                '」有 ' +
                byName.length +
                ' 只桌宠（id：' +
                byName.map((p) => String(p.id)).join('、') +
                '），请用 id 指定',
            };
          }
          return { kind: 'error', text: '找不到桌宠「' + arg + '」（id 或名字都行；/pet 回车可打开选择框）' };
        },
      }),
    'dsh-pet: /pet command',
  );

  // /chat 斜杠命令：与当前桌宠对话。无参数 = 碎碎念一句（手动语义：不受 whisperEnabled 门控，
  // 那个字段只关自动周期）；有参数 = 正常对话（走 chatWithPet 同一条路径：记忆 + 人设 + 写盘）。
  // 两个分支都是 **fire-and-forget**：回执不等模型（生成要几秒），文本一律写进 S 的
  // pets.<id>.say，前端 1s 轮询 /state 后弹气泡——与 /balance 命令同一套语义（回执不带数据）。
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'chat',
        description: '与桌宠对话：留空 = 碎碎念一句；输入消息 = 正常对话',
        input: { hint: '[消息]（留空 = 碎碎念）' },
        handler: ({ rawInput }: { rawInput: string }) => {
          const petId = resolveActivePetId();
          if (!petId) return { kind: 'error', text: '没有可交互的桌宠' };
          const text = rawInput.trim();
          if (!text) {
            void publishWhisper(petId).catch((e: unknown) =>
              log.warn('[dsh-pet] 碎碎念异常：' + (e instanceof Error ? e.message : String(e))),
            );
            return { kind: 'success', text: '已让桌宠碎碎念一句' };
          }
          if (text.length > 2000) return { kind: 'error', text: '消息过长（限 2000 字）' };
          void chatWithPet(petId, text).then((r) => {
            if (!r.ok) {
              log.warn('[dsh-pet] 对话失败 reason=' + r.reason + (r.message ? ' ' + r.message : ''));
            }
          });
          return { kind: 'success', text: '已发送，桌宠马上回应' };
        },
      }),
    'dsh-pet: /chat command',
  );

  // 系统通知的宿主监听已在上方注册（notify frames effect）：host 监听 session/event +
  // agent/error 生成通知帧入队，浏览器轮询 /notify 拉取弹 toast（DSH 0.1.5 删除了浏览器侧
  // api.events.mux/host 事件流，通知与宠物一样改走 host 通道，两端行为一致）。

  // 随插件生命周期清理：桌面 Helper 回收（异步下载完成后不再拉起）+ **结束所有挂起的等待**
  // （回执的与 /state 长轮询的都不结束的话，插件重载会留下一批悬挂的响应，各自要等到超时才收尾）
  ctx.effect(() => () => {
    disposed = true;
    // 工作状态的补写定时器：卸载后它到点已经没有意义（叶子连同长轮询一起收尾），清掉免得挂着
    if (workFlushTimer !== null) {
      clearTimeout(workFlushTimer);
      workFlushTimer = null;
    }
    // 下载日志的「清槽」定时器：同上，卸载后它到点已经没有意义
    if (downloadSlotTimer !== null) {
      clearTimeout(downloadSlotTimer);
      downloadSlotTimer = null;
    }
    // 占用锁：卸载时把锁全撤掉并写一次叶子——不写的话渲染端要等 TTL 到点才解除静止
    // （写叶子必须在 state.cancelAll() **之前**：那之后挂起的等待者已经收尾了）。
    lock.releaseAll();
    playback.cancelAll();
    state.cancelAll();
    stopHelper('dsh-host-stop');
  });

  // 路由就绪后拉起桌面 Helper（Electron 缺失时仅告警，不影响 DSH 与浏览器 overlay）
  startHelper();
}
