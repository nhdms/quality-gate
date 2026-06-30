'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectStack } = require('./detect-stack');

const FIX = path.join(__dirname, 'fixtures');

test('detects ts from a pnpm repo', () => {
  assert.strictEqual(detectStack(path.join(FIX, 'ts-repo')), 'ts');
});

test('detects go from a go.mod repo', () => {
  assert.strictEqual(detectStack(path.join(FIX, 'go-repo')), 'go');
});

test('detects rust from a Cargo.toml repo', () => {
  assert.strictEqual(detectStack(path.join(FIX, 'rust-repo')), 'rust');
});

test('go.mod takes precedence over auxiliary package.json', () => {
  assert.strictEqual(detectStack(path.join(FIX, 'go-with-js')), 'go');
});

test('returns null when no manifest is present', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-empty-'));
  try {
    assert.strictEqual(detectStack(empty), null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('detects ts from a plain package.json repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-ts-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    assert.strictEqual(detectStack(dir), 'ts');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
