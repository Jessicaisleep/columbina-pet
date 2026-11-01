#!/usr/bin/env node
/**
 * ============================================================================
 * prepack-check.js —— 发布前健康检查
 * ============================================================================
 *
 * 【作用】
 *   在 `npm publish` / `npm pack` 之前自动运行（由 package.json 的
 *   "prepack" 脚本触发），逐项检查插件包是否"可发布"。
 *   任何一项失败都会置 exit code 为 1，阻止发布一个坏包。
 *
 * 【检查项】
 *   1. 必需文件是否存在（lib、类型声明、patch、对齐参数）
 *   2. 自带的角色素材包（assets/pet/*）齐全，且每份 config 的 idle 动画都能在
 *      自己的 <前缀>-animation/ 里找到同名 webm
 *   3. 原始 1200×1200 母版不得进 npm 包（体积超限，应放 GitHub Releases）
 *   4. client.js 是官方 bundle 形态（__ModuleLoader__.load + exports.apply）
 *   5. package.json 声明了 dsh.bundle 和 dsh.client（否则装不上）
 *   6. 表情包条件断言：assets/memes 有图时 files 必须含它（本包默认没有图）
 *   7. 包总大小 < 200MB（自设软上限，防误塞母版；npm 硬上限远更大）
 *
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 包根目录（scripts/ 的上一级）
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 失败/通过 的输出辅助
const fail = (msg) => {
  console.error(`[prepack-check] FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`[prepack-check] ok: ${msg}`);
/** JSONC → JSON：字符串感知地剥离行注释与块注释（config.jsonc 里有行尾注释） */
const stripJsonc = (s) => {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

// ---- 1. 必需文件存在性 ----
const required = [
  'lib/index.js', // 宿主半侧
  'lib/client.js', // 浏览器半侧
  'lib/types/index.d.ts', // 宿主类型声明
  'lib/types/client/index.d.ts', // 客户端类型声明
  'cordis.patch.yml', // bundle patch（挂载声明）
  'runtime/electron-helper/main.js', // 桌面模式 Electron 主进程
  'runtime/electron-helper/pointer-target.js', // 桌面模式点击穿透兜底判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/host-liveness.js', // 桌面模式宿主存活判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/topmost-watchdog.js', // 桌面模式置顶看门狗判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/dpi-linearization.js', // 桌面模式 DPI 线性化判定与换算（main.js require，缺了会启动即崩）
  'runtime/electron-helper/tray-platform.js', // 桌面模式托盘平台差异判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/desktop-geometry.js', // 活动边界与菜单工作区分离
  'runtime/electron-helper/preload.js', // 桌面模式 preload 桥
  'runtime/electron-helper/renderer.js', // 桌面模式渲染端（宠物本体）
  'runtime/electron-helper/shared-core.js', // 桌面模式共享纯逻辑（src/shared 构建产物，window.PetShared）
  'runtime/electron-helper/index.html', // 桌面模式页面壳
];
for (const f of required) {
  existsSync(join(ROOT, f)) ? ok(`exists ${f}`) : fail(`missing ${f}`);
}

// ---- 2. 自带的角色素材包必须真在包里（装上去就是空桌面）----
// 【2026-10-30 派生版】本包不再带 assets/webm（上游蓝毛小女仆那 106 个动作），
// 两个角色全部走 pet pack：assets/pet/<前缀>-config.json + assets/pet/<前缀>-animation/*.webm。
// host 侧 scanPetFiles 会把「包内 assets/pet」与「用户层 $DSH_HOME/dsh-pet/pet」合并读取，
// 这里断言包内这一层确实存在、且每份 config 的 idle 动画能在自己的 animation 目录里找到文件
// ——后者是关键：idle 名字写错时宿主只在运行时静默不播动画，发布前不查就发现不了。
const packDir = join(ROOT, 'assets', 'pet');
const packConfigs = existsSync(packDir) ? readdirSync(packDir).filter((n) => /^.+?-config\.(json|jsonc)$/.test(n)) : [];
if (packConfigs.length > 0) ok(`pet packs present (${packConfigs.length}: ${packConfigs.join(', ')})`);
else {
  // 派生出来的独立端仓库（columbina-pet）不带 assets/pet：它的角色素材就是 assets/webm 下
  // 那套蓝毛主体动画（宠物定义在用户层 main-config.jsonc / 包内 config.jsonc 的动画池里）。
  // 两个仓库共用这一份脚本，所以这里认「扁平 webm 目录」也算有素材，否则独立端每次都被判成空桌面。
  const flatDir = join(ROOT, 'assets', 'webm');
  const flatWebms = existsSync(flatDir) ? readdirSync(flatDir).filter((n) => n.endsWith('.webm')) : [];
  if (flatWebms.length > 0) ok(`no pet pack dir; flat assets/webm present (${flatWebms.length} webm)`);
  else fail('no pet pack in assets/pet (装上去会是空桌面：没有 config 也没有动画)');
}
const stripExt = (n) => n.replace(/\.[^.]+$/, '');
for (const cfgName of packConfigs) {
  const prefix = cfgName.replace(/-config\.(json|jsonc)$/, '');
  const animDir = join(packDir, prefix + '-animation');
  const webms = existsSync(animDir) ? readdirSync(animDir).filter((n) => n.endsWith('.webm')) : [];
  if (webms.length === 0) {
    fail(`pet pack ${prefix} has no webm in ${prefix}-animation/`);
    continue;
  }
  try {
    const conf = JSON.parse(stripJsonc(readFileSync(join(packDir, cfgName), 'utf8')));
    const idle = Array.isArray(conf.animations?.idle) ? conf.animations.idle : [];
    if (idle.length === 0) fail(`pet pack ${prefix} declares no animations.idle`);
    const have = new Set(webms.map(stripExt));
    const lost = idle.filter((n) => !have.has(n));
    if (lost.length === 0)
      ok(`pet pack ${prefix}: idle resolved (${idle.length}/${idle.length}, ${webms.length} webm)`);
    else fail(`pet pack ${prefix}: idle 动画找不到文件 → ${lost.join('、')}`);
  } catch (e) {
    fail(`pet pack ${cfgName} parse error: ${e.message}`);
  }
}

// ---- 3. 原始母版不得进 npm 包 ----
// assets/ 根下若有 .webm 就是原始母版（播放素材在 assets/webm|mov 子目录）
const originals = [];
const assetsRoot = join(ROOT, 'assets');
for (const name of readdirSync(assetsRoot)) {
  if (name.endsWith('.webm')) originals.push(name);
}
if (originals.length > 0)
  fail(`original masters must not ship in npm package: ${originals.join(', ')} (move them to GitHub Releases)`);
else ok('no original masters in assets/');

// ---- 4. client.js 必须是官方 bundle 形态（含插件三件套导出） ----
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
client.includes('__ModuleLoader__.load')
  ? ok('client bundle shell OK')
  : fail('client.js missing __ModuleLoader__.load');
const exportsPlugin =
  /exports\.(apply|inject|name)/.test(client) || /module\.exports\s*=\s*\{[^}]*apply[^}]*inject[^}]*name/.test(client);
