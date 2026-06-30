'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verdict, judgeEntry, resolveOptions } = require('./visual-verdict');

const CLI = path.join(__dirname, 'visual-verdict.js');

const clean = (over) => ({
  route: '/auth/login',
  width: 375,
  comparison: { diffRatio: 0, diffPixels: 0, totalPixels: 1000, dimensionMismatch: false },
  overflow: false,
  ...over,
});

test('unchanged UI → pass, score 100 (DoD: GREEN)', () => {
  const v = verdict([clean()]);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'pass');
  assert.strictEqual(v.score, 100);
});

test('a 1px drift → fail (DoD: RED on deliberate drift)', () => {
  const v = verdict([
    clean({ comparison: { diffRatio: 1 / 1000, diffPixels: 1, totalPixels: 1000, dimensionMismatch: false } }),
  ]);
  assert.strictEqual(v.pass, false);
  assert.match(v.differences.join(' '), /pixel drift/);
});

test('horizontal overflow at 375px → fail (DoD: mobile overflow caught)', () => {
  const v = verdict([clean({ overflow: true })]);
  assert.strictEqual(v.pass, false);
  assert.match(v.differences.join(' '), /overflow at 375px/);
});

test('missing baseline → fail, never a silent pass (DoD: no auto-baseline)', () => {
  const v = verdict([clean({ comparison: null, baselineMissing: true })]);
  assert.strictEqual(v.pass, false);
  assert.match(v.differences.join(' '), /no approved baseline/);
});

test('dimension mismatch → hard fail with score 0', () => {
  const r = judgeEntry(
    clean({ comparison: { diffRatio: 0.2, diffPixels: 200, totalPixels: 1000, dimensionMismatch: true } }),
    resolveOptions()
  );
  assert.strictEqual(r.pass, false);
  assert.strictEqual(r.score, 0);
  assert.match(r.differences.join(' '), /dimension mismatch/);
});

test('capture error → fail', () => {
  const v = verdict([clean({ comparison: null, captureError: 'net::ERR' })]);
  assert.strictEqual(v.pass, false);
  assert.match(v.differences.join(' '), /capture failed/);
});

test('maxDiffRatio tolerance lets a tiny drift pass when configured', () => {
  const entry = clean({
    comparison: { diffRatio: 0.005, diffPixels: 5, totalPixels: 1000, dimensionMismatch: false },
  });
  assert.strictEqual(verdict([entry], { maxDiffRatio: 0 }).pass, false);
  assert.strictEqual(verdict([entry], { maxDiffRatio: 0.01, minScore: 90 }).pass, true);
});

test('overall score is the worst single screen', () => {
  const v = verdict([
    clean(),
    clean({ width: 768, comparison: { diffRatio: 0.3, diffPixels: 300, totalPixels: 1000, dimensionMismatch: false } }),
  ]);
  assert.strictEqual(v.score, 70);
  assert.strictEqual(v.pass, false);
});

test('empty manifest does not silently pass', () => {
  const v = verdict([]);
  assert.strictEqual(v.pass, false);
});

test('CLI exits 1 on fail and 0 on clean, surfacing the score', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-vverdict-'));
  try {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ entries: [clean({ overflow: true })] }));
    const r1 = spawnSync('node', [CLI, bad], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stdout + r1.stderr, /score=/);

    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify({ entries: [clean()] }));
    const r2 = spawnSync('node', [CLI, good], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0);
    assert.match(r2.stdout, /score=100/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
