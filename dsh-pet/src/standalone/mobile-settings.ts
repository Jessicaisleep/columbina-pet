/**
 * 手机端设置屏的 id 清单（2026-11-01）。
 *
 * 设置屏本身的 HTML / CSS / 脚本**内联在 mobile-page.ts 里**，不在这里：
 * 05-手机APP/dsh-pet-mobile/scripts/build-www.mjs 是用 Node 直接 import mobile-page.ts
 * 取三段字符串的，Node 的 ESM 解析不补扩展名，写 ./mobile-settings 会 Cannot find module；
 * 写 ./mobile-settings.ts 又过不了主 tsconfig（allowImportingTsExtensions 只在 test 配置开）。
 * 与其为一行 import 改构建链，不如把字符串放回同一个文件。
 *
 * 这个文件只剩下「测试要用的 id 清单」：它把「漏写一个控件」变成一条测试断言
 * （见 mobile-settings.test.ts），而不是等到手机上点开才发现按钮没反应。
 */

export const MOBILE_SETTINGS_IDS = [
  'setts',
  'set-back',
  'set-title',
  'set-state',
  'set-sync',
  'set-persona',
  'set-persona-note',
  'set-rounds',
  'set-recall',
  'set-group',
  'set-group-block',
  'set-scope',
  'set-recentn',
  'set-ownersync',
  'set-ownerqq',
  'set-split',
  'set-merge',
  'set-proactive',
  'set-prosec',
  'set-screen',
  'set-assistant',
  'set-perm',
  'set-net',
  'set-save',
  'set-result',
  'set-ver',
] as const;
