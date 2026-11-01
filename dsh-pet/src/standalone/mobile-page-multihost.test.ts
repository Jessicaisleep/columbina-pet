import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobilePage, mobileScript } from './mobile-page';

// 手机页是**纯字符串模板**（宿主当 HTTP 响应吐出来，Capacitor 打进 APK），没法直接 import
// 里面的函数。所以这里用「从源码里抠出函数体 → 在隔离环境里求值」的办法测：
// 被测的都是纯函数（只看入参与 state），抠出来跑与线上等价，而且不需要 DOM。
//
// 钉的是 2026-11-01 用户提的三件事：
//   ① 手机能切换宠物；② 能同时配对两台电脑但一次只用一份数据（按宿主 id 分键）；
//   ③ 电脑端的动画（含待机循环）随包进 APK，离线也能播。
//
// 为什么值得写：这些函数一旦退化，**界面看起来完全正常**（宠物照样动、照样能聊），
// 只有「换宠物换错了对象」「离线时黑屏」这种要用户用几天才发现的症状。

/** 从模板里抠出一个具名函数的**完整源码**（按大括号配对，不管里面有几个 return） */
function grabFn(source: string, name: string): string {
  const at = source.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '模板里找不到函数 ' + name);
  const body = source.indexOf('{', source.indexOf(')', at));
  assert.ok(body > at, name + ' 没有函数体');
  let depth = 0;
  for (let i = body; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(name + ' 的函数体没有闭合');
}

/**
 * 把几个函数抠出来拼成一个小模块：它们的自由变量只有 `state`（脚本里的全局状态对象），
 * 所以注入一个假 state 就能跑。多抠一个函数写一个名字即可。
 */
function harness(names: string[], state: Record<string, unknown>): Record<string, never> {
  const src = names.map((n) => grabFn(mobileScript, n)).join('\n');
  const build = new Function('state', src + '\nreturn {' + names.join(',') + '};');
  return build(state) as Record<string, never>;
}

test('animPool：待机/点击取字符串，动作取 moves.actions 的 name 与 categories 的字符串', () => {
  const { animPool } = harness(['animPool'], {}) as unknown as {
    animPool: (a: unknown) => { idle: string[]; click: string[]; actions: string[] };
  };
  const pool = animPool({
    idle: ['待机呼吸休闲'],
    clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶'],
    moves: { actions: [{ name: '螃蟹走路' }, { name: '原地漂浮踏步' }] },
    categories: [{ id: '小动作', actions: ['超大伸懒腰', '女仆屈膝礼仪'] }],
  });
  assert.deepEqual(pool.idle, ['待机呼吸休闲']);
  assert.deepEqual(pool.click, ['点击回应-开心跃动', '点击回应-害羞惊讶']);
  assert.deepEqual(pool.actions, ['螃蟹走路', '原地漂浮踏步', '超大伸懒腰', '女仆屈膝礼仪']);
});

test('animPool：去重但保序，坏形状不抛', () => {
  const { animPool } = harness(['animPool'], {}) as unknown as {
    animPool: (a: unknown) => { idle: string[]; click: string[]; actions: string[] };
  };
  const pool = animPool({
    idle: ['A', 'A', 'B'],
    clicks: [1, null, 'C', ''],
    moves: { actions: 'not-an-array' },
    categories: [{ actions: ['B', 'D'] }, null, { actions: ['D'] }],
  });
  assert.deepEqual(pool.idle, ['A', 'B'], '重名要去掉，顺序不变');
  assert.deepEqual(pool.click, ['C'], '非字符串要丢掉，而不是回落到 "1"');
  assert.deepEqual(pool.actions, ['B', 'D']);
  // 什么都没有时给空池子，不能 undefined —— 调用方直接 .length
  assert.deepEqual(animPool(undefined), { idle: [], click: [], actions: [] });
});

