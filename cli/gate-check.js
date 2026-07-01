'use strict';

/**
 * `gate check` — the local merge-oracle (T4 done-condition).
 *
 * Runs the gate's fake-done-catching checks against a working tree and returns a
 * single PASS/FAIL verdict. This is the oracle agent-ord's autopilot done-
 * condition consults: a worker session is "done" only when this passes — NOT
 * merely when generic CI is green. It catches the two classes the issue names:
 *
 *   - **fake-done** — hollowed-out tests / lying code. Caught by the
 *     anti-fake-done static ruleset (T1, `run-rules`) and the package-script
 *     lint (T0, `lint-test-cmd`, e.g. smuggled `--passWithNoTests`).
 *   - **UI-broken / design drift** — caught by the visual lane in CI. The visual
 *     lane needs a running server, so it is not part of this local oracle; the
 *     canonical done-condition is the CI `gate` check, of which this is the
 *     local pre-flight equivalent (see AGENT-ORD-INTEGRATION.md).
 *
 * **Fail-closed:** a check that cannot run (e.g. ast-grep missing for the rules
 * lane) is reported as FAILED, never silently skipped — a merge oracle must
 * never green-light a result it did not actually verify. This mirrors the
 * visual lane's "missing baseline = hard RED" posture.
 *
 * Zero runtime dependencies beyond the gate's own tooling.
 */

const fs = require('fs');
const path = require('path');

const { lintScripts } = require('./lint-test-cmd');
const { runRules, formatFinding } = require('./run-rules');
const { validateConfig } = require('./validate-config');

const TOOL_ROOT = path.resolve(__dirname, '..');

/**
 * Run the local gate oracle over a tree.
 *
 * @param {{dir?:string, configPath?:string, toolDir?:string, schemaPath?:string}} [opts]
 * @returns {{ok:boolean, checks:Array<{name:string, ok:boolean, detail:string}>}}
 */
function gateCheck(opts = {}) {
  const dir = opts.dir || process.cwd();
  const toolDir = opts.toolDir || TOOL_ROOT;
  const configPath = opts.configPath || path.join(dir, 'gate.config.json');
  const schemaPath = opts.schemaPath || path.join(toolDir, 'gate.schema.json');
  const checks = [];

  // 1. Config present + valid against the schema. A repo whose gate config is
  //    malformed has an unverifiable gate → fail closed.
  if (!fs.existsSync(configPath)) {
    checks.push({ name: 'config', ok: false, detail: `no gate.config.json at ${configPath} — run 'gate init' first` });
  } else {
    let errs = [];
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      errs = validateConfig(cfg, schema);
    } catch (err) {
      errs = [String(err.message || err)];
    }
    checks.push({
      name: 'config',
      ok: errs.length === 0,
      detail: errs.length === 0 ? 'gate.config.json valid' : `invalid config:\n    ${errs.join('\n    ')}`,
    });
  }

  // 2. Package-script fake-done lint (T0). Only meaningful for JS/TS repos; a
  //    repo with no package.json simply has nothing to lint here.
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let violations = [];
    try {
      violations = lintScripts(JSON.parse(fs.readFileSync(pkgPath, 'utf8')));
    } catch (err) {
      checks.push({ name: 'lint-test-cmd', ok: false, detail: `cannot read package.json: ${err.message}` });
    }
    if (Array.isArray(violations)) {
      checks.push({
        name: 'lint-test-cmd',
        ok: violations.length === 0,
        detail:
          violations.length === 0
            ? 'no banned flags in package scripts'
            : violations.map((v) => `scripts.${v.script} uses ${v.flag} (${v.why})`).join('\n    '),
      });
    }
  }

  // 3. Anti-fake-done static ruleset (T1). Fail-closed: if the ruleset cannot
  //    run (ast-grep unavailable), that is a FAILED check, not a skip.
  try {
    const r = runRules({ target: dir, toolDir, configPath: fs.existsSync(configPath) ? configPath : undefined });
    if (r.skipped) {
      checks.push({ name: 'rules', ok: true, detail: 'anti-fake-done ruleset disabled by config' });
    } else {
      const ok = r.errors.length === 0;
      checks.push({
        name: 'rules',
        ok,
        detail: ok
          ? `anti-fake-done ruleset clean (${r.ran.length} rules)`
          : `${r.errors.length} fake-done finding(s):\n${r.errors.map(formatFinding).join('\n')}`,
      });
    }
  } catch (err) {
    checks.push({ name: 'rules', ok: false, detail: `ruleset could not run (fail-closed): ${err.message}` });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

module.exports = { gateCheck, TOOL_ROOT };

/* node:coverage disable */
if (require.main === module) {
  // CLI: gate-check.js [dir] [--config <path>]
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') opts.configPath = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: gate check [dir] [--config <gate.config.json>]\n');
      process.exit(0);
    } else if (!a.startsWith('-')) opts.dir = path.resolve(a);
  }

  const { ok, checks } = gateCheck(opts);
  process.stdout.write('gate check: merge oracle\n');
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) process.stderr.write(`    ${c.detail}\n`);
  }
  if (ok) {
    process.stdout.write('gate check: PASS — quality-gate satisfied (done-condition met).\n');
    process.exit(0);
  }
  process.stderr.write('gate check: FAIL — quality-gate NOT satisfied; worker is NOT done.\n');
  process.exit(1);
}
/* node:coverage enable */