exportsPlugin ? ok('client exports apply/inject/name') : fail('client.js missing apply/inject/name exports');

// ---- 5. package.json 必须声明 bundle + client ----
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.dsh?.bundle?.patch) ok('dsh.bundle.patch declared');
else fail('package.json missing dsh.bundle.patch');
if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.web declared');
else fail('package.json missing dsh.client platform web');

// ---- 5b. 商店截图：screenshots.json 里列的每张图都得存在，且都在 files 白名单里 ----
// 坑与 memes 相同：prepare.js 会覆盖 package.json 的 files，漏了哪张，市场详情页就是
// 一个破图占位。这份文件是可选的（没有就不算错），但一旦存在就必须自洽。
const shotsPath = join(ROOT, 'screenshots.json');
if (!existsSync(shotsPath)) {
  ok('no screenshots.json (市场详情页回退到 README 抽图)');
} else {
  try {
    const raw = readFileSync(shotsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.screenshots ?? []);
    const bad = list.filter((p) => typeof p !== 'string' || p.startsWith('/') || p.includes('..'));
    const missing = list.filter((p) => typeof p === 'string' && !existsSync(join(ROOT, p)));
    const notInFiles = list.filter(
      (p) => typeof p === 'string' && !(Array.isArray(pkg.files) && pkg.files.includes(p)),
    );
    if (bad.length) fail(`screenshots.json 有非法路径（不能以 / 开头、不能含 ..）：${bad.join(', ')}`);
    else if (missing.length) fail(`screenshots.json 指向的图不存在：${missing.join(', ')}`);
    else if (notInFiles.length) fail(`screenshots.json 的图不在 files 白名单里（会漏发）：${notInFiles.join(', ')}`);
    else if (list.length < 1 || list.length > 8) fail(`screenshots.json 必须 1-8 张，实际 ${list.length} 张`);
    else ok(`screenshots.json aligned (${list.length} 张，全部存在且在 files 里)`);
  } catch (e) {
    fail(`screenshots.json 解析失败：${e.message}`);
  }
}
// ---- 6. 表情包：本包默认不带（assets/memes 已随派生版移除），带了就必须真发出去 ----
// 坑：scripts/prepare.js 每次发布都会用**硬编码白名单覆盖** package.json 的 files，
// 只在 package.json 里加一行是无效的 → 这里显式断言，防止再次静默漏发。
// 【2026-10-30 派生版】上游的 27 张蓝鱼梗图已删除（它们属于上游角色，删角色就该删图）；
// 因此这里改成条件断言：目录存在且有图 → 必须在 files 白名单里；都没有 → 只是「没配图功能」，放行。
const memesDir = join(ROOT, 'assets', 'memes');
const memePngs = existsSync(memesDir) ? readdirSync(memesDir).filter((n) => n.endsWith('.png')) : [];
if (memePngs.length === 0) {
  ok('no assets/memes (配图功能关闭，config.jsonc 的 memes 应为空)');
} else if (Array.isArray(pkg.files) && pkg.files.includes('assets/memes')) {
  ok(`files includes assets/memes (${memePngs.length} png)`);
} else {
  fail('assets/memes 有图但 package.json files 没含 assets/memes（图会全部漏发）');
}
// memes 键 ↔ 图片文件对齐：缺图条目会被 host 静默剔除（设计如此，不阻断发布），
// 但数字对不上值得发布前看一眼，故只提示
try {
  const conf = JSON.parse(stripJsonc(readFileSync(join(ROOT, 'assets', 'config.jsonc'), 'utf8')));
  const keys = Object.keys(conf.memes ?? {});
  const onDisk = new Set(memePngs.map((n) => n.slice(0, -'.png'.length)));
  const missing = keys.filter((k) => !onDisk.has(k));
  const extra = [...onDisk].filter((k) => !keys.includes(k));
  if (!missing.length && !extra.length) ok(`memes mapping aligned (${keys.length} keys = ${memePngs.length} png)`);
  else
    console.log(
      `[prepack-check] note: memes 键与图片不齐 —— 缺图 ${missing.length} 条${
        missing.length ? `（${missing.join('、')}）` : ''
      }；没写进配置的图 ${extra.length} 张${extra.length ? `（${extra.join('、')}）` : ''}`,
    );
} catch (e) {
  console.log(`[prepack-check] note: 跳过 memes 键对齐核对（config.jsonc 解析失败：${e.message}）`);
}

