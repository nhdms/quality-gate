'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { gateCheck, TOOL_ROOT } = require('./gate-check');
const { gateInit } = require('./gate-init');

const FIXTURES = path.join(TOOL_ROOT, 'rules', 'fixtures');

function tmpRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-check-'));
  for (const [rel, contents] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
  }
  return dir;
}

function copyFixture(dir, rel, destRel) {
  const dest = path.join(dir, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, rel), dest);
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function names(res) {
  return Object.fromEntries(res.checks.map((c) => [c.name, c.ok]));
}

test('clean gate-init repo passes the merge oracle (done-condition met)', () => {
  const dir = tmpRepo({
    'package.json': '{"name":"demo","scripts":{"test":"node --test"}}',
    'src/add.ts': 'export const add = (a: number, b: number): number => a + b;\n',
  });
  try {
    gateInit(dir);
    const res = gateCheck({ dir });
    assert.strictEqual(res.ok, true, `expected PASS, got: ${JSON.stringify(res.checks)}`);
    const byName = names(res);
    assert.strictEqual(byName.config, true);
    assert.strictEqual(byName['lint-test-cmd'], true);
    assert.strictEqual(byName.rules, true);
  } finally {
    cleanup(dir);
  }
});

test('planted fake-done (lying return) is caught — worker is NOT done', () => {
  const dir = tmpRepo({
    'package.json': '{"name":"demo","scripts":{"test":"node --test"}}',
    'src/transports.ts': 'export class UnimplementedEmailTransport { async send(_m){} }\n',
  });
  try {
    gateInit(dir);
    // The exact audited "optimistic success signaling" snippet.
    copyFixture(dir, 'no-lying-return/bad.ts', 'src/dispatch.ts');
    const res = gateCheck({ dir });
    assert.strictEqual(res.ok, false, 'gate must block fake-done output');
    assert.strictEqual(names(res).rules, false, 'the anti-fake-done ruleset is the blocker');
  } finally {
    cleanup(dir);
  }
});

test('planted fake-done (--passWithNoTests) is caught by the script lint', () => {
  const dir = tmpRepo({
    'package.json': '{"name":"demo","scripts":{"test":"vitest run --passWithNoTests"}}',
    'src/add.ts': 'export const add = (a: number, b: number): number => a + b;\n',
  });
  try {
    gateInit(dir);
    const res = gateCheck({ dir });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(names(res)['lint-test-cmd'], false);
  } finally {
    cleanup(dir);
  }
});

test('missing config fails closed with a helpful message', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"demo"}' });
  try {
    const res = gateCheck({ dir });
    assert.strictEqual(res.ok, false);
    const config = res.checks.find((c) => c.name === 'config');
    assert.strictEqual(config.ok, false);
    assert.match(config.detail, /gate init/);
  } finally {
    cleanup(dir);
  }
});

test('an invalid config fails the oracle (unverifiable gate)', () => {
  const dir = tmpRepo({
    'package.json': '{"name":"demo","scripts":{"test":"node --test"}}',
    // stack is required; a bogus enum value must not validate.
    'gate.config.json': '{"stack":"cobol"}',
  });
  try {
    const res = gateCheck({ dir });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(names(res).config, false);
  } finally {
    cleanup(dir);
  }
});

test('fail-closed: rules check FAILS when the ruleset cannot run (never silent-pass)', () => {
  const dir = tmpRepo({
    'package.json': '{"name":"demo","scripts":{"test":"node --test"}}',
    'src/add.ts': 'export const add = (a, b) => a + b;\n',
  });
  try {
    gateInit(dir);
    // Point toolDir at a location with no rules/ tree, so the ruleset cannot be
    // discovered/run. A merge oracle must go RED, not green, when it cannot
    // actually verify the anti-fake-done ruleset.
    const res = gateCheck({ dir, toolDir: dir, schemaPath: path.join(TOOL_ROOT, 'gate.schema.json') });
    assert.strictEqual(names(res).config, true, 'config still validates against the real schema');
    const rules = res.checks.find((c) => c.name === 'rules');
    assert.strictEqual(rules.ok, false, 'rules lane fails closed');
    assert.match(rules.detail, /fail-closed/);
    assert.strictEqual(res.ok, false);
  } finally {
    cleanup(dir);
  }
});
