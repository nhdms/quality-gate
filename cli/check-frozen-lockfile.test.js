'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { decide, decideForDir, hasDependencies } = require('./check-frozen-lockfile');

const CLI = path.join(__dirname, 'check-frozen-lockfile.js');

test('chooses npm ci for package-lock.json', () => {
  const d = decide({ lockfiles: ['package-lock.json'], pkg: {} });
  assert.deepStrictEqual(d.cmd, ['npm', 'ci']);
});

test('chooses pnpm --frozen-lockfile for pnpm-lock.yaml', () => {
  const d = decide({ lockfiles: ['pnpm-lock.yaml'], pkg: {} });
  assert.deepStrictEqual(d.cmd, ['pnpm', 'install', '--frozen-lockfile']);
});

test('chooses yarn --immutable for yarn.lock', () => {
  const d = decide({ lockfiles: ['yarn.lock'], pkg: {} });
  assert.deepStrictEqual(d.cmd, ['yarn', 'install', '--immutable']);
});

test('FAILS when deps are declared but no lockfile exists (DoD: gate RED)', () => {
  const d = decide({ lockfiles: [], pkg: { dependencies: { left: '1' } } });
  assert.strictEqual(d.action, 'fail');
});

test('SKIPS when there is no lockfile and no deps (DoD: gate GREEN)', () => {
  const d = decide({ lockfiles: [], pkg: { name: 'x' } });
  assert.strictEqual(d.action, 'skip');
});

test('hasDependencies detects each dependency bucket', () => {
  assert.strictEqual(hasDependencies({ devDependencies: { a: '1' } }), true);
  assert.strictEqual(hasDependencies({ optionalDependencies: { a: '1' } }), true);
  assert.strictEqual(hasDependencies({}), false);
  assert.strictEqual(hasDependencies(null), false);
});

test('decideForDir reads lockfiles and package.json from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-lock-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    const d = decideForDir(dir);
    assert.strictEqual(d.action, 'install');
    assert.deepStrictEqual(d.cmd, ['npm', 'ci']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 1 when deps declared without a lockfile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-lock-cli-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { left: '1.0.0' } })
    );
    const r = spawnSync('node', [CLI, dir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /::error::frozen-lockfile/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 0 (skip) on an empty dir, and when disabled via flag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-lock-skip-'));
  try {
    const r1 = spawnSync('node', [CLI, dir], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 0);
    const r2 = spawnSync('node', [CLI, dir, 'false'], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0);
    assert.match(r2.stdout, /disabled via config/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
