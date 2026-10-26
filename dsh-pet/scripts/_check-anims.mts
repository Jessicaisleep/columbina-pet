// 校验：helper 实际会拿到的 columbina 条目里，动画池与权重是什么。
// 用仓库自己的 TS 直跑注册（与 npm test 同一套），不依赖运行中的进程。
import { readAllConfig, flattenPetList } from '../src/host/config.ts';
import { configPathsFor } from '../src/standalone/options.ts';

const root = process.cwd();
const dshHome = process.env.DSH_HOME || 'D:\\Program Files (x86)\\DSH_Data';
const paths = configPathsFor(root, dshHome);
const merged = readAllConfig(paths);
const keys = Object.keys(merged);
console.log('条目:', keys.join(', '));

const c = merged.columbina;
if (!c) {
  console.log('!! 没有 columbina 条目');
  process.exit(1);
}
const a = c.animations;
const show = (label, v) => console.log(`  ${label}:`, Array.isArray(v) ? v.join(' / ') : v);
show('idle', a.idle);
show('turn', a.turn);
show('drag', a.drag);
show('clicks', a.clicks);
show('moves.actions', a.moves.actions.map((x) => x.name));
show('events.balance', a.events.balance);
for (const cat of a.categories) show(`category[${cat.id} w=${cat.weight}]`, cat.actions);
console.log('weights:', JSON.stringify(c.animationWeights));

const total =
  Number(c.animationWeights.idle) +
  Number(c.animationWeights.turn) +
  Number(c.animationWeights.move) +
  a.categories.reduce((s, x) => s + Number(x.weight), 0);
console.log('权重合计 =', total);

const pets = flattenPetList(merged);
console.log('宠物实例:', pets.map((p) => `${p.id}(${p.display})`).join(', '));
