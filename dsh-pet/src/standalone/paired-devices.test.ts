import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dropDevice,
  isRevoked,
  OFFLINE_GRACE_MS,
  pairedDevicesPath,
  parseDevices,
  parseTable,
  phoneTakeover,
  readTable,
  registerDevice,
  removeDevice,
  serializeTable,
  takeoverReason,
  touchDevice,
  upsertDevice,
  type PairedDevice,
} from './paired-devices';

/**
 * 这些用例钉的是**用户拍板的规则**（2026-11-01，见文件头）：
 * 手机在不在由「这台电脑最近有没有收到它的请求」判定，而不是网段/SSID。
 * 规则错一条的后果是「两边各写一套记忆」，所以边界必须逐条锁死。
 */

function device(id: string, lastSeenAt: number, name = ''): PairedDevice {
  return { id, name, pairedAt: 1000, lastSeenAt };
}

test('一台都没配过 → 电脑永远可写（新装不能一上来就是只读）', () => {
  assert.equal(phoneTakeover([], 10_000_000), false);
});

test('心跳新鲜 → 不接管（手机在家，写电脑）', () => {
  const now = 10_000_000;
  assert.equal(phoneTakeover([device('a', now - 1000)], now), false);
});

test('心跳刚好在宽容期边界上 → 仍算在家；多 1ms → 接管', () => {
  const now = 10_000_000;
  assert.equal(phoneTakeover([device('a', now - OFFLINE_GRACE_MS)], now), false);
  assert.equal(phoneTakeover([device('a', now - OFFLINE_GRACE_MS - 1)], now), true);
});

test('登记过但一次心跳都没有（lastSeenAt=0）→ 按离线处理', () => {
  assert.equal(phoneTakeover([device('a', 0)], 10_000_000), true);
});

test('多台设备：任意一台在线就不锁电脑（副机离线不该连坐）', () => {
  const now = 10_000_000;
  const list = [device('old', now - 10 * 60_000), device('new', now - 500)];
  assert.equal(phoneTakeover(list, now), false);
});

test('宽容期可覆盖（测试与将来的调节旋钮）', () => {
  const now = 10_000_000;
  const list = [device('a', now - 5000)];
  assert.equal(phoneTakeover(list, now, 4000), true);
  assert.equal(phoneTakeover(list, now, 6000), false);
});

test('upsert 同 id 不新增记录，保留首次配对时间并刷新心跳', () => {
  const first = upsertDevice([], { id: 'a', name: 'Pixel', seenAt: 1000 }, 1000);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { id: 'a', name: 'Pixel', pairedAt: 1000, lastSeenAt: 1000 });
  const second = upsertDevice(first, { id: 'a', name: 'Pixel 8', seenAt: 5000 }, 5000);
  assert.equal(second.length, 1);
  assert.equal(second[0].pairedAt, 1000, 'pairedAt 不该被后续心跳改写');
  assert.equal(second[0].lastSeenAt, 5000);
  assert.equal(second[0].name, 'Pixel 8');
});

test('upsert 空 id 直接忽略（不给"匿名设备"留口子）', () => {
  assert.deepEqual(upsertDevice([], { id: '   ', seenAt: 1 }, 1), []);
});

test('removeDevice 只删指定 id', () => {
  const list = [device('a', 1), device('b', 2)];
  assert.deepEqual(removeDevice(list, 'a').map((d) => d.id), ['b']);
});

test('parseDevices：坏 JSON / 坏条目一律丢，不抛异常（脏数据不能让用户被永久只读）', () => {
  assert.deepEqual(parseDevices('not json'), []);
  assert.deepEqual(parseDevices('{"devices":"nope"}'), []);
  const list = parseDevices(
    JSON.stringify({
      devices: [
        { id: 'ok', name: 'x', pairedAt: 1, lastSeenAt: 2 },
        { id: '', lastSeenAt: 3 },
        { name: 'no-id' },
        null,
        'str',
        { id: 'bad-nums', pairedAt: 'x', lastSeenAt: Number.NaN },
      ],
    }),
  );
  assert.deepEqual(list.map((d) => d.id), ['ok', 'bad-nums']);
  assert.equal(list[1].pairedAt, 0, '非法时间回落成 0，不是 NaN');
  assert.equal(list[1].lastSeenAt, 0);
});

