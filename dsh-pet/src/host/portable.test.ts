import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyBackupImport,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  collectBackup,
  isAllowedBackupPath,
  planBackupImport,
  previewMemoryUpgrade,
  readBackup,
  validateBackup,
} from './portable.ts';
import type { ConfigPaths } from './config.ts';

/** 造一套最小可用的 userRoot + configPaths */
function fixture(): { home: string; userRoot: string; paths: ConfigPaths; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pet-backup-'));
  const userRoot = join(home, 'dsh-pet');
  mkdirSync(join(userRoot, 'pet'), { recursive: true });
  // 内置默认：readAllConfig 只需要它能被解析，本测试不调它，但路径必须存在性无关
  const defaultFile = join(home, 'config.jsonc');
  writeFileSync(defaultFile, '{ "pets": [] }\n', 'utf8');
  const paths: ConfigPaths = {
    defaultFile,
    userFile: join(userRoot, 'main-config.jsonc'),
    legacyUserFile: join(userRoot, 'main-config.json'),
    petDir: join(userRoot, 'pet'),
  };
  writeFileSync(
    paths.userFile,
    '{\n  // 用户手写的注释，导出必须原样保留\n  "pets": [{"id":"main","name":"蓝毛小女仆","size":462}]\n}\n',
    'utf8',
  );
  writeFileSync(
    join(userRoot, 'pet', 'nahida-config.json'),
    '{"pets":[{"id":"nahida1","name":"纳西妲","size":350}]}',
    'utf8',
  );
  writeFileSync(join(userRoot, 'memory.json'), '{"x":{"y":[]}}', 'utf8');
  writeFileSync(join(userRoot, 'standalone-ai.json'), '{"apiKey":"sk-secret-value-123"}', 'utf8');
  // 不该被导出的
  writeFileSync(join(userRoot, 'logs.txt'), 'log line', 'utf8');
  writeFileSync(join(userRoot, 'assistant-history.jsonl'), '{"a":1}', 'utf8');
  mkdirSync(join(userRoot, 'uia'), { recursive: true });
  writeFileSync(join(userRoot, 'uia', 'uia-reader.ps1'), '# script', 'utf8');
  return { home, userRoot, paths, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('collectBackup：默认不收密钥、不收日志与助手留痕，且保留配置文件里的注释', () => {
  const f = fixture();
  try {
    const { bundle, skipped } = collectBackup(f.paths, f.userRoot, {
      appVersion: '0.3.9',
      now: new Date('2026-10-27T12:00:00Z'),
    });
    const paths = bundle.files.map((x) => x.path).sort();
    assert.deepEqual(paths, ['main-config.jsonc', 'memory.json', 'pet/nahida-config.json']);
    assert.equal(bundle.format, BACKUP_FORMAT);
    assert.equal(bundle.version, BACKUP_VERSION);
    assert.equal(bundle.includeApiKey, false);
    assert.equal(bundle.exportedAt, '2026-10-27T12:00:00.000Z');
    assert.equal(bundle.appVersion, '0.3.9');
    assert.deepEqual(skipped, []);
    // 注释必须原样在（解析再序列化会吃掉它，那样备份就是有限损失）
    const main = bundle.files.find((x) => x.path === 'main-config.jsonc');
    assert.ok(main !== undefined);
    assert.match(main.text, /\/\/ 用户手写的注释/);
    // 明确不收的三类
    for (const bad of ['logs.txt', 'assistant-history.jsonl', 'uia/uia-reader.ps1']) {
      assert.ok(!paths.includes(bad), `${bad} 不该被导出`);
    }
  } finally {
    f.cleanup();
  }
});

test('collectBackup：显式要求时才收 standalone-ai.json', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot, { includeApiKey: true });
    const paths = bundle.files.map((x) => x.path);
    assert.ok(paths.includes('standalone-ai.json'));
    assert.equal(bundle.includeApiKey, true);
  } finally {
    f.cleanup();
  }
});

