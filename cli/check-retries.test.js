'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parsePlaywrightRetries, evaluate } = require('./check-retries');

const CLI = path.join(__dirname, 'check-retries.js');
const RET = path.join(__dirname, 'fixtures', 'retries');

const FLAKY = JSON.parse(fs.readFileSync(path.join(RET, 'flaky.json'), 'utf8'));
const CLEAN = JSON.parse(fs.readFileSync(path.join(RET, 'clean.json'), 'utf8'));

test('finds retried tests in nested suites', () => {
  const r = parsePlaywrightRetries(FLAKY);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].retries, 1);
  assert.strictEqual(r[1].retries, 2);
  assert.match(r[1].title, /nested/);
});

test('a clean report has no retries', () => {
  assert.deepStrictEqual(parsePlaywrightRetries(CLEAN), []);
});

test('evaluate fails when retries exceed tolerance (DoD: gate RED)', () => {
  const r = evaluate(parsePlaywrightRetries(FLAKY), 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.totalRetries, 3);
});

test('evaluate passes when within tolerance (DoD: gate GREEN)', () => {
  assert.strictEqual(evaluate(parsePlaywrightRetries(FLAKY), 3).ok, true);
  assert.strictEqual(evaluate(parsePlaywrightRetries(CLEAN), 0).ok, true);
});

test('CLI fails on flaky report at maxRetries 0 and emits warning annotations', () => {
  const r = spawnSync('node', [CLI, path.join(RET, 'flaky.json'), '0'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /::warning::flaky-retry/);
  assert.match(r.stderr, /::error::retries/);
});

test('CLI passes on a clean report', () => {
  const r = spawnSync('node', [CLI, path.join(RET, 'clean.json'), '0'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

test('CLI passes on flaky report when tolerance allows it (still warns)', () => {
  const r = spawnSync('node', [CLI, path.join(RET, 'flaky.json'), '3'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /::warning::flaky-retry/);
});

test('CLI skips gracefully when no report path is given or file is missing', () => {
  const r1 = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.strictEqual(r1.status, 0);
  const r2 = spawnSync('node', [CLI, path.join(RET, 'nope.json'), '0'], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 0);
});
