'use strict';

/**
 * Anti-fake-done static ruleset runner (T1).
 *
 * Drives the ast-grep ruleset in rules/ against a target tree and turns the
 * findings into a blocking gate result. Reads the optional `rules` block of
 * gate.config.json so consumers can toggle the lane and tune per-rule severity
 * without forking the workflow:
 *
 *   "rules": {
 *     "enabled": true,                       // master toggle (default true)
 *     "disabled": ["no-mock-in-prod-path"],  // never run these
 *     "warnOnly": ["no-dev-script-in-layout"]// report but do not fail the gate
 *   }
 *
 * The ruleset (rule definitions + this contract) is versioned in rules/VERSION
 * so consumers can pin a known set.
 *
 * Deliberately dependency-free Node (only built-ins + the ast-grep binary): the
 * gate runs on arbitrary self-hosted runners and must stay portable.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL_ROOT = path.resolve(__dirname, '..');

/** All known rule ids, discovered from the rule directory. */
function discoverRuleIds(rulesDir) {
  const ids = [];
  for (const file of fs.readdirSync(rulesDir)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const text = fs.readFileSync(path.join(rulesDir, file), 'utf8');
    const m = text.match(/^id:\s*(\S+)\s*$/m);
    if (m) ids.push(m[1]);
  }
  return ids.sort();
}

/** Locate an ast-grep executable; throws a helpful error if none is found. */
function resolveAstGrep() {
  const candidates = [];
  if (process.env.ASTGREP_BIN) candidates.push(process.env.ASTGREP_BIN);
  const local = path.join(TOOL_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'ast-grep.cmd' : 'ast-grep');
  candidates.push(local, 'ast-grep', 'sg');
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return bin;
  }
  throw new Error(
    'ast-grep not found. Install it (npm i -g @ast-grep/cli) or set ASTGREP_BIN. ' +
      'Tried: ' + candidates.join(', ')
  );
}

/** Read the `rules` config block from gate.config.json (tolerant of absence). */
function readRulesConfig(configPath) {
  const empty = { enabled: true, disabled: [], warnOnly: [] };
  if (!configPath || !fs.existsSync(configPath)) return empty;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`gate config '${configPath}' is not valid JSON: ${err.message}`);
  }
  const rules = parsed.rules || {};
  return {
    enabled: rules.enabled !== false,
    disabled: Array.isArray(rules.disabled) ? rules.disabled : [],
    warnOnly: Array.isArray(rules.warnOnly) ? rules.warnOnly : [],
  };
}

/**
 * Run the ruleset against `target`.
 * @returns {{skipped:boolean, ran:string[], findings:object[], errors:object[], warnings:object[]}}
 */
function runRules({ target = '.', toolDir = TOOL_ROOT, configPath } = {}) {
  const rulesDir = path.join(toolDir, 'rules', 'rules');
  const sgconfig = path.join(toolDir, 'rules', 'sgconfig.yml');
  const cfg = readRulesConfig(configPath);

  if (!cfg.enabled) {
    return { skipped: true, ran: [], findings: [], errors: [], warnings: [] };
  }

  const allIds = discoverRuleIds(rulesDir);
  const active = allIds.filter((id) => !cfg.disabled.includes(id));
  if (active.length === 0) {
    return { skipped: true, ran: [], findings: [], errors: [], warnings: [] };
  }

  const bin = resolveAstGrep();
  const filter = `^(${active.join('|')})$`;
  const res = spawnSync(
    bin,
    ['scan', '-c', sgconfig, '--filter', filter, '--json=stream', target],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.error) throw res.error;
  // ast-grep exits 0 under --json; a non-empty stderr with no stdout is a real failure.
  if (res.status !== 0 && !res.stdout) {
    throw new Error(`ast-grep failed (status ${res.status}): ${res.stderr || '(no output)'}`);
  }

  const findings = [];
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      findings.push(JSON.parse(trimmed));
    } catch (_e) {
      /* ignore non-JSON noise */
    }
  }

  const errors = [];
  const warnings = [];
  for (const f of findings) {
    if (cfg.warnOnly.includes(f.ruleId)) warnings.push(f);
    else errors.push(f);
  }
  return { skipped: false, ran: active, findings, errors, warnings };
}

function formatFinding(f) {
  const line = (f.range && f.range.start && f.range.start.line + 1) || '?';
  return `  ${f.file}:${line}  [${f.ruleId}]\n      ${(f.message || '').split('\n')[0].trim()}`;
}

function main(argv) {
  const args = argv.slice(2);
  let target = '.';
  let configPath = './gate.config.json';
  let toolDir = TOOL_ROOT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config') configPath = args[++i];
    else if (a === '--tool-dir') toolDir = args[++i];
    else if (a === '--target') target = args[++i];
    else if (!a.startsWith('--')) target = a;
  }

  let result;
  try {
    result = runRules({ target, toolDir, configPath });
  } catch (err) {
    process.stderr.write(`quality-gate (T1 ruleset): ${err.message}\n`);
    process.exit(2);
  }

  const versionFile = path.join(toolDir, 'rules', 'VERSION');
  const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : 'unknown';

  if (result.skipped) {
    process.stdout.write(`quality-gate: anti-fake-done ruleset disabled by config — skipping.\n`);
    process.exit(0);
  }

  process.stdout.write(`quality-gate: anti-fake-done ruleset v${version} — rules: ${result.ran.join(', ')}\n`);

  if (result.warnings.length > 0) {
    process.stdout.write(`\nwarnings (non-blocking):\n`);
    for (const f of result.warnings) process.stdout.write(formatFinding(f) + '\n');
  }

  if (result.errors.length > 0) {
    process.stdout.write(`\nquality-gate: FAILED — ${result.errors.length} anti-fake-done violation(s):\n`);
    for (const f of result.errors) process.stdout.write(formatFinding(f) + '\n');
    process.stdout.write('\nThese patterns report success without delivering it. Fix or move to a test path.\n');
    process.exit(1);
  }

  process.stdout.write(`quality-gate: PASSED — no anti-fake-done violations.\n`);
  process.exit(0);
}

module.exports = { runRules, discoverRuleIds, readRulesConfig, resolveAstGrep, TOOL_ROOT };

if (require.main === module) {
  main(process.argv);
}
