/**
 * 「固定位置」菜单树的构造（`pinnedMenuBranch`）—— 纯函数，不碰 DOM。
 *
 * 为什么值得单独钉：右键菜单是这条功能唯一的高频入口（设置页是另一条），
 * 而它的取值必须**来自菜单项本身**，不能由渲染端根据当前状态推导——
 * 旧代码里 display 子菜单就吃过这个亏（both→web 的推导让宠物莫名消失）。
 * 这里把「文案随状态变、取值不随状态变」这条不变式钉死。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pinnedMenuBranch } from './menu.ts';

describe('pinnedMenuBranch —— 固定位置子菜单', () => {
  test('永远是两项：固定 / 解除固定（右键菜单没有复选框，必须拆成两个明确动作）', () => {
    for (const cur of [true, false]) {
      const b = pinnedMenuBranch(cur);
      assert.equal(b.children.length, 2, `current=${cur}`);
    }
  });

  test('两项的 action 都是 set-pinned，pinned 分别是 true / false', () => {
    const b = pinnedMenuBranch(false);
    const [on, off] = b.children as { action?: string; pinned?: boolean }[];
    assert.equal(on.action, 'set-pinned');
    assert.equal(on.pinned, true);
    assert.equal(off.action, 'set-pinned');
    assert.equal(off.pinned, false);
  });

  test('取值不随当前状态变（状态只影响文案 —— 这是本模块的核心不变式）', () => {
    for (const cur of [true, false]) {
      const [on, off] = pinnedMenuBranch(cur).children as { pinned?: boolean }[];
      assert.equal(on.pinned, true, `current=${cur} 时「固定」项仍必须是 true`);
      assert.equal(off.pinned, false, `current=${cur} 时「解除」项仍必须是 false`);
    }
  });

  test('已固定时父项文案带「已固定」后缀；未固定时不带', () => {
    assert.ok(pinnedMenuBranch(true).label.includes('已固定'), pinnedMenuBranch(true).label);
    assert.ok(!pinnedMenuBranch(false).label.includes('已固定'), pinnedMenuBranch(false).label);
  });

  test('父项文案两种状态都以「固定位置」开头（用户找它时文字必须一致）', () => {
    for (const cur of [true, false]) {
      assert.ok(pinnedMenuBranch(cur).label.startsWith('固定位置'), pinnedMenuBranch(cur).label);
    }
  });

  test('每项都有 label（菜单组件按 label 渲染，缺失会画出一个空行）', () => {
    for (const cur of [true, false]) {
      for (const child of pinnedMenuBranch(cur).children as { label?: string }[]) {
        assert.ok(child.label && child.label.length > 0, `current=${cur}`);
      }
    }
  });
});

/**
 * 源码守卫：两端都必须**真的把「固定位置」子菜单挂进右键菜单树**，且都必须有 set-pinned 分发。
 *
 * 为什么用源码断言而不是行为测试：这两端各有一份 UI 薄壳（React 组件 / 桌面 DOM sprite），
 * 行为测试要起浏览器或 Electron 才跑得动，成本远高于收益。而这两个漏法在代码里长得一样——
 * 菜单项定义了却没挂（用户根本看不到这一项），或者挂了却没有分发分支（点了没反应）。
 * 与 pickers.test.ts 里「双端都必须传 fixed」那条守卫同一个思路。
 */
const repoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('源码守卫 —— 固定位置必须在两端都挂上且都有分发', () => {
  const browserShell = repoFile('../client/pet.ts');
  const desktopShell = repoFile('../../runtime/electron-helper/sprite.js');

  test('浏览器端：菜单树里有 pinnedMenuBranch(...)', () => {
    assert.ok(
      /pinnedMenuBranch\(/.test(browserShell),
      'client/pet.ts 的 handleContextMenu 必须把 pinnedMenuBranch 挂进 tools（否则网页端看不到这一项）',
    );
  });

  test('桌面端：菜单树里有 pinnedMenuBranch(...)', () => {
    assert.ok(
      /pinnedMenuBranch\(/.test(desktopShell),
      'runtime/electron-helper/sprite.js 的菜单树必须把 pinnedMenuBranch 挂进 tools（否则桌面端看不到这一项）',
    );
  });

  test('浏览器端：有 set-pinned 的分发分支', () => {
    assert.ok(
      /action === 'set-pinned'/.test(browserShell),
      "client/pet.ts 的 handleMenuAction 必须有 action === 'set-pinned' 分支（否则点了没反应）",
    );
  });

  test('桌面端：有 set-pinned 的分发分支', () => {
    assert.ok(
      /action === 'set-pinned'/.test(desktopShell),
      "sprite.js 的 onMenuAction 必须有 action === 'set-pinned' 分支（否则点了没反应）",
    );
  });

  test('桌面端：分发调的是 setPinned（写配置那一路），不是本地改坐标', () => {
    assert.ok(/setPinned\(/.test(desktopShell), 'sprite.js 的 onMenuAction 应调用 setPinned');
  });

  test('两端都读同一个判据：pinned === true 且 pinX/pinY 都是有限数', () => {
    for (const [name, src] of [
      ['client/pet.ts', browserShell],
      ['sprite.js', desktopShell],
    ] as const) {
      // 两端的写法不同但判据必须一致：客户端直接读 cfg.position.pinned；
      // 桌面端在 isPinned() 里先把 position 取成局部变量 p，所以是 `p.pinned === true`。
      assert.ok(
        /(?:position|p)\.pinned === true/.test(src),
        `${name} 必须严格判 pinned === true（缺键/false 都算未固定）`,
      );
      assert.ok(/pinX/.test(src) && /pinY/.test(src), `${name} 必须同时看 pinX / pinY`);
    }
  });
});