test('pickAnim：只从「手机上真有的素材」里挑', () => {
  const state = {
    pool: { idle: ['待机呼吸休闲'], click: ['点击回应-开心跃动'], actions: ['螃蟹走路', '写代码'] },
    assetRoot: 'main',
    local: { main: ['螃蟹走路', '待机呼吸休闲'] },
    cur: null,
  };
  const { pickAnim } = harness(['pickAnim'], state) as unknown as {
    pickAnim: (kind: string) => string;
  };
  for (let i = 0; i < 60; i += 1) {
    const pick = pickAnim('actions');
    assert.ok(pick === '螃蟹走路' || pick === '', '清单里没有的名字不许被选中（会 404 → 黑屏），实际=' + pick);
  }
  assert.equal(pickAnim('click'), '', '点击回应这套素材里没有 → 宁可不播，也不能挑个不存在的');
});

test('pickAnim：池子为空时用包内清单当池子（离线启动的情形）', () => {
  const state = {
    pool: { idle: [], click: [], actions: [] },
    assetRoot: 'nahida',
    local: { nahida: ['待机呼吸', '玩魔方'] },
    cur: null,
  };
  const { pickAnim } = harness(['pickAnim'], state) as unknown as {
    pickAnim: (kind: string) => string;
  };
  const seen = new Set<string>();
  for (let i = 0; i < 80; i += 1) seen.add(pickAnim('actions'));
  assert.deepEqual([...seen].sort(), ['待机呼吸', '玩魔方'], '离线时两条都该有机会出现');
});

test('pickAnim：浏览器形态（没有包内清单）照原样返回，不因为清单缺失就哑掉', () => {
  const state = {
    pool: { idle: [], click: [], actions: ['螃蟹走路'] },
    assetRoot: 'main',
    local: null,
    cur: null,
  };
  const { pickAnim } = harness(['pickAnim'], state) as unknown as {
    pickAnim: (kind: string) => string;
  };
  assert.equal(pickAnim('actions'), '螃蟹走路');
});

test('localUrl：命中包内清单给本地路径，否则给空（调用方据此回落向电脑取）', () => {
  const state = {
    assetRoot: 'main',
    local: { main: ['待机呼吸休闲'], columbina: ['待机呼吸'] },
  };
  const { localUrl } = harness(['localUrl'], state) as unknown as {
    localUrl: (name: string) => string;
  };
  assert.equal(localUrl('待机呼吸休闲'), 'pets/main/%E5%BE%85%E6%9C%BA%E5%91%BC%E5%90%B8%E4%BC%91%E9%97%B2.webm');
  assert.equal(localUrl('螃蟹走路'), '', '清单里没有的名字必须是空串，不能拼出一个 404 地址');
  // 换素材根后同名素材不能串：哥伦比娅的「待机呼吸」在 columbina 目录下
  state.assetRoot = 'columbina';
  assert.equal(localUrl('待机呼吸'), 'pets/columbina/%E5%BE%85%E6%9C%BA%E5%91%BC%E5%90%B8.webm');
});

test('pk：所有按宿主分键的数据都带 @宿主id 后缀', () => {
  const state: Record<string, unknown> = { hostId: 'abc' };
  const { pk } = harness(['pk'], state) as unknown as { pk: (n: string) => string };
  assert.equal(pk('dshpet.pet'), 'dshpet.pet@abc');
  state.hostId = '';
  assert.equal(pk('dshpet.pet'), 'dshpet.pet@none', '还没有宿主时也要有个稳定的键');
});

test('模板里确实存在切换宠物/切换电脑/包内清单这三条链路的入口', () => {
  // 这层是防「以后有人把功能删了但忘了删测试注释」：这些名字一个都不能少。
  for (const name of [
    'switchPet',
    'switchHost',
    'renderPicker',
    'forgetHost',
    'loadLocalPack',
    'localUrl',
    'startIdleLoop',
  ]) {
    assert.ok(
      mobileScript.includes('function ' + name + '(') ||
        mobileScript.includes('var ' + name + '=') ||
        mobileScript.includes(name + '=function'),
      '手机页缺少 ' + name,
    );
  }
  // 界面上的入口（按钮 / 面板）必须在 HTML 里，不然函数写了也没人能点
  assert.ok(mobilePage.includes('id="pick-btn"'), '顶栏缺「切换」按钮');
  assert.ok(mobilePage.includes('id="picker"'), '缺切换面板');
  assert.ok(mobilePage.includes('id="pick-pets"'), '面板缺宠物列表容器');
  assert.ok(mobilePage.includes('id="pick-hosts"'), '面板缺电脑列表容器');
});

