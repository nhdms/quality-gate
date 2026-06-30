'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { approvalPlan } = require('./visual-approve');

const CLI = path.join(__dirname, 'visual-approve.js');

test('approvalPlan maps only .png captures into the baseline dir', () => {
  const plan = approvalPlan(['a.png', 'b.png', 'notes.txt'], 'caps', 'visual/baseline');
  assert.strictEqual(plan.length, 2);
  assert.deepStrictEqual(plan[0], { from: path.join('caps', 'a.png'), to: path.join('visual/baseline', 'a.png') });
});

test('CLI is a DRY RUN without --approve (never auto-baselines)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-vappr-'));
  try {
    const caps = path.join(dir, 'caps');
    const base = path.join(dir, 'baseline');
    fs.mkdirSync(caps);
    fs.writeFileSync(path.join(caps, 'auth_login__375w.png'), 'x');

    const r = spawnSync('node', [CLI, caps, base], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.strictEqual(fs.existsSync(base), false, 'baseline must NOT be written without --approve');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI copies captures into the baseline dir with --approve', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-vappr2-'));
  try {
    const caps = path.join(dir, 'caps');
    const base = path.join(dir, 'baseline');
    fs.mkdirSync(caps);
    fs.writeFileSync(path.join(caps, 'auth_login__375w.png'), 'png-bytes');

    const r = spawnSync('node', [CLI, caps, base, '--approve'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /approved/);
    assert.strictEqual(
      fs.readFileSync(path.join(base, 'auth_login__375w.png'), 'utf8'),
      'png-bytes'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
