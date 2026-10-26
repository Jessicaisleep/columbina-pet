/**
 * 助手沙箱与权限模型的单测（2026-10-26）。
 *
 * 重点覆盖三件容易出错的事：
 *   ① 路径穿越（`../../` 归一化后必须落在工作区外）；
 *   ② 三档权限的边界（只读也**不能读全盘**）；
 *   ③ 一次性授权只对「同工具 + 同目标」生效、用过即焚。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import {
  checkRead,
  checkWrite,
  GrantStore,
  isAssistantPermission,
  isInsideWorkspace,
  resolvePetWorkspace,
  resolveTarget,
  resolveWorkspaceRoot,
  ASSISTANT_PERMISSIONS,
} from './permissions.ts';

const WS = resolve('C:\\fake-root\\宠物工作区\\columbina1');

test('isAssistantPermission：只认三档，其余一律 false', () => {
  assert.equal(isAssistantPermission('readonly'), true);
  assert.equal(isAssistantPermission('workspace'), true);
  assert.equal(isAssistantPermission('full'), true);
  for (const bad of ['', 'READONLY', 'admin', null, undefined, 0, {}, []]) {
    assert.equal(isAssistantPermission(bad), false, `应拒绝 ${JSON.stringify(bad)}`);
  }
  assert.deepEqual([...ASSISTANT_PERMISSIONS], ['readonly', 'workspace', 'full']);
});

test('isInsideWorkspace：工作区根本身算内，兄弟目录算外', () => {
  assert.equal(isInsideWorkspace(WS, WS), true);
  assert.equal(isInsideWorkspace(WS, join(WS, 'a.txt')), true);
  assert.equal(isInsideWorkspace(WS, join(WS, 'sub', 'deep', 'b.txt')), true);
  // 前缀相同但是兄弟目录（columbina1 与 columbina10）——必须判外
  assert.equal(isInsideWorkspace(WS, resolve('C:\\fake-root\\宠物工作区\\columbina10')), false);
  assert.equal(isInsideWorkspace(WS, resolve('C:\\fake-root\\宠物工作区\\columbina10\\x.txt')), false);
  // 完全无关
  assert.equal(isInsideWorkspace(WS, resolve('C:\\Windows\\System32')), false);
});

test('isInsideWorkspace：路径穿越归一化后落在工作区内（防越界）', () => {
  const escaped = resolveTarget(WS, '../../secret.txt');
  // 归一化后确实跑到工作区外
  assert.equal(isInsideWorkspace(WS, escaped), false, '三段 ../ 应越出工作区');
  const inner = resolveTarget(WS, 'a/../b.txt');
  assert.equal(isInsideWorkspace(WS, inner), true, '工作区内部的 ../ 应仍算内');
});

test('resolveTarget：相对路径按工作区解析，绝对路径原样', () => {
  assert.equal(resolveTarget(WS, 'notes/a.txt'), join(WS, 'notes', 'a.txt'));
  assert.equal(resolveTarget(WS, ''), WS);
  assert.equal(resolveTarget(WS, 'C:\\Windows\\win.ini'), resolve('C:\\Windows\\win.ini'));
});

test('checkRead：full 放行任意；其他两档只放行工作区内', () => {
  const inside = join(WS, 'a.txt');
  const outside = resolve('C:\\Windows\\win.ini');
  for (const perm of ['readonly', 'workspace'] as const) {
    assert.equal(checkRead(perm, WS, inside).ok, true, `${perm} 应能读工作区内`);
    const r = checkRead(perm, WS, outside);
    assert.equal(r.ok, false, `${perm} 不该能读工作区外`);
    if (!r.ok) assert.equal(r.reason, 'outside-workspace');
  }
  assert.equal(checkRead('full', WS, outside).ok, true);
});

test('checkWrite：readonly 一律拒；workspace 只放行内部；full 全放行', () => {
  const inside = join(WS, 'a.txt');
  const outside = resolve('C:\\Windows\\win.ini');

  const r1 = checkWrite('readonly', WS, inside);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.reason, 'readonly', '只读档即使在工作区内也拒写');

  assert.equal(checkWrite('workspace', WS, inside).ok, true);
  const r2 = checkWrite('workspace', WS, outside);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, 'outside-workspace');

  assert.equal(checkWrite('full', WS, outside).ok, true);
});

test('GrantStore：同工具同目标才放行，不同目标不放行', () => {
  const g = new GrantStore(60_000);
  const target = join(WS, 'a.txt');
  assert.equal(g.has('write_file', target), false, '未授权时为 false');
  g.grant('write_file', target);
  assert.equal(g.has('write_file', target), true);
  // 工具不同 -> 不放行
  assert.equal(g.has('append_file', target), false);
  // 目标不同 -> 不放行
  assert.equal(g.has('write_file', join(WS, 'b.txt')), false);
});

test('GrantStore：consume 是一次性——用过就没了', () => {
  const g = new GrantStore(60_000);
  const target = join(WS, 'a.txt');
  g.grant('write_file', target);
  assert.equal(g.has('write_file', target), true);
  g.consume('write_file', target);
  assert.equal(g.has('write_file', target), false, 'consume 后应失效');
});

test('GrantStore：过期后失效', async () => {
  const g = new GrantStore(30);
  const target = join(WS, 'a.txt');
  g.grant('write_file', target);
  assert.equal(g.has('write_file', target), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(g.has('write_file', target), false, '超过 TTL 应失效');
});

test('GrantStore：clear 清空全部（换权限档位时用）', () => {
  const g = new GrantStore(60_000);
  g.grant('write_file', join(WS, 'a.txt'));
  g.grant('append_file', join(WS, 'b.txt'));
  g.clear();
  assert.equal(g.has('write_file', join(WS, 'a.txt')), false);
  assert.equal(g.has('append_file', join(WS, 'b.txt')), false);
});

test('resolvePetWorkspace：每只宠物一个目录，且 petId 被清洗（防穿越）', () => {
  const root = resolve('C:\\app');
  assert.equal(resolvePetWorkspace(root, 'columbina1'), join(root, '宠物工作区', 'columbina1'));
  // 两只宠物目录不同 —— 这是「互不覆盖」的核心保证
  assert.notEqual(resolvePetWorkspace(root, 'main'), resolvePetWorkspace(root, 'columbina1'));
  // 注入尝试被清洗：路径分隔符与 .. 都不会保留
  const evil = resolvePetWorkspace(root, '../../evil');
  assert.ok(isInsideWorkspace(join(root, '宠物工作区'), evil), '恶意 petId 仍必须落在 宠物工作区/ 下');
  assert.equal(evil.includes('..'), false, '清洗后不应含 ..');
  // 空 id 也不产出空目录段
  assert.equal(resolvePetWorkspace(root, '   '), join(root, '宠物工作区', 'pet'));
  // 中文 id 保留
  assert.equal(resolvePetWorkspace(root, '哥伦比娅'), join(root, '宠物工作区', '哥伦比娅'));
});

test('resolveWorkspaceRoot：DSH_HOME 上一级像安装目录时用上一级', () => {
  // 用一个真实存在的目录做判据：本仓库根（含 dsh-pet 子目录，但不含那三个标记）→ 不应认成安装目录
  const fakeHome = resolve('C:\\nonexistent-app\\data');
  const out = resolveWorkspaceRoot(fakeHome);
  // 因为 C:\nonexistent-app 下没有 dsh-pet.exe/resources/启动桌宠.bat，会退回 data/workspace
  assert.equal(out, join(resolve('C:\\nonexistent-app\\data'), 'workspace'));
});
