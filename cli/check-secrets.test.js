'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { scanText, scanDiff, parseAddedLines } = require('./check-secrets');

const CLI = path.join(__dirname, 'check-secrets.js');

// Secrets are assembled from parts so the literal never appears in a committed
// file — otherwise the gate's own secret scan would flag this repo's diff.
const AWS_KEY = 'AKIA' + 'IOSFODNN7' + 'EXAMPLE'; // 'AKIA' + 16 chars
const GH_PAT = 'ghp_' + 'A'.repeat(36);
const PRIV_KEY = '-----BEGIN ' + 'RSA PRIVATE KEY' + '-----';

function diffAdding(file, lines) {
  return [
    `diff --git a/${file} b/${file}`,
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => '+' + l),
    '',
  ].join('\n');
}

test('detects an AWS access key id (DoD: gate RED)', () => {
  const f = scanText(`const k = "${AWS_KEY}"`);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].rule, 'aws-access-key-id');
});

test('detects a GitHub PAT and a private key block', () => {
  assert.strictEqual(scanText(`token=${GH_PAT}`)[0].rule, 'github-pat');
  assert.strictEqual(scanText(PRIV_KEY)[0].rule, 'private-key-block');
});

test('detects a generic assigned secret', () => {
  // Assembled from parts so the contiguous literal never lands in a committed
  // file (otherwise the gate's own secret scan would flag this test's source).
  const assigned = 'api' + '_key: "' + 's3cr3t_value_long_enough_x' + '"';
  const f = scanText(assigned);
  assert.ok(f.some((x) => x.rule === 'generic-assigned-secret'));
});

test('clean code produces no findings (DoD: gate GREEN)', () => {
  assert.deepStrictEqual(scanText('const sum = a + b; // ordinary code'), []);
});

test('parseAddedLines only collects + lines per target file', () => {
  const diff = diffAdding('app.js', ['line one', 'line two']);
  const added = parseAddedLines(diff);
  assert.deepStrictEqual(added['app.js'], ['line one', 'line two']);
});

test('scanDiff flags a secret in an added line', () => {
  const f = scanDiff(diffAdding('config.js', [`const s = "${AWS_KEY}"`]));
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].file, 'config.js');
});

test('scanDiff honours the path allowlist', () => {
  const diff = diffAdding('test/fixtures/secret.txt', [AWS_KEY]);
  assert.deepStrictEqual(scanDiff(diff, { allow: ['test/fixtures/'] }), []);
});

test('snippet output is redacted (no raw secret echoed)', () => {
  const f = scanText(`key=${AWS_KEY}`);
  assert.ok(!f[0].snippet.includes(AWS_KEY));
});

test('CLI exits 1 on a planted secret, 0 on a clean diff', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-sec-'));
  try {
    const bad = path.join(dir, 'bad.diff');
    fs.writeFileSync(bad, diffAdding('leak.js', [`const k="${AWS_KEY}"`]));
    const r1 = spawnSync('node', [CLI, bad], { encoding: 'utf8' });
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stderr, /::error file=leak\.js::secret/);

    const good = path.join(dir, 'good.diff');
    fs.writeFileSync(good, diffAdding('ok.js', ['const x = 1 + 2;']));
    const r2 = spawnSync('node', [CLI, good], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
