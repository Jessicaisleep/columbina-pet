/**
 * 跨形态互斥锁 —— 插件形态（DSH 内的 helper）与独立应用（dsh-pet.exe）不许同时跑。
 *
 * 【为什么要这个】
 *   两种形态是**同一份代码的两个入口**（插件=`lib/index.js`+`lib/client.js`，独立=`lib/app.js`），
 *   但各有自己的桌面窗口、托盘和碰撞站场。同时运行时会出现：
 *     - 两套窗口抢同一块屏幕，宠物看起来「叠在一起」；
 *     - 两个托盘图标一模一样，用户分不清哪个是哪个；
 *     - 各自读自己的配置目录，动作/位置互相看不顺眼。
 *   早期还因为共用 `%APPDATA%\dsh-pet` 的 Chromium profile 被单例锁互相踢（见 main.js 顶部注释）。
 *   现在数据目录已经分开了，**但窗口仍然会重复**，所以必须在启动时就把这一层拦住。
 *
 * 【为什么不用 Electron 的 requestSingleInstanceLock】
 *   那个锁按 app 名（`dsh-pet-electron-helper`）分组，插件形态与独立应用**故意**同名共用
 *   （防漂移测试钉着它），所以它只能挡住「同形态第二次启动」，
 *   挡不住「独立版已经开着、再从 DSH 里开一只」。必须自己写一份跨形态的标记文件。
 *
 * 【口径】
 *   - 标记文件放在**两形态都能算出来的固定位置**：`%APPDATA%\dsh-pet\running-form.json`
 *     （独立版把它当 userData，插件版只借用这一个文件，不改自己的 userData）。
 *   - 里面只记 `{ mode, pid, startedAt }`。**不写 token、不写配置**。
 *   - 判活走 `kill(pid, 0)`：ESRCH = 进程没了 → 视为残留标记，直接抢占。
 *     不校验进程名：Windows 上 Electron 应用与 dsh-pet.exe 的映像名不同形态不同，
 *     按名字判会让插件形态（electron.exe）永远判不出「自己是自己」。
 *     pid 复用是极小概率，且最坏后果只是「多弹一次提示」，可接受。
 *   - 抢不到就**不启动**，弹一句人话让用户先关掉另一个，然后正常退出（exit 0）——
 *     不要 exit 1，那会被启动器当成崩溃弹红线。
 *
 * 【只有两处写入方】main.js（write/release），没有别的。改动时保持这一点。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 形态 → 给人看的名字（弹窗文案用） */
const FORM_LABEL = {
  app: '独立桌宠',
  plugin: 'DSH 插件桌宠',
};

/**
 * 标记文件的固定位置。
 * @param {string} appData app.getPath('appData')（Windows = %APPDATA%）
 * @returns {string} 绝对路径
 */
function formLockFile(appData) {
  return path.join(appData, 'dsh-pet', 'running-form.json');
}

/**
 * pid 还活着吗。ESRCH 表示没有这个进程；EPERM 表示有但没有权限（也当作活着）。
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * 读标记文件。文件不存在 / 内容坏了 → undefined（不抛：坏文件不该阻塞启动）。
 * @param {string} file
 * @returns {{mode: string, pid: number, startedAt: string} | undefined}
 */
function readFormLock(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.mode === 'string' && Number.isInteger(parsed.pid)) {
      return { mode: parsed.mode, pid: parsed.pid, startedAt: String(parsed.startedAt ?? '') };
    }
  } catch {
    /* 坏文件按「没有」处理 */
  }
  return undefined;
}

/**
 * 尝试占位。
 *
 * @param {string} file 标记文件路径
 * @param {{mode: 'app'|'plugin', pid: number, now?: () => Date, isAlive?: (pid: number) => boolean}} options
 * @returns {{ok: true} | {ok: false, other: {mode: string, pid: number, startedAt: string}}}
 *   ok=false 时 `other` 是**另一个形态**的占位记录（调用方据此弹提示后退出）
 */
function acquireFormLock(file, options) {
  const { mode, pid } = options;
  const now = options.now ?? (() => new Date());
  const isAlive = options.isAlive ?? isPidAlive;

  const existing = readFormLock(file);
  if (existing && existing.pid !== pid && isAlive(existing.pid)) {
    // 同一个形态在跑 → 交给 Electron 自己的单例锁处理（独立版有、插件版没有），这里不拦
    if (existing.mode === mode) return { ok: true };
    return { ok: false, other: existing };
  }

  // 没有 / 已死 / 已过期 → 自己写上
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode, pid, startedAt: now().toISOString() }), 'utf8');
  } catch {
    // 写不进去（权限/只读盘）不该让宠物起不来：跳过互斥，继续启动
    return { ok: true };
  }
  return { ok: true };
}

/**
 * 退出时清掉自己的占位。只删「确实是自己写的」那条，别误删别人的。
 * @param {string} file
 * @param {number} pid
 * @returns {void}
 */
function releaseFormLock(file, pid) {
  const existing = readFormLock(file);
  if (!existing || existing.pid !== pid) return;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

/**
 * 抢不到时的弹窗文案。
 * @param {{mode: string}} other
 * @returns {{title: string, message: string, detail: string}}
 */
function conflictMessage(other) {
  const otherName = FORM_LABEL[other.mode] ?? '另一个桌宠';
  return {
    title: '桌宠已经在运行',
    message: `${otherName}正在运行，本次启动已取消。`,
    detail:
      '插件桌宠与独立桌宠是同一个项目的两种运行形态，共用同样的窗口与托盘，' +
      '同时运行会出现两只宠重叠、两个一模一样的托盘图标。\n\n' +
      '请先在托盘右键退出正在运行的那一只，再启动这一个。\n\n' +
      '（想同时用两种形态：先退出插件形态，再开独立版；反之亦然。）',
  };
}

module.exports = {
  FORM_LABEL,
  formLockFile,
  isPidAlive,
  readFormLock,
  acquireFormLock,
  releaseFormLock,
  conflictMessage,
};
