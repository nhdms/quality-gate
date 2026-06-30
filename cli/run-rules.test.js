'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runRules, discoverRuleIds, readRulesConfig, TOOL_ROOT } = require('./run-rules');

const FIXTURES = path.join(TOOL_ROOT, 'rules', 'fixtures');
const RULES_DIR = path.join(TOOL_ROOT, 'rules', 'rules');

// Copy one or more fixture files into a fresh temp dir whose path matches none
// of the rules' `ignores` globs, then run the ruleset against that dir. This
// is how we exercise the known-bad snippets even though the rules ignore the
// in-repo `rules/fixtures/` path (so the gate can dogfood itself cleanly).
function scanFixtures(files, configObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-t1-'));
  let configPath;
  try {
    for (const rel of files) {
      const src = path.join(FIXTURES, rel);
      // Preserve the fixture subdir so files that share a basename (e.g. two
      // bad.ts) don't collide when several are scanned together.
      const dest = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    if (configObj) {
      configPath = path.join(dir, 'gate.config.json');
      fs.writeFileSync(configPath, JSON.stringify(configObj));
    }
    return runRules({ target: dir, toolDir: TOOL_ROOT, configPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ruleIdsIn(result) {
  return new Set(result.findings.map((f) => f.ruleId));
}

const CASES = [
  { id: 'no-noop-default-prod', bad: 'no-noop-default-prod/bad.ts', good: 'no-noop-default-prod/good.ts' },
  { id: 'no-lying-return', bad: 'no-lying-return/bad.ts', good: 'no-lying-return/good.ts' },
  { id: 'no-mock-in-prod-path', bad: 'no-mock-in-prod-path/bad.tsx', good: 'no-mock-in-prod-path/good.tsx' },
  { id: 'no-dev-script-in-layout', bad: 'no-dev-script-in-layout/bad.tsx', good: 'no-dev-script-in-layout/good.tsx' },
];

// --- Per-rule: RED on the known-bad snippet, GREEN on the clean equivalent ---
for (const c of CASES) {
  test(`${c.id}: flags the known-bad snippet`, () => {
    const result = scanFixtures([c.bad]);
    assert.ok(ruleIdsIn(result).has(c.id), `expected ${c.id} to flag ${c.bad}`);
  });

  test(`${c.id}: is green on the clean equivalent`, () => {
    const result = scanFixtures([c.good]);
    assert.strictEqual(
      result.findings.length,
      0,
      `expected no findings on ${c.good}, got: ${JSON.stringify(result.findings.map((f) => f.ruleId))}`
    );
  });
}

// --- DoD: all four fire together on the combined known-bad set ---
test('the whole ruleset flags all four audited defects at once', () => {
  const result = scanFixtures(CASES.map((c) => c.bad));
  for (const c of CASES) {
    assert.ok(ruleIdsIn(result).has(c.id), `missing ${c.id} in combined scan`);
  }
  assert.strictEqual(result.errors.length > 0, true);
});

// --- DoD: no false positives on the combined clean set ---
test('the whole ruleset is green on all four clean equivalents at once', () => {
  const result = scanFixtures(CASES.map((c) => c.good));
  assert.strictEqual(result.findings.length, 0, JSON.stringify(result.findings));
});

// --- Mock data in a *.test.* file must NOT be flagged (rule `ignores`) ---
test('mock data in a test file is ignored', () => {
  const result = scanFixtures(['no-mock-in-prod-path/ignored.test.tsx']);
  assert.strictEqual(result.findings.length, 0, JSON.stringify(result.findings));
});

// --- Regression: ordinary 'sample*' identifiers must NOT be flagged ---
// The 'sample'/'SAMPLE' token was removed from the NAME regex because it
// false-positives on audio/analytics code (sampleRate, sampleSize, ...).
test('no-mock-in-prod-path: does not flag ordinary sample* identifiers', () => {
  const result = scanFixtures(['no-mock-in-prod-path/sample-identifiers.tsx']);
  assert.strictEqual(
    result.findings.length,
    0,
    `sample* identifiers should not be flagged, got: ${JSON.stringify(result.findings.map((f) => f.text))}`
  );
});

// --- Config toggle: disable a rule -> it stops firing ---
test('config can disable an individual rule', () => {
  const result = scanFixtures(['no-noop-default-prod/bad.ts'], {
    stack: 'ts',
    rules: { disabled: ['no-noop-default-prod'] },
  });
  assert.ok(!result.ran.includes('no-noop-default-prod'));
  assert.strictEqual(ruleIdsIn(result).has('no-noop-default-prod'), false);
});

// --- Config toggle: master switch off -> ruleset skipped ---
test('config can disable the whole ruleset', () => {
  const result = scanFixtures(['no-noop-default-prod/bad.ts'], {
    stack: 'ts',
    rules: { enabled: false },
  });
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.findings.length, 0);
});

// --- Config toggle: warnOnly -> reported but non-blocking ---
test('config can downgrade a rule to warn-only (non-blocking)', () => {
  const result = scanFixtures(['no-noop-default-prod/bad.ts'], {
    stack: 'ts',
    rules: { warnOnly: ['no-noop-default-prod'] },
  });
  assert.strictEqual(result.errors.length, 0, 'should not be a blocking error');
  assert.ok(result.warnings.length >= 1, 'should be reported as a warning');
});

// --- Versioning: VERSION + manifest are present and consistent ---
test('ruleset is versioned and the manifest matches the rule files', () => {
  const version = fs.readFileSync(path.join(TOOL_ROOT, 'rules', 'VERSION'), 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/, 'VERSION must be semver');

  const manifest = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, 'rules', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.version, version, 'manifest.version must match VERSION');

  const discovered = discoverRuleIds(RULES_DIR).sort();
  const manifestIds = manifest.rules.map((r) => r.id).sort();
  assert.deepStrictEqual(manifestIds, discovered, 'manifest must list exactly the rule files');
  assert.deepStrictEqual(discovered, CASES.map((c) => c.id).sort(), 'every rule must have a fixture case');
});

// --- Schema can't drift from the rule files: the disabled/warnOnly enums in
//     gate.schema.json must list exactly the discoverable rule ids ---
test('gate.schema.json rule-id enums match the rule files', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, 'gate.schema.json'), 'utf8'));
  const ruleProps = schema.properties.rules.properties;
  const discovered = discoverRuleIds(RULES_DIR).sort();
  for (const key of ['disabled', 'warnOnly']) {
    const enumIds = [...ruleProps[key].items.enum].sort();
    assert.deepStrictEqual(
      enumIds,
      discovered,
      `gate.schema.json rules.${key}.items.enum must equal the rule files`
    );
  }
});

// --- The default gate.config.json parses through the config reader ---
test('readRulesConfig tolerates a config with no rules block', () => {
  const cfg = readRulesConfig(path.join(TOOL_ROOT, 'gate.config.json'));
  assert.strictEqual(cfg.enabled, true);
  assert.deepStrictEqual(cfg.disabled, []);
});