test('isAllowedBackupPath：只放行白名单，Path Traversal 一律拒绝', () => {
  const ok = ['main-config.jsonc', 'memory.json', 'standalone-ai.json', 'pet/nahida-config.json'];
  for (const p of ok) assert.equal(isAllowedBackupPath(p), true, `${p} 应放行`);
  const bad = [
    'pet/../main-config.jsonc',
    '../main-config.jsonc',
    '..\\main-config.jsonc',
    'C:\\Windows\\evil.json',
    '/etc/passwd',
    'pet/sub/nahida-config.json',
    'pet/-config.json',
    'pet/a:b-config.json',
    'pet/a/b-config.json',
    'other.json',
    'pet/nahida-config.jsonc',
    '',
    'main-config.jsonc ',
  ];
  for (const p of bad) assert.equal(isAllowedBackupPath(p), false, `${p} 应拒绝`);
});

test('readBackup：往返一致（导出 → 文本 → 校验通过）', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const text = JSON.stringify(bundle);
    const checked = readBackup(text);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.deepEqual(
      checked.bundle.files.map((x) => [x.path, x.sha256]),
      bundle.files.map((x) => [x.path, x.sha256]),
    );
  } finally {
    f.cleanup();
  }
});

test('validateBackup：认出非备份文件/未来版本/空包', () => {
  const base = { format: BACKUP_FORMAT, version: BACKUP_VERSION, files: [] };

  assert.equal(readBackup('这不是 json').ok, false);
  const notJson = readBackup('这不是 json');
  assert.equal(notJson.ok === false && notJson.reason, 'not-json');

  const wrong = validateBackup({ hello: 1 });
  assert.equal(wrong.ok === false && wrong.reason, 'wrong-format');

  const future = validateBackup({ ...base, version: BACKUP_VERSION + 1, files: [{ path: 'memory.json', text: '{}' }] });
  assert.equal(future.ok === false && future.reason, 'unsupported-version');

  const empty = validateBackup({ ...base, files: [] });
  assert.equal(empty.ok === false && empty.reason, 'wrong-format');
});

test('validateBackup：篡改内容会被单文件 sha256 抓住', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const tampered = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    tampered.files[0].text = tampered.files[0].text.replace('462', '999');
    // 整包 sha256 也不对了，但单文件校验会先命中（更精确的报错）
    const checked = validateBackup(tampered);
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.equal(checked.reason, 'file-mismatch');
    assert.equal(checked.file, tampered.files[0].path);
  } finally {
    f.cleanup();
  }
});

test('validateBackup：删掉一个文件会被整包 sha256 抓住', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const slim = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    slim.files = slim.files.filter((x) => x.path !== 'memory.json');
    const checked = validateBackup(slim);
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.equal(checked.reason, 'bundle-mismatch');
  } finally {
    f.cleanup();
  }
});

test('validateBackup：路径越界在导入前就被拒绝（不落盘）', () => {
  const evil = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    files: [{ path: '../../evil.json', text: '{"a":1}' }],
  };
  const checked = validateBackup(evil);
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.equal(checked.reason, 'bad-path');
});

test('validateBackup：内容语法坏掉的配置包被拒绝（别把桌宠搞成起不来）', () => {
  const bad = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    files: [{ path: 'main-config.jsonc', text: '{ "pets": [ ' }],
  };
  const checked = validateBackup(bad);
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.equal(checked.reason, 'bad-content');
});

test('validateBackup：JSONC 带注释与尾逗号的配置是合法的', () => {
  const ok = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    files: [
      {
        path: 'main-config.jsonc',
        text: '{\n  // comment\n  "pets": [{"id":"main"},],\n}\n',
      },
    ],
  };
  const checked = validateBackup(ok);
  assert.equal(checked.ok, true);
});