test('readMirror：副本记的宠物不是现在这只就整块丢弃，宠物为空时用副本补上', () => {
  // 这条钉的是 2026-11-01 真机验证抓到的 bug 的根：换到另一台电脑后 state.pet 还是上一台的，
  // readMirror 判「副本不是我这只」直接返回 null，界面就停在上一台的样子（宠物、对话都不换）。
  // 修法在 switchHost 里（换成新宿主的 pet），这里钉住 readMirror 自己的口径不许改成「什么都收」。
  const src = ['pk', 'readMirror'].map((n) => grabFn(mobileScript, n)).join('\n');
  const store: Record<string, string> = {
    'dshpet.mirror@h1': JSON.stringify({ pet: 'main', at: 1, items: [{ role: 'user', content: 'A' }] }),
    'dshpet.mirror@h2': JSON.stringify({
      pet: 'columbina1',
      at: 2,
      items: [{ role: 'user', content: 'B' }],
    }),
  };
  const fakeLocal = { getItem: (k: string) => store[k] ?? null };
  const run = (state: Record<string, unknown>) => {
    // LS_MIRROR 是脚本里的另一个自由变量，不一起注入就会在 readMirror 的 try 里抛
    // ReferenceError 被吞成 null —— 所有断言都会「通过地失败」，白测一遍。
    const fn = new Function('state', 'localStorage', 'LS_MIRROR', src + '\nreturn readMirror;')(
      state,
      fakeLocal,
      'dshpet.mirror',
    ) as () => { pet: string } | null;
    return fn();
  };

  // ① 宠物对得上 → 用这份副本（换电脑后的正常路径）
  assert.equal(run({ hostId: 'h1', pet: 'main' })?.pet, 'main');
  // ② 宠物对不上 → 不拿别人家的对话冒充（这条是防串台）
  assert.equal(run({ hostId: 'h1', pet: 'columbina1' }), null);
  // ③ state.pet 还空着（冷启动，/config 还没回来）→ 用副本里记的这只补上
  const cold: Record<string, unknown> = { hostId: 'h2', pet: '' };
  assert.equal(run(cold)?.pet, 'columbina1');
  assert.equal(cold['pet'], 'columbina1', 'readMirror 要把 state.pet 补上，否则离线发言会归错宠物');
});

test('switchHost：换电脑必须把上一台的宠物/素材根/池/清单/blob 全清掉', () => {
  // 只改 hostId 不清宠物，就是上面那条 bug 的形态：界面看着还在旧那台。
  const fn = grabFn(mobileScript, 'switchHost');
  for (const need of [
    'state.pet=p.pet',
    'state.assetRoot=p.assetRoot',
    'state.pool=p.pool',
    'state.pets=[]',
    'blobCache={}',
  ]) {
    assert.ok(fn.includes(need), 'switchHost 缺少 ' + need + ' —— 换电脑后会停在上一台的样子');
  }
});

test('离线模式：没有本地副本但包里有这只的动画，也要能看宠物', () => {
  // 用户要的是「电脑端能放的动画，手机 APP 也放」。那么连不上电脑 ≠ 看不见宠物：
  // 只有「既没副本、包里又没这只素材」才该退回连接页。
  assert.ok(mobileScript.includes('var canLocal='), '离线分支缺少「包里有没有这只素材」的判断');
  assert.ok(mobileScript.includes('if(m||canLocal)'), '离线分支没有把 canLocal 纳入条件');
  assert.ok(mobileScript.includes('if(canLocal){'), '离线分支没有按 canLocal 恢复宠物');
});

test('老键只在启动迁移里读，运行期一律走按宿主分键', () => {
  // 「一次只用一份数据」靠的就是这条：如果哪天有人图省事又把 LS_PET 直接写成全局键，
  // 两台电脑的宠物选择会互相覆盖 —— 用户会看到「换了宠物过一会儿自己变回去」。
  const must = ['localStorage.setItem(LS_PET', 'localStorage.getItem(LS_PET'];
  for (const bad of must) {
    assert.equal(mobileScript.includes(bad), false, '还有直接读写全局 ' + bad + ' 的地方，应改成 pk(LS_PET)');
  }
});
