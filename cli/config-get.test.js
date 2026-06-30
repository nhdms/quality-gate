'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { get } = require('./config-get');

const CLI = path.join(__dirname, 'config-get.js');
const CONFIG = path.join(__dirname, '..', 'gate.config.json');

test('reads a nested key', () => {
  assert.strictEqual(get({ thresholds: { minTests: 3 } }, 'thresholds.minTests', 1), 3);
});

test('returns the default when the path is absent', () => {
  assert.strictEqual(get({ thresholds: {} }, 'thresholds.maxRetries', 0), 0);
  assert.strictEqual(get({}, 'a.b.c', 'fallback'), 'fallback');
});

test('returns the default for a non-object midway', () => {
  assert.strictEqual(get({ a: 5 }, 'a.b', 'd'), 'd');
});

test('CLI prints a value from the repo config', () => {
  const r = spawnSync('node', [CLI, CONFIG, 'thresholds.minTests', '1'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '1');
});

test('CLI prints the default for a missing key', () => {
  const r = spawnSync('node', [CLI, CONFIG, 'thresholds.maxRetries', '0'], { encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim(), '0');
});
