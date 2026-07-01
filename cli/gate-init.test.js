'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { gateInit, configStub, workflowYml, DEFAULT_REF } = require('./gate-init');
const { validateConfig } = require('./validate-config');

const TOOL_ROOT = path.resolve(__dirname, '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, 'gate.schema.json'), 'utf8'));

function tmpRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-init-'));
  for (const [rel, contents] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('scaffolds all three artifacts into a fresh repo', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    const res = gateInit(dir);
    assert.strictEqual(res.stack, 'ts', 'detects ts from package.json');
    assert.ok(fs.existsSync(path.join(dir, '.github/workflows/quality-gate.yml')), 'workflow written');
    assert.ok(fs.existsSync(path.join(dir, 'gate.config.json')), 'config written');
    assert.ok(fs.existsSync(path.join(dir, 'visual/baseline/.gitkeep')), 'baseline dir kept');
    assert.deepStrictEqual(
      res.actions.map((a) => a.status),
      ['created', 'created', 'created'],
      'every artifact reported created'
    );
  } finally {
    cleanup(dir);
  }
});

test('the scaffolded config is valid against gate.schema.json (no manual editing)', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    gateInit(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'gate.config.json'), 'utf8'));
    assert.deepStrictEqual(validateConfig(cfg, SCHEMA), [], 'config validates clean out of the box');
  } finally {
    cleanup(dir);
  }
});

test('config is pre-filled from the detected stack', () => {
  const go = tmpRepo({ 'go.mod': 'module x\n' });
  const rust = tmpRepo({ 'Cargo.toml': '[package]\nname="x"\n' });
  try {
    assert.strictEqual(gateInit(go).stack, 'go');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(go, 'gate.config.json'), 'utf8')).stack, 'go');
    assert.strictEqual(gateInit(rust).stack, 'rust');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(rust, 'gate.config.json'), 'utf8')).stack, 'rust');
  } finally {
    cleanup(go);
    cleanup(rust);
  }
});

test("undetectable stack falls back to 'auto'", () => {
  const dir = tmpRepo();
  try {
    const res = gateInit(dir);
    assert.strictEqual(res.stack, 'auto');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'gate.config.json'), 'utf8')).stack, 'auto');
  } finally {
    cleanup(dir);
  }
});

test('explicit --stack override wins over detection', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    const res = gateInit(dir, { stack: 'go' });
    assert.strictEqual(res.stack, 'go');
  } finally {
    cleanup(dir);
  }
});

test('idempotent: re-running never overwrites and reports exists', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    gateInit(dir);
    // Mutate the scaffolded config; a second init must NOT clobber it.
    const cfgPath = path.join(dir, 'gate.config.json');
    fs.writeFileSync(cfgPath, '{"stack":"ts","thresholds":{"minTests":5}}\n');
    const res2 = gateInit(dir);
    assert.deepStrictEqual(
      res2.actions.map((a) => a.status),
      ['exists', 'exists', 'exists'],
      'second run reports everything as exists'
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(cfgPath, 'utf8')).thresholds.minTests,
      5,
      'user edits preserved'
    );
  } finally {
    cleanup(dir);
  }
});

test('workflow pins the reusable gate at the configured ref', () => {
  const yml = workflowYml('v1');
  assert.match(yml, /uses: nhdms\/quality-gate\/\.github\/workflows\/gate\.yml@v1/);
  assert.match(yml, /config: \.\/gate\.config\.json/);
  assert.match(workflowYml('main'), /gate\.yml@main/, 'ref is overridable for gate development');
});

test('gateInit honours a custom ref', () => {
  const dir = tmpRepo({ 'package.json': '{"name":"x"}' });
  try {
    gateInit(dir, { ref: 'v2' });
    const yml = fs.readFileSync(path.join(dir, '.github/workflows/quality-gate.yml'), 'utf8');
    assert.match(yml, /gate\.yml@v2/);
  } finally {
    cleanup(dir);
  }
});

test('default ref is v1 and configStub omits visual until routes are filled', () => {
  assert.strictEqual(DEFAULT_REF, 'v1');
  const stub = configStub('ts');
  assert.strictEqual(stub.visual, undefined, 'visual lane stays dormant until the adopter fills routes');
  assert.strictEqual(stub.thresholds.changedLineCoverage, 0, 'coverage starts advisory for a clean first adopt');
});
