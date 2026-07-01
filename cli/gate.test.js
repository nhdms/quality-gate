'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, 'gate.js');

function tmpRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-cli-'));
  for (const [rel, contents] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
  }
  return dir;
}

function run(args) {
  return spawnSync('node', [GATE, ...args], { encoding: 'utf8' });
}

test('`gate init` scaffolds and exits 0', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    const r = run(['init', dir]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /created  \.github\/workflows\/quality-gate\.yml/);
    assert.ok(fs.existsSync(path.join(dir, 'gate.config.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('`gate init` re-run reports already initialised', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    run(['init', dir]);
    const r = run(['init', dir]);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /already initialised/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('`gate check` exits 1 on a planted --passWithNoTests (worker not done)', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x","scripts":{"test":"vitest run --passWithNoTests"}}' });
  try {
    run(['init', dir]);
    const r = run(['check', dir]);
    assert.strictEqual(r.status, 1, 'fake-done must fail the oracle');
    assert.match(r.stderr, /NOT satisfied/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown subcommand exits 2 with usage', () => {
  const r = run(['frobnicate']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unknown subcommand/);
});

test('no subcommand prints usage and exits 2', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /usage:/);
});

test('`gate help` exits 0', () => {
  const r = run(['help']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /gate init/);
  assert.match(r.stdout, /gate check/);
});