test('planBackupImport：只读，能算出覆盖/新增', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const before = readFileSync(f.paths.userFile, 'utf8');
    const plan = planBackupImport(f.paths, f.userRoot, bundle);
    assert.equal(plan.length, 3);
    // 三个文件都已存在 → 全是要覆盖
    assert.ok(plan.every((p) => p.overwrite === true));
    assert.ok(plan.every((p) => p.bytes > 0));
    // 关键：plan 不能改磁盘
    assert.equal(readFileSync(f.paths.userFile, 'utf8'), before);
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：写回内容、留 .bak 副本，且副本不会被当成宠物读进去', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    // 先把主配置改坏
    writeFileSync(f.paths.userFile, '{ "pets": [] }', 'utf8');
    const result = applyBackupImport(f.paths, f.userRoot, bundle, {
      now: new Date('2026-10-27T12:34:56Z'),
    });
    assert.equal(result.written.length, 3);
    // 内容确实回来了（含注释）
    assert.match(readFileSync(f.paths.userFile, 'utf8'), /用户手写的注释/);
    // 旧值留了副本：3 个目标文件里 2 个在 userRoot（main-config.jsonc / memory.json）
    // 1 个在 pet/（nahida-config.json），所以 userRoot 下 2 份、pet/ 下 1 份
    assert.equal(result.backups.length, 3);
    const bak = readdirSync(f.userRoot).filter((n) => n.includes('.bak-before-import-'));
    assert.equal(bak.length, 2);
    assert.ok(bak.every((n) => /\.bak-before-import-20261027-123456$/.test(n)));
    // 副本名不匹配 pet/*-config.json，不会被 scanPetFiles 当成一只宠物
    const petBaks = readdirSync(f.paths.petDir).filter((n) => /^.+?-config\.json$/.test(n));
    assert.deepEqual(petBaks, ['nahida-config.json']);
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：备份不含密钥时不动本机密钥文件', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot); // includeApiKey 默认 false
    const aiPath = join(f.userRoot, 'standalone-ai.json');
    const before = readFileSync(aiPath, 'utf8');
    const result = applyBackupImport(f.paths, f.userRoot, bundle);
    assert.equal(result.apiKeyKept, true);
    assert.equal(readFileSync(aiPath, 'utf8'), before, '本机密钥不该被导入清掉');
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：备份带密钥时才会覆盖本机密钥', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot, { includeApiKey: true });
    const aiPath = join(f.userRoot, 'standalone-ai.json');
    writeFileSync(aiPath, '{"apiKey":"sk-different"}', 'utf8');
    const result = applyBackupImport(f.paths, f.userRoot, bundle);
    assert.equal(result.apiKeyKept, false);
    assert.match(readFileSync(aiPath, 'utf8'), /sk-secret-value-123/);
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：能把整棵 pet/ 重建出来（含缺失的文件）', () => {
  const f = fixture();
  try {
    const { bundle } = collectBackup(f.paths, f.userRoot);
    // 删掉一只宠物的配置，模拟「换到新机器」
    rmSync(join(f.userRoot, 'pet', 'nahida-config.json'));
    rmSync(join(f.userRoot, 'memory.json'));
    const plan = planBackupImport(f.paths, f.userRoot, bundle);
    assert.equal(plan.filter((p) => p.overwrite).length, 1); // 只剩 main-config
    applyBackupImport(f.paths, f.userRoot, bundle);
    assert.equal(existsSync(join(f.userRoot, 'pet', 'nahida-config.json')), true);
    assert.equal(existsSync(join(f.userRoot, 'memory.json')), true);
  } finally {
    f.cleanup();
  }
});

