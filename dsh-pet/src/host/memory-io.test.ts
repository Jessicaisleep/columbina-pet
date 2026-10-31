/**
 * `./memory-io` 的用例（2026-11-01 地基：原子写 + 消息编号 + 只追加日志）。
 *
 * 钉的是**回家合并依赖的那几条性质**，不是实现细节：
 *   - 编号幂等（同一份老文件重复补号结果不变）——变了就等于每条都是新消息，合并会重复追加；
 *   - 有编号的消息不会被重新发号（用户已经同步过的行不许换号）；
 *   - 单人流与每个群各自编号、互不串号；
 *   - 日志只记「还没记过的」；坏行（上次写一半被杀）不让整份日志不可用；
 *   - 原子写真的落盘、且不留临时文件。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendLogLines,
  assignIds,
  atomicWriteText,
  collectNewLines,
  formatLogLines,
  MEMORY_LOG_FILE,
  readLoggedIds,
  type MemoryTree,
} from './memory-io.ts';

function tree(): MemoryTree {
  return {
    columbina: {
      columbina1: {
        messages: [
          { role: 'user', content: '第一句', ts: 1000 },
          { role: 'assistant', content: '第二句', ts: 2000 },
        ],
        groups: {
          '700': { messages: [{ role: 'user', content: '群里的话', ts: 1500, sender: '1', senderName: 'A' }] },
        },
      },
    },
    main: { main: { messages: [{ role: 'user', content: '蓝毛那句', ts: 2000 }] } },
  };
}

test('assignIds 给缺号的消息补齐，返回补了几条', () => {
  const mem = tree();
  assert.equal(assignIds(mem), 4);
  const c1 = mem.columbina.columbina1.messages;
  assert.equal(typeof c1[0].id, 'string');
  assert.notEqual(c1[0].id, c1[1].id);
  // 单人流与群流各自编号，同 ts 也不撞
  const groupId = mem.columbina.columbina1.groups?.['700'].messages[0].id;
  assert.ok(groupId && groupId.startsWith('m-columbina1/700-'));
  // 跨宠物同 ts 也不撞（前缀带作用域）
  assert.notEqual(mem.main.main.messages[0].id, c1[1].id);
});

test('assignIds 幂等：重复跑不再改号，第二次返回 0', () => {
  const mem = tree();
  assignIds(mem);
  const snapshot = JSON.stringify(mem);
  assert.equal(assignIds(mem), 0);
  assert.equal(JSON.stringify(mem), snapshot);
});

test('已经有编号的消息不会被换号', () => {
  const mem = tree();
  mem.columbina.columbina1.messages[0].id = 'm-手写的-abc';
  assignIds(mem);
  assert.equal(mem.columbina.columbina1.messages[0].id, 'm-手写的-abc');
});

test('collectNewLines 只挑日志里没有的，字段原样带出（缺省字段不写空键）', () => {
  const mem = tree();
  assignIds(mem);
  const first = collectNewLines(mem, new Set());
  assert.equal(first.length, 4);
  const groupLine = first.find((l) => l.group === '700');
  assert.ok(groupLine);
  assert.equal(groupLine.root, 'columbina');
  assert.equal(groupLine.pet, 'columbina1');
  assert.equal(groupLine.sender, '1');
  assert.equal(groupLine.senderName, 'A');
  assert.equal('origin' in groupLine, false); // 没写 origin 就不要造一个空键

  const ids = new Set(first.map((l) => l.id));
  assert.equal(collectNewLines(mem, ids).length, 0);
});

test('readLoggedIds 跳过坏行，其余照收', () => {
  const text = [
    '{"id":"m-a","role":"user","content":"x","ts":1}',
    '',
    '{"id":', // 上次写到一半被杀
    '{"noId":true}',
    '{"id":"m-b"}',
  ].join('\n');
  assert.deepEqual([...readLoggedIds(text)].sort(), ['m-a', 'm-b']);
  assert.equal(readLoggedIds('').size, 0);
});

test('formatLogLines 一行一条、结尾换行；空数组给空串', () => {
  assert.equal(formatLogLines([]), '');
  const text = formatLogLines([
    { id: 'm-1', root: 'r', pet: 'p', group: '', role: 'user', content: 'a', ts: 1 },
    { id: 'm-2', root: 'r', pet: 'p', group: '', role: 'assistant', content: 'b', ts: 2 },
  ]);
  assert.equal(text.split('\n').length, 3); // 两条 + 结尾空段
  assert.ok(text.endsWith('\n'));
  assert.equal(readLoggedIds(text).size, 2);
});

test('appendLogLines 追加不改旧行（连追两次，旧行还在）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memlog-'));
  const path = join(dir, MEMORY_LOG_FILE);
  await appendLogLines(path, [{ id: 'm-1', root: 'r', pet: 'p', group: '', role: 'user', content: 'a', ts: 1 }]);
  await appendLogLines(path, [{ id: 'm-2', root: 'r', pet: 'p', group: '', role: 'user', content: 'b', ts: 2 }]);
  const ids = readLoggedIds(await readFile(path, 'utf8'));
  assert.deepEqual([...ids].sort(), ['m-1', 'm-2']);
});

test('atomicWriteText 写入内容、覆盖旧文件、不留临时文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memio-'));
  const path = join(dir, 'memory.json');
  await writeFile(path, '{"old":true}', 'utf8');
  await atomicWriteText(path, '{"new":true}');
  assert.equal(await readFile(path, 'utf8'), '{"new":true}');
  const left = (await readdir(dir)).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(left, []);
});

test('assignIds 忽略坏结构（messages 不是数组 / 条目是 null）', () => {
  const mem = {
    broken: { pet1: null },
    weird: { pet2: { messages: 'not-an-array' } },
    ok: { pet3: { messages: [{ role: 'user', content: 'hi', ts: 1 }] } },
  } as unknown as MemoryTree;
  assert.equal(assignIds(mem), 1);
  assert.equal(typeof (mem.ok.pet3.messages[0] as { id?: string }).id, 'string');
});
