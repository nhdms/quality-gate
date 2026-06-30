'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { validateConfig } = require('./validate-config');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gate.schema.json'), 'utf8'));
const CONFIGS = path.join(__dirname, 'fixtures', 'configs');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIGS, name), 'utf8'));
}

test('the repo gate.config.json is valid', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gate.config.json'), 'utf8'));
  assert.deepStrictEqual(validateConfig(cfg, SCHEMA), []);
});

test('a fully-populated config is valid', () => {
  assert.deepStrictEqual(validateConfig(load('valid.json'), SCHEMA), []);
});

test('rejects an out-of-enum stack', () => {
  const errors = validateConfig(load('invalid-enum.json'), SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /stack/);
});

test('rejects an unknown property (additionalProperties:false)', () => {
  const errors = validateConfig(load('invalid-unknown-prop.json'), SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /bogusKey/);
});

test('rejects a config missing the required stack', () => {
  const errors = validateConfig(load('invalid-missing-stack.json'), SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /stack.*missing|missing.*stack/i);
});

test('rejects an out-of-range coverage threshold', () => {
  const errors = validateConfig(load('invalid-out-of-range.json'), SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /maximum/);
});

test('rejects a wrong type for minTests', () => {
  const errors = validateConfig({ stack: 'ts', thresholds: { minTests: 'lots' } }, SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /minTests/);
});

test('rejects an unknown anti-fake-done rule id', () => {
  const errors = validateConfig(load('invalid-rule-id.json'), SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /no-such-rule/);
});

test('accepts a valid rules block', () => {
  const cfg = { stack: 'ts', rules: { enabled: false, disabled: ['no-lying-return'] } };
  assert.deepStrictEqual(validateConfig(cfg, SCHEMA), []);
});

test('accepts a full visual block (T2 oracle config)', () => {
  const cfg = {
    stack: 'ts',
    visual: {
      routes: ['/auth/login'],
      breakpoints: [375, 768, 1280],
      baselineDir: 'visual/baseline',
      baseURL: 'http://localhost:3000',
      minScore: 90,
      maxDiffRatio: 0,
      tolerance: 2,
      blocking: true,
    },
  };
  assert.deepStrictEqual(validateConfig(cfg, SCHEMA), []);
});

test('rejects an out-of-range visual.maxDiffRatio', () => {
  const errors = validateConfig({ stack: 'ts', visual: { maxDiffRatio: 2 } }, SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /maxDiffRatio|maximum/);
});

test('rejects an unknown visual property (additionalProperties:false)', () => {
  const errors = validateConfig({ stack: 'ts', visual: { bogusVisual: true } }, SCHEMA);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /bogusVisual/);
});