test('collectBackup：主配置缺失但存在旧 .json 时回落到它', () => {
  const f = fixture();
  try {
    rmSync(f.paths.userFile);
    // legacyUserFile 在 ConfigPaths 里是可选字段（旧版 .json 回落用），fixture 里一定构造了它
    writeFileSync(f.paths.legacyUserFile!, '{"pets":[]}', 'utf8');
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const main = bundle.files.find((x) => x.path === 'main-config.jsonc');
    assert.ok(main !== undefined);
    assert.equal(main.text, '{"pets":[]}');
  } finally {
    f.cleanup();
  }
});

test('collectBackup：pet/ 里前缀超长的配置文件被跳过而不是让整次导出失败', () => {
  const f = fixture();
  try {
    // 用「前缀超过 64 字」而不是 `bad:name` —— 冒号在 NTFS 上是 ADS 分隔符，
    // writeFileSync 会静默写成另一条数据流，readdirSync 根本看不到它（踩过一次）
    const longPrefix = 'x'.repeat(70);
    writeFileSync(join(f.paths.petDir, `${longPrefix}-config.json`), '{}', 'utf8');
    const { bundle, skipped } = collectBackup(f.paths, f.userRoot);
    assert.ok(
      skipped.some((s) => s.includes(longPrefix)),
      '超长前缀应进 skipped',
    );
    assert.ok(!bundle.files.some((x) => x.path.includes(longPrefix)));
    // 合法的那些照常导出
    assert.ok(bundle.files.some((x) => x.path === 'pet/nahida-config.json'));
  } finally {
    f.cleanup();
  }
});

// ── v2：旧记忆在导出/导入时按新框架归位 ──────────────────────────────

/** 造一份 v1 形状的 memory.json（没有 facts / factsUpto / members） */
function legacyMemory(): string {
  const mk = (msgs: Array<{ role: string; content: string; ts: number }>) => ({
    messages: msgs,
    summarized: 0,
    summary: '',
  });
  return JSON.stringify(
    {
      pet: {
        nahida1: mk([
          { role: 'user', content: '记住我住在杭州。', ts: 1000 },
          { role: 'assistant', content: '好的，杭州。', ts: 1001 },
          { role: 'user', content: '我养了一只猫叫团子。', ts: 1002 },
          { role: 'assistant', content: '团子真可爱。', ts: 1003 },
        ]),
      },
    },
    null,
    2,
  );
}

test('collectBackup：导出的 memory.json 已按新框架补事实卡（v2 形状）', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.userRoot, 'memory.json'), legacyMemory(), 'utf8');
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const mem = bundle.files.find((x) => x.path === 'memory.json');
    assert.ok(mem !== undefined);
    const parsed = JSON.parse(mem.text) as Record<string, Record<string, Record<string, unknown>>>;
    const entry = parsed.pet.nahida1;
    assert.ok(Array.isArray(entry.facts), '导出物里应该有 facts 数组');
    const facts = entry.facts as Array<{ kind: string; key: string; value: string }>;
    assert.deepEqual(facts.map((x) => `${x.kind}|${x.key}=${x.value}`).sort(), [
      'identity|city=杭州',
      'identity|pet=猫·团子',
    ]);
    assert.equal(entry.factsUpto, 4, '迁移标记应为消息条数');
    assert.equal(bundle.version, BACKUP_VERSION);
    assert.equal(BACKUP_VERSION, 2, '导出物升到 v2');
  } finally {
    f.cleanup();
  }
});

test('collectBackup：已经是新框架的 memory.json 导出时原样不动（幂等）', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.userRoot, 'memory.json'), legacyMemory(), 'utf8');
    const first = collectBackup(f.paths, f.userRoot).bundle.files.find((x) => x.path === 'memory.json');
    assert.ok(first !== undefined);
    // 把升级后的文本写回磁盘，再导出一次：应当逐字节一致
    writeFileSync(join(f.userRoot, 'memory.json'), first.text, 'utf8');
    const second = collectBackup(f.paths, f.userRoot).bundle.files.find((x) => x.path === 'memory.json');
    assert.ok(second !== undefined);
    assert.equal(second.text, first.text, '第二次导出不应再改一个字');
    assert.equal(second.sha256, first.sha256);
  } finally {
    f.cleanup();
  }
});