// ---- 7. 包总大小估算（排除 node_modules/.git/脚本/素材源目录/README预览GIF） ----
let total = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过不会进 npm 包的目录。dist-app 是 electron-builder 的独立端产物（几百 MB），
      // 既不在 package.json 的 files 白名单里，也不该算进「包体积」——否则打完独立端
      // 再来 pack 插件就会误报 package too large。
      const skip = ['node_modules', '.git', 'scripts', 'step01', 'step02', 'step03', 'preview', 'dist-app'];
      if (!skip.includes(entry.name)) walk(p);
    } else if (!entry.name.endsWith('.map')) {
      // 打包产物 tarball（npm pack 遗留）不计入自查口径
      if (!entry.name.endsWith('.tgz')) total += statSync(p).size; // sourcemap 不计
    }
  }
};
walk(ROOT);
const mb = (total / 1e6).toFixed(1);
if (total > 200e6) fail(`package too large: ${mb}MB (limit 200MB)`);
else ok(`package size ${mb}MB`);

// ---- 8. 构建产物不得引入未声明的外部 helper（@oxc-project/runtime） ----
// rolldown 在 target es2020 下会为「带初始化器的类字段」这类降级语法产出
// `import _defineProperty from "@oxc-project/runtime/helpers/defineProperty"`；而该包既不在本包
// dependencies 里、也不随包发布（宿主 DSH 的安装树里同样没有）→ DSH 加载插件树时直接
// ERR_MODULE_NOT_FOUND，整个 profile 起不来（issue #59 改动踩过一次，见 src/host/helper-process.ts
// 的约定：类字段一律 `declare` + 构造器赋值，避免降级出外部 helper）。
const OXC_RUNTIME = '@oxc-project/runtime';
const oxcBundles = ['lib/index.js', 'lib/client.js'].filter((f) => {
  const p = join(ROOT, f);
  return existsSync(p) && readFileSync(p, 'utf8').includes(OXC_RUNTIME);
});
if (oxcBundles.length > 0)
  fail(
    `bundle imports undeclared helper ${OXC_RUNTIME} (${oxcBundles.join(', ')}) — ` +
      '类字段改用 declare + 构造器赋值（见 src/host/helper-process.ts 的约定）',
  );
else ok(`no undeclared ${OXC_RUNTIME} import in bundles`);

// ---- 汇总 ----
if (process.exitCode) console.error('\n[prepack-check] fix the failures above before publishing.');
else console.log('\n[prepack-check] all checks passed — ready to pack/publish.');
