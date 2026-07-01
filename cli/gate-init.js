'use strict';

/**
 * `gate init` — scaffold the shared quality-gate into any repo (T4).
 *
 * Drops three things into a target repo so the gate is adopted with **no manual
 * YAML editing** (the only follow-up is filling `visual.routes` + baselines):
 *
 *   1. `.github/workflows/quality-gate.yml` — the trigger + 3-line `gate` job
 *      that calls `nhdms/quality-gate/.github/workflows/gate.yml@<ref>`. No gate
 *      logic is copied; it lives here and is pinned at a tag.
 *   2. `gate.config.json` — a stub PRE-FILLED from the detected stack, valid
 *      against gate.schema.json out of the box.
 *   3. `visual/baseline/` — the directory approved visual baselines land in
 *      (kept via a `.gitkeep`; baselines are seeded by the documented approval
 *      flow, never auto-snapshotted).
 *
 * **Idempotent:** re-running never overwrites an existing file or duplicates a
 * directory. Each target is reported as `created` or `exists`, so onboarding a
 * repo twice (e.g. agent-ord re-onboarding) is a no-op the second time.
 *
 * Zero dependencies: the gate must stay portable across arbitrary runners.
 */

const fs = require('fs');
const path = require('path');
const { detectStack } = require('./detect-stack');

// The tag consumers pin. Kept in sync with the reusable workflow's own @v1
// contract (see ADOPTION.md — "Why @v1"). Overridable for gate development.
const DEFAULT_REF = 'v1';

/**
 * The consumer CI workflow. Deliberately minimal: a trigger plus the reusable
 * `gate` job. Everything stack-specific is pushed into gate.config.json, never
 * hardcoded here — so this file is identical for every consuming repo.
 *
 * @param {string} ref tag/branch of nhdms/quality-gate to pin
 */
function workflowYml(ref) {
  return `name: quality-gate

# Adopted via \`gate init\`. This is the ENTIRE integration: a trigger + the
# reusable \`gate\` job, pinned at @${ref}. No gate logic is copied — it lives in
# nhdms/quality-gate. Per-project differences belong in gate.config.json
# (validated by gate.schema.json), never in this file.
on:
  pull_request:
  push:
    branches: [main]

jobs:
  gate:
    uses: nhdms/quality-gate/.github/workflows/gate.yml@${ref}
    with:
      config: ./gate.config.json
`;
}

/**
 * A valid, minimal gate.config.json pre-filled from the detected stack.
 *
 * `changedLineCoverage` starts at 0 (advisory) so a fresh adopt is GREEN on a
 * clean PR before per-package lcov is wired to the repo root — raise it once
 * coverage aggregation is in place (see ADOPTION.md). The anti-fake-done and
 * no-junk/secret mechanics are ON from line one, so a planted violation is RED
 * immediately. `visual` is intentionally omitted: the lane only activates once
 * the adopter fills `visual.routes` and seeds baselines.
 *
 * @param {('ts'|'go'|'rust'|null)} stack detected stack, or null
 */
function configStub(stack) {
  return {
    // Concrete stack when detected (pre-filled), else 'auto' to detect in CI.
    stack: stack || 'auto',
    thresholds: {
      changedLineCoverage: 0,
      minTests: 1,
      maxRetries: 0,
    },
    frozenLockfile: true,
    noJunk: { allow: [] },
    secrets: { allow: [] },
  };
}

/**
 * Ensure a directory exists; report whether it had to be created.
 * @returns {'created'|'exists'}
 */
function ensureDir(dir) {
  if (fs.existsSync(dir)) return 'exists';
  fs.mkdirSync(dir, { recursive: true });
  return 'created';
}

/**
 * Write a file only if absent (idempotent). Never clobbers caller edits.
 * @returns {'created'|'exists'}
 */
function writeIfAbsent(file, contents) {
  if (fs.existsSync(file)) return 'exists';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return 'created';
}

/**
 * Scaffold the gate into `dir`. Pure + idempotent: safe to re-run.
 *
 * @param {string} dir target repo root
 * @param {{ref?:string, stack?:string}} [opts]
 * @returns {{stack:string, ref:string, actions:Array<{path:string,status:'created'|'exists'}>}}
 */
function gateInit(dir = process.cwd(), opts = {}) {
  const ref = opts.ref || DEFAULT_REF;
  // Explicit override wins; otherwise detect. `configStub` falls back to 'auto'.
  const detected = opts.stack && opts.stack !== 'auto' ? opts.stack : detectStack(dir);
  const stack = detected || 'auto';

  const actions = [];
  const rel = (p) => path.relative(dir, p) || p;

  const workflowPath = path.join(dir, '.github', 'workflows', 'quality-gate.yml');
  actions.push({ path: rel(workflowPath), status: writeIfAbsent(workflowPath, workflowYml(ref)) });

  const configPath = path.join(dir, 'gate.config.json');
  actions.push({
    path: rel(configPath),
    status: writeIfAbsent(configPath, JSON.stringify(configStub(detected), null, 2) + '\n'),
  });

  const baselineDir = path.join(dir, 'visual', 'baseline');
  const dirStatus = ensureDir(baselineDir);
  // A .gitkeep makes the (otherwise empty) baseline dir survive a git add, so
  // the adopter can commit the scaffold before any baseline PNG exists.
  const keepPath = path.join(baselineDir, '.gitkeep');
  const keepStatus = writeIfAbsent(keepPath, '');
  actions.push({ path: rel(baselineDir) + '/', status: dirStatus === 'created' || keepStatus === 'created' ? 'created' : 'exists' });

  return { stack, ref, actions };
}

module.exports = { gateInit, configStub, workflowYml, DEFAULT_REF };

/* node:coverage disable */
if (require.main === module) {
  // CLI: gate-init.js [dir] [--ref <tag>] [--stack <ts|go|rust|auto>]
  const argv = process.argv.slice(2);
  const opts = {};
  let dir = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') opts.ref = argv[++i];
    else if (a === '--stack') opts.stack = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: gate init [dir] [--ref <tag>] [--stack <ts|go|rust|auto>]\n');
      process.exit(0);
    } else if (!a.startsWith('-')) dir = path.resolve(a);
  }

  let result;
  try {
    result = gateInit(dir, opts);
  } catch (err) {
    process.stderr.write(`gate init: ${err.message}\n`);
    process.exit(2);
  }

  process.stdout.write(`gate init: scaffolding into ${dir} (stack: ${result.stack}, pinned @${result.ref})\n`);
  for (const a of result.actions) {
    const mark = a.status === 'created' ? 'created ' : 'exists  ';
    process.stdout.write(`  ${mark} ${a.path}\n`);
  }
  const created = result.actions.filter((a) => a.status === 'created').length;
  if (created === 0) {
    process.stdout.write('gate init: already initialised — nothing to do.\n');
  } else {
    process.stdout.write(
      `gate init: done. Next: fill visual.routes + seed baselines (optional), then open a PR.\n`
    );
  }
  process.exit(0);
}
/* node:coverage enable */