test('parseTable：devices 与 revoked 一起读出来；顶层数组老格式仍兼容', () => {
  const table = parseTable(JSON.stringify({ devices: [{ id: 'a' }], revoked: ['gone', '', 5] }));
  assert.deepEqual(table.devices.map((d) => d.id), ['a']);
  assert.deepEqual(table.revoked, ['gone']);
  const legacy = parseTable(JSON.stringify([{ id: 'old' }]));
  assert.deepEqual(legacy.devices.map((d) => d.id), ['old']);
  assert.deepEqual(legacy.revoked, []);
});

test('serializeTable / parseTable 往返一致', () => {
  const table = { devices: [device('a', 7, '手机')], revoked: ['b'] };
  const back = parseTable(serializeTable(table));
  assert.deepEqual(back.devices, table.devices);
  assert.deepEqual(back.revoked, ['b']);
});

test('落盘：register → touch 生效、未登记的 id 不写、删除后进 revoked', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshpet-dev-'));
  assert.deepEqual((await readTable(home)).devices, [], '文件不存在 = 空表');

  const t1 = await registerDevice(home, { id: 'a', name: 'Pixel', at: 10_000 });
  assert.deepEqual(t1.devices.map((d) => d.id), ['a']);
  // 真的写进了磁盘（否则重启后「谁配过」就丢了 → 电脑会永远可写）
  const onDisk = JSON.parse(await readFile(pairedDevicesPath(home), 'utf8')) as { devices: { id: string }[] };
  assert.deepEqual(onDisk.devices.map((d) => d.id), ['a']);

  // 未登记的 id 不写（否则拿到令牌的人能往表里塞设备，把电脑钉成只读）
  const t2 = await touchDevice(home, { id: 'intruder', at: 20_000 });
  assert.deepEqual(t2.devices.map((d) => d.id), ['a']);

  // 心跳：默认 15 秒内不写（省盘），过了就写
  const t3 = await touchDevice(home, { id: 'a', at: 20_000 });
  assert.equal(t3.devices[0].lastSeenAt, 10_000, '间隔不足 15s 不写盘');
  const t4 = await touchDevice(home, { id: 'a', at: 40_000 });
  assert.equal(t4.devices[0].lastSeenAt, 40_000, '超过 15s 刷新');

  // 删除 → 登记表空（电脑恢复可写）+ id 进 revoked
  const t5 = await dropDevice(home, 'a');
  assert.deepEqual(t5.devices, []);
  assert.equal(phoneTakeover(t5.devices, 40_000), false, '删完电脑必须立刻恢复可写');
  assert.equal(isRevoked(t5, 'a'), true);
  assert.equal(isRevoked(t5, 'b'), false);
});

test('重新配对同一台会把它从 revoked 里放出来（删错了能救回来）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshpet-dev2-'));
  await registerDevice(home, { id: 'a', at: 1000 });
  const dropped = await dropDevice(home, 'a');
  assert.equal(isRevoked(dropped, 'a'), true);
  const again = await registerDevice(home, { id: 'a', at: 2000 });
  assert.equal(isRevoked(again, 'a'), false);
  assert.deepEqual(again.devices.map((d) => d.id), ['a']);
});

test('坏文件不阻断任何事（读表失败 = 空表 = 电脑可写）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshpet-dev3-'));
  await mkdir(join(home, 'dsh-pet'), { recursive: true });
  await writeFile(pairedDevicesPath(home), '{ 这不是 json', 'utf8');
  const table = await readTable(home);
  assert.deepEqual(table.devices, []);
  assert.deepEqual(table.revoked, []);
});

test('takeoverReason 给用户看的句子，带不带分钟数都通顺', () => {
  const withMin = takeoverReason(3);
  assert.match(withMin, /手机不在同一网络/);
  assert.match(withMin, /3 分钟前/);
  assert.match(withMin, /自动恢复/);
  assert.match(takeoverReason(), /手机不在同一网络/);
  assert.doesNotMatch(takeoverReason(0), /0 分钟前/, '刚刚要说「刚刚」，不能说 0 分钟前');
});
