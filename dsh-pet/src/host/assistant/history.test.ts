/**
 * 助手操作记录的单测（2026-10-26）。
 *
 * 验四件事：截断边界、坏行容忍、体积裁剪、清空。
 * 全部在临时目录跑真实 fs——JSONL 的正确性靠 fs 行为本身，桩不出错。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecord, buildRecord, clearRecords, countRecords, readRecords } from './history.ts';

function withTmp(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-hist-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function sample(over: Partial<Parameters<typeof buildRecord>[0]> = {}): Parameters<typeof buildRecord>[0] {
  return {
    petId: 'columbina1',
    petName: '哥伦比娅',
    permission: 'workspace',
    userText: '建一个 a.txt',
    status: 'ok',
    reply: '写好了。',
    steps: [{ name: 'write_file', args: { path: 'a.txt', content: 'xyz' }, ok: true, summary: '已写入' }],
    ms: 1234,
    now: 1_700_000_000_000,
    ...over,
  };
}

test('buildRecord：正常构造，字段齐全', () => {
  const r = buildRecord(sample());
  assert.equal(r.petId, 'columbina1');
  assert.equal(r.petName, '哥伦比娅');
  assert.equal(r.permission, 'workspace');
  assert.equal(r.status, 'ok');
  assert.equal(r.ms, 1234);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].name, 'write_file');
});

test('buildRecord：content 只记长度不记内容（隐私）', () => {
  const r = buildRecord(
    sample({ steps: [{ name: 'write_file', args: { path: 'a.txt', content: '机密内容不该出现在记录里' }, ok: true, summary: 'ok' }] }),
  );
  assert.match(r.steps[0].args, /content=<\d+ 字>/);
  assert.equal(r.steps[0].args.includes('机密内容'), false, '正文内容不能进记录');
  assert.match(r.steps[0].args, /path=a\.txt/);
});

test('buildRecord：超长指令与回复按字符截断并加省略号', () => {
  const r = buildRecord(sample({ userText: '啊'.repeat(2000), reply: '嗯'.repeat(3000) }));
  assert.ok(r.userText.length <= 501, `userText 应截断，实际 ${r.userText.length}`);
  assert.ok(r.userText.endsWith('…'));
  assert.ok(r.reply.length <= 1001, `reply 应截断，实际 ${r.reply.length}`);
});

test('buildRecord：步骤数上限 20，超出丢弃', () => {
  const steps = Array.from({ length: 30 }, (_, i) => ({ name: 't' + i, args: {}, ok: true, summary: '' }));
  const r = buildRecord(sample({ steps }));
  assert.equal(r.steps.length, 20);
});

test('appendRecord + readRecords：写入后能按时间倒序读回', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  await appendRecord(paths, buildRecord(sample({ now: 1000, userText: '第一条' })));
  await appendRecord(paths, buildRecord(sample({ now: 2000, userText: '第二条' })));
  const got = await readRecords(paths, 10);
  assert.equal(got.length, 2);
  assert.equal(got[0].userText, '第二条', '新的应在前面');
  assert.equal(got[1].userText, '第一条');
}));

test('readRecords：limit 生效', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  for (let i = 0; i < 10; i++) await appendRecord(paths, buildRecord(sample({ now: 1000 + i })));
  const got = await readRecords(paths, 3);
  assert.equal(got.length, 3);
}));

test('readRecords：坏行被跳过，不影响其他行（JSONL 的核心价值）', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  const good = JSON.stringify(buildRecord(sample({ now: 5000 })));
  writeFileSync(paths.file, '这不是 JSON\n' + good + '\n{"ts": 123}\n', 'utf8');
  const got = await readRecords(paths, 10);
  assert.equal(got.length, 1, '只应读出那条合法且完整的记录');
  assert.equal(got[0].ts, 5000);
}));

test('readRecords：文件不存在返回空数组（不抛）', withTmp(async (dir) => {
  const got = await readRecords({ file: join(dir, 'none.jsonl') }, 10);
  assert.deepEqual(got, []);
}));

test('countRecords：数出非空行', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  await appendRecord(paths, buildRecord(sample({ now: 1 })));
  await appendRecord(paths, buildRecord(sample({ now: 2 })));
  assert.equal(await countRecords(paths), 2);
}));

test('clearRecords：清空后条数为 0，且文件仍存在（不是删除）', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  await appendRecord(paths, buildRecord(sample()));
  assert.equal(await countRecords(paths), 1);
  const ok = await clearRecords(paths);
  assert.equal(ok, true);
  assert.equal(existsSync(paths.file), true, '清空应是写空文件，不是删文件');
  assert.equal(await countRecords(paths), 0);
  assert.equal(readFileSync(paths.file, 'utf8'), '');
}));

test('appendRecord：目录不存在会自动创建', withTmp(async (dir) => {
  const paths = { file: join(dir, 'deep', 'nested', 'h.jsonl') };
  const ok = await appendRecord(paths, buildRecord(sample()));
  assert.equal(ok, true);
  assert.equal(existsSync(paths.file), true);
}));

test('体积裁剪：超过上限时保留最近 KEEP_ENTRIES 条，文件不再无限增长', withTmp(async (dir) => {
  const paths = { file: join(dir, 'h.jsonl') };
  // 写 600 条带长文本的记录，逼出 512 KB 上限
  const big = 'x'.repeat(900);
  for (let i = 0; i < 600; i++) {
    await appendRecord(paths, buildRecord(sample({ now: 1000 + i, reply: big })));
  }
  const size = readFileSync(paths.file).length;
  assert.ok(size <= 600 * 1024, `文件应被裁剪，实际 ${size} 字节`);
  const n = await countRecords(paths);
  assert.ok(n <= 500, `裁剪后应 ≤500 条，实际 ${n}`);
  // 保留的必须是最新的：最后一条的 ts 应该是最后写的那条
  const got = await readRecords(paths, 1);
  assert.equal(got[0].ts, 1000 + 599);
}));