test('collectBackup：memory.json 不是合法 JSON 时照原文导出（备份不该因升级失败少个文件）', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.userRoot, 'memory.json'), 'not json at all', 'utf8');
    const { bundle } = collectBackup(f.paths, f.userRoot);
    const mem = bundle.files.find((x) => x.path === 'memory.json');
    assert.ok(mem !== undefined, '文件仍然在包里');
    assert.equal(mem.text, 'not json at all', '原文照抄，不因升级失败丢内容');
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：导入 v1 老包时记忆自动归位，并报出回填条数', () => {
  const f = fixture();
  try {
    // 手工拼一个 v1 包（version:1，memory 是旧形状），模拟老用户手里的备份
    const files = [
      { path: 'memory.json', text: legacyMemory() },
      { path: 'pet/nahida-config.json', text: '{"pets":[{"id":"nahida1","name":"纳西妲"}]}' },
    ].map((x) => ({ ...x, sha256: createHash('sha256').update(x.text, 'utf8').digest('hex') }));
    const bundle = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.3.8',
      includeApiKey: false,
      files,
      sha256: '',
    } as unknown as Parameters<typeof applyBackupImport>[2];

    const result = applyBackupImport(f.paths, f.userRoot, bundle, {
      now: new Date('2026-10-30T00:00:00Z'),
    });
    assert.equal(result.memoryUpgraded, true);
    assert.equal(result.factsAdded, 2);

    const onDisk = JSON.parse(readFileSync(join(f.userRoot, 'memory.json'), 'utf8')) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entry = onDisk.pet.nahida1;
    assert.ok(Array.isArray(entry.facts), '落盘的记忆应当已是新框架');
    assert.equal((entry.facts as unknown[]).length, 2);
    assert.equal(entry.factsUpto, 4);
  } finally {
    f.cleanup();
  }
});

test('applyBackupImport：导入已是 v2 的包时不重复回填、factsAdded 为 0', () => {
  const f = fixture();
  try {
    // 先导一次 v1 让磁盘变成 v2 形状，再把这个 v2 文本原样当新包导进来
    const first = [{ path: 'memory.json', text: legacyMemory() }].map((x) => ({
      ...x,
      sha256: createHash('sha256').update(x.text, 'utf8').digest('hex'),
    }));
    applyBackupImport(f.paths, f.userRoot, {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '',
      includeApiKey: false,
      files: first,
      sha256: '',
    } as unknown as Parameters<typeof applyBackupImport>[2]);

    const upgraded = readFileSync(join(f.userRoot, 'memory.json'), 'utf8');
    const second = [{ path: 'memory.json', text: upgraded }].map((x) => ({
      ...x,
      sha256: createHash('sha256').update(x.text, 'utf8').digest('hex'),
    }));
    const result = applyBackupImport(f.paths, f.userRoot, {
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: new Date().toISOString(),
      appVersion: '',
      includeApiKey: false,
      files: second,
      sha256: '',
    } as unknown as Parameters<typeof applyBackupImport>[2]);

    assert.equal(result.memoryUpgraded, false, 'v2 已经是新形状，不该再升级');
    assert.equal(result.factsAdded, 0);
    assert.equal(readFileSync(join(f.userRoot, 'memory.json'), 'utf8'), upgraded);
  } finally {
    f.cleanup();
  }
});

test('previewMemoryUpgrade：干跑只算不写，v1 记忆报出会回填几条', () => {
  const p = previewMemoryUpgrade(legacyMemory());
  assert.deepEqual(p, { willUpgrade: true, factsAdded: 2 });
  assert.equal(previewMemoryUpgrade('{"pet":{}}'), undefined, '没有可迁移的叶子 → 不给这一行');
  assert.equal(previewMemoryUpgrade('not json'), undefined);
});
