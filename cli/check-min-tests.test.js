'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { countTests, evaluate } = require('./check-min-tests');

const CLI = path.join(__dirname, 'check-min-tests.js');

test('parses TAP `# tests N`', () => {
  assert.strictEqual(countTests('TAP version 13\n# tests 12\n# pass 12\n'), 12);
});

test('parses jest total', () => {
  assert.strictEqual(countTests('Tests:       3 passed, 1 failed, 4 total'), 4);
});

test('parses vitest total in parens', () => {
  assert.strictEqual(countTests(' Tests  9 passed (9)'), 9);
});

test('parses mocha passing', () => {
  assert.strictEqual(countTests('  10 passing (2s)'), 10);
});

test('parses rust cargo test result, summed across crates', () => {
  const out = 'test result: ok. 5 passed; 0 failed; 1 ignored\ntest result: FAILED. 2 passed; 1 failed; 0 ignored';
  assert.strictEqual(countTests(out), 8);
});

test('parses go test -v PASS/FAIL/SKIP markers', () => {
  const out = '--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n--- SKIP: TestC (0.00s)';
  assert.strictEqual(countTests(out), 3);
});

test('falls back to counting TAP ok/not ok lines', () => {
  assert.strictEqual(countTests('ok 1 - a\nnot ok 2 - b\nok 3 - c\n'), 3);
});

test('returns null when the count is unknowable', () => {
  assert.strictEqual(countTests('some unrelated build output'), null);
});

test('evaluate fails on zero tests (DoD: gate RED)', () => {
  const r = evaluate(0, 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /0 test/);
});

test('evaluate fails when count is unknown (no silent pass)', () => {
  assert.strictEqual(evaluate(null, 1).ok, false);
});

test('evaluate passes when count meets the minimum (DoD: gate GREEN)', () => {
  assert.strictEqual(evaluate(5, 1).ok, true);
  assert.strictEqual(evaluate(5, 5).ok, true);
});

test('CLI exits 1 on zero tests, 0 when minimum met', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-min-'));
  try {
    const zero = path.join(dir, 'zero.tap');
    fs.writeFileSync(zero, 'TAP version 13\n# tests 0\n# pass 0\n');
    const r1 = spawnSync('node', [CLI, zero, '1'], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stderr, /::error::min-tests/);

    const some = path.join(dir, 'some.tap');
    fs.writeFileSync(some, 'TAP version 13\n# tests 7\n');
    const r2 = spawnSync('node', [CLI, some, '1'], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
