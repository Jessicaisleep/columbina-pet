/**
 * 接收端合并（`./chat-merge`）。
 *
 * 这一层的风险是「永远不回复」：窗口不断被新消息重置、或者一批跑挂了把等待者晾着。
 * 这里逐条钉住：窗口内连发只跑一次、超条数/超时立刻发、0 窗口不合并、run 抛错要传出去。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChatMerger, MERGE_WINDOW_DEFAULT_MS, mergeWindowMsOf } from './chat-merge';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('窗口内连发三条 → run 只跑一次，且拿到三条', async () => {
  const batches: string[][] = [];
  const merger = new ChatMerger<string, string>({
    run: (items) => {
      batches.push(items);
      return Promise.resolve(items.join('|'));
    },
  });
  const a = merger.submit('一', 40);
  const b = merger.submit('二', 40);
  await sleep(10);
  const c = merger.submit('三', 40);
  const out = await Promise.all([a, b, c]);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], ['一', '二', '三']);
  // 一批只生成一次，所有等待者共享同一个结果（这是「不会一条一回」的核心）
  assert.deepEqual(out, ['一|二|三', '一|二|三', '一|二|三']);
  assert.equal(merger.size, 0);
});

test('窗口 0 = 关合并：立刻发，且一条一批', async () => {
  const batches: string[][] = [];
  const merger = new ChatMerger<string, string>({
    run: (items) => {
      batches.push(items);
      return Promise.resolve(items.join('|'));
    },
  });
  assert.equal(await merger.submit('一', 0), '一');
  assert.equal(await merger.submit('二', 0), '二');
  assert.deepEqual(batches, [['一'], ['二']]);
});

test('达到条数上限立刻发，不再等窗口', async () => {
  const batches: string[][] = [];
  const merger = new ChatMerger<string, string>({
    run: (items) => {
      batches.push(items);
      return Promise.resolve(items.join('|'));
    },
    maxTexts: 2,
  });
  const a = merger.submit('一', 5_000);
  const b = merger.submit('二', 5_000);
  // 上限一到就发，绝不会等 5 秒
  const started = Date.now();
  await Promise.all([a, b]);
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(batches, [['一', '二']]);
});

test('不断有新消息时，硬上限到了也一定发出（不会永远等下去）', async () => {
  const batches: string[][] = [];
  const merger = new ChatMerger<string, string>({
    run: (items) => {
      batches.push(items);
      return Promise.resolve(items.join('|'));
    },
    maxWaitMs: 80,
    maxTexts: 99,
  });
  const waits: Promise<string>[] = [];
  // 每 20ms 发一条，窗口 200ms 远大于硬上限 80ms：靠硬上限兜底
  for (let i = 0; i < 8; i += 1) {
    waits.push(merger.submit(String(i), 200));
    await sleep(20);
  }
  await Promise.all(waits);
  assert.ok(batches.length >= 1);
  assert.ok(batches.flat().length === 8);
});

test('run 抛错 → 所有等待者都收到 reject（不静默吞掉）', async () => {
  const merger = new ChatMerger<string, string>({
    run: () => Promise.reject(new Error('模型挂了')),
  });
  const a = merger.submit('一', 30);
  const b = merger.submit('二', 30);
  await assert.rejects(a, /模型挂了/);
  await assert.rejects(b, /模型挂了/);
  assert.equal(merger.size, 0);
});

test('flush 可以立刻把攒着的发出去（停服用）', async () => {
  const batches: string[][] = [];
  const merger = new ChatMerger<string, string>({
    run: (items) => {
      batches.push(items);
      return Promise.resolve(items.join('|'));
    },
  });
  const a = merger.submit('一', 10_000);
  assert.equal(merger.size, 1);
  merger.flush();
  assert.equal(await a, '一');
  assert.deepEqual(batches, [['一']]);
});

test('合并窗口读取：缺键 800、0 合法、上限夹到 3000、坏值回默认', () => {
  assert.equal(mergeWindowMsOf(undefined), MERGE_WINDOW_DEFAULT_MS);
  assert.equal(mergeWindowMsOf({}), MERGE_WINDOW_DEFAULT_MS);
  assert.equal(mergeWindowMsOf({ chatMergeWindowMs: 0 }), 0);
  assert.equal(mergeWindowMsOf({ chatMergeWindowMs: 500 }), 500);
  assert.equal(mergeWindowMsOf({ chatMergeWindowMs: 99_999 }), 3_000);
  assert.equal(mergeWindowMsOf({ chatMergeWindowMs: -1 }), MERGE_WINDOW_DEFAULT_MS);
  assert.equal(mergeWindowMsOf({ chatMergeWindowMs: 'abc' }), MERGE_WINDOW_DEFAULT_MS);
});
