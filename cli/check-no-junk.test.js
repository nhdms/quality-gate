'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { findJunk } = require('./check-no-junk');

const CLI = path.join(__dirname, 'check-no-junk.js');

test('flags an added .omc/ path (DoD: gate RED)', () => {
  const v = findJunk([{ path: '.omc/state/run.json' }]);
  assert.strictEqual(v.length, 1);
  assert.match(v[0].reason, /banned path/);
});

test('flags node_modules and build bundles', () => {
  const v = findJunk(['node_modules/left-pad/index.js', 'dist/app.bundle.js', 'a.min.js']);
  assert.strictEqual(v.length, 3);
});

test('flags a 5MB png over the size limit (DoD: gate RED)', () => {
  const v = findJunk([{ path: 'docs/hero.png', size: 5 * 1024 * 1024 }]);
  assert.strictEqual(v.length, 1);
  assert.match(v[0].reason, /exceeds limit/);
});

test('allows a small png under the limit', () => {
  const v = findJunk([{ path: 'docs/icon.png', size: 2048 }]);
  assert.deepStrictEqual(v, []);
});

test('a clean source diff passes (DoD: gate GREEN)', () => {
  const v = findJunk([{ path: 'src/index.ts' }, { path: 'README.md', size: 100 }]);
  assert.deepStrictEqual(v, []);
});

test('allowlist exempts an otherwise-banned path', () => {
  const v = findJunk([{ path: 'dist/keep.js' }], { allow: ['dist/'] });
  assert.deepStrictEqual(v, []);
});

test('custom bannedPaths override defaults', () => {
  const v = findJunk([{ path: 'secret/data.txt' }], { bannedPaths: ['secret/'] });
  assert.strictEqual(v.length, 1);
});

test('custom maxBinaryBytes is honoured', () => {
  const v = findJunk([{ path: 'a.png', size: 100 }], { maxBinaryBytes: 50 });
  assert.strictEqual(v.length, 1);
});

test('CLI exits 1 on a banned path and 0 when clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-junk-'));
  try {
    const bad = path.join(dir, 'bad.txt');
    fs.writeFileSync(bad, '.omc/x\nsrc/ok.ts\n');
    const r1 = spawnSync('node', [CLI, bad], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stderr, /::error::no-junk/);

    const good = path.join(dir, 'good.txt');
    fs.writeFileSync(good, 'src/ok.ts\nREADME.md\n');
    const r2 = spawnSync('node', [CLI, good], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI stats a real oversized binary from the working tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-junk-bin-'));
  try {
    const big = path.join(dir, 'huge.png');
    fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024, 0));
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, big + '\n');
    const r = spawnSync('node', [CLI, list], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /exceeds limit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
