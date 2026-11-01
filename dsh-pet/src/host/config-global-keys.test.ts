/**
 * 全局键的合并回归（2026-11-01）。
 *
 * 发现的真 bug：`mergeEntry` 只遍历**内置默认**的键，于是「用户层写了、内置默认没列」
 * 的全局字段会被静默丢掉——设置页保存成功、磁盘上也有值，读出来却是代码里的硬默认。
 * 实测：`memoryRecallK` 存成 4，`/assistant/settings` 读回 3；群聊那五个键、
 * 记忆压缩三个键同理。这一组用例把「存得进去 = 读得出来」钉住。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readAllConfig, type ConfigPaths } from './config';

/** 一份最小的内置默认：**故意只列极少字段**，模拟「默认文件没写这个键」的真实情况 */
const MINIMAL_BASE = {
  chatMemoryRounds: 5,
  whisperPrompt: '你是桌面宠物',
  animations: { idle: ['待机呼吸'], clicks: ['点击回应'], moves: { actions: [] } },
  pets: [],
};

function merge(overlay: Record<string, unknown>): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-global-keys-'));
  try {
    const paths: ConfigPaths = {
      defaultFile: join(dir, 'default.jsonc'),
      userFile: join(dir, 'main-config.jsonc'),
      petDir: join(dir, 'pet'), // 不存在 = 没有文件宠物
    };
    writeFileSync(paths.defaultFile, JSON.stringify(MINIMAL_BASE));
    writeFileSync(paths.userFile, JSON.stringify(overlay));
    return readAllConfig(paths).main;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readAllConfig —— 内置默认没列的全局键也要从用户层取到', () => {
  test('memoryRecallK：默认文件没写这一行，用户层的值仍然生效', () => {
    const main = merge({ memoryRecallK: 4 });
    assert.equal(main.memoryRecallK, 4, '存得进去就得读得出来，否则「每次回捞往事」是假的');
  });

  test('群聊五个键整套生效', () => {
    const main = merge({
      groupBotEnabled: true,
      groupMemoryScope: 'recent',
      groupMemoryRecentN: 25,
      ownerQq: '100012345',
      ownerSyncEnabled: true,
    });
    assert.equal(main.groupBotEnabled, true);
    assert.equal(main.groupMemoryScope, 'recent');
    assert.equal(main.groupMemoryRecentN, 25);
    assert.equal(main.ownerQq, '100012345');
    assert.equal(main.ownerSyncEnabled, true);
  });

  test('记忆压缩三个键整套生效', () => {
    const main = merge({ memoryCompressEnabled: true, memoryCompressRounds: 30, memoryKeepRounds: 12 });
    assert.equal(main.memoryCompressEnabled, true);
    assert.equal(main.memoryCompressRounds, 30);
    assert.equal(main.memoryKeepRounds, 12);
  });

  test('回话节奏两个键（本次新增）在默认文件里没有时也生效', () => {
    const main = merge({ chatSplitEnabled: false, chatMergeWindowMs: 1200 });
    assert.equal(main.chatSplitEnabled, false, '显式关掉分条必须能读回来（默认是开）');
    assert.equal(main.chatMergeWindowMs, 1200);
  });

  test('非法值不采信，也不写进结果（保持「取代码默认」）', () => {
    const main = merge({ memoryRecallK: 999, chatMergeWindowMs: -5 });
    assert.equal(main.memoryRecallK, undefined, '越界值不该被放进来');
    assert.equal(main.chatMergeWindowMs, undefined);
  });

  test('内置默认里已有的键行为不变（用户层覆盖）', () => {
    const main = merge({ chatMemoryRounds: 9 });
    assert.equal(main.chatMemoryRounds, 9);
  });

  test('非全局键不会被这条通路偷偷放进条目（只认 GLOBAL_DEFAULT_KEYS）', () => {
    const main = merge({ 随便写的键: 1 });
    assert.equal(main['随便写的键'], undefined);
  });
});
