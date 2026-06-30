'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { lintScripts } = require('./lint-test-cmd');

const CLI = path.join(__dirname, 'lint-test-cmd.js');
const PKG = path.join(__dirname, 'fixtures', 'pkg');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(PKG, name), 'utf8'));
}

test('flags the audited --passWithNoTests snippet (DoD: gate RED)', () => {
  const v = lintScripts(load('ban-passwithnotests.json'));
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].flag, '--passWithNoTests');
});

test('flags the audited --no-frozen-lockfile snippet (DoD: gate RED)', () => {
  const v = lintScripts(load('ban-frozen.json'));
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].flag, '--no-frozen-lockfile');
});

test('clean scripts pass (DoD: gate GREEN)', () => {
  assert.deepStrictEqual(lintScripts(load('clean.json')), []);
});

test('matches the flag case-insensitively', () => {
  const v = lintScripts({ scripts: { test: 'vitest --PASSWITHNOTESTS' } });
  assert.strictEqual(v.length, 1);
});

test('tolerates a package with no scripts block', () => {
  assert.deepStrictEqual(lintScripts({ name: 'x' }), []);
});

test('CLI exits 1 on a banned snippet and 0 on a clean package', () => {
  const r1 = spawnSync('node', [CLI, path.join(PKG, 'ban-passwithnotests.json')], {
    encoding: 'utf8',
  });
  assert.strictEqual(r1.status, 1);
  assert.match(r1.stderr, /::error::lint-test-cmd/);

  const r2 = spawnSync('node', [CLI, path.join(PKG, 'clean.json')], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 0);
});

test('CLI exits 0 (skips) when package.json is absent', () => {
  const r = spawnSync('node', [CLI, path.join(PKG, 'does-not-exist.json')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});
