import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOST_ID_FILE, readHostId } from './host-identity';

/**
 * 宿主 id 是「手机同时记住两台电脑」的唯一键，钉住三件事：
 * ① 同一台电脑每次问都给同一个答案（不然手机那边会把一台电脑认成两台）；
 * ② 两台电脑必须不同（不然手机分不开，切换宿主等于没切）；
 * ③ 文件坏了要能自愈，且自愈后仍然稳定。
 */
function freshHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-hostid-'));
}

test('第一次调用生成 id 并落盘，第二次调用给同一个值', () => {
  const home = freshHome();
  const first = readHostId(home);
  assert.match(first, /^[0-9a-f-]{36}$/, '应该是 uuid 形状，实际 ' + first);
  const saved = readFileSync(join(home, 'dsh-pet', HOST_ID_FILE), 'utf8').trim();
  assert.equal(saved, first, '落盘内容必须与返回值一致');
  assert.equal(readHostId(home), first, '同一台电脑第二次必须同值');
});

test('两台电脑（不同数据目录）必须给不同 id', () => {
  const a = freshHome();
  const b = freshHome();
  assert.notEqual(readHostId(a), readHostId(b));
});

test('文件被写脏（空文件 / 垃圾）时自愈，并覆盖成合法 id', () => {
  const home = freshHome();
  mkdirSync(join(home, 'dsh-pet'), { recursive: true });
  writeFileSync(join(home, 'dsh-pet', HOST_ID_FILE), '   \n\n', 'utf8');
  const id = readHostId(home);
  assert.match(id, /^[0-9a-f-]{36}$/, '空文件应该重新生成一个合法 id');
  assert.equal(readFileSync(join(home, 'dsh-pet', HOST_ID_FILE), 'utf8').trim(), id);
});

test('文件里的超长内容会被截断，不会把一大块垃圾带进响应', () => {
  const home = freshHome();
  mkdirSync(join(home, 'dsh-pet'), { recursive: true });
  writeFileSync(join(home, 'dsh-pet', HOST_ID_FILE), 'x'.repeat(5000), 'utf8');
  assert.equal(readHostId(home).length, 64);
});
