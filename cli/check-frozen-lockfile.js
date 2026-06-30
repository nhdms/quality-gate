'use strict';

/**
 * Frozen-lockfile check (T0).
 *
 * Installs dependencies with a frozen/immutable lockfile so any drift between
 * the manifest and the lockfile fails the gate (defends against the audited
 * `pnpm install --no-frozen-lockfile`). Stack-agnostic on the decision layer:
 * the package manager is inferred from the lockfile present.
 *
 * Decisions (pure, unit-tested):
 *   - pnpm-lock.yaml      → `pnpm install --frozen-lockfile`
 *   - package-lock.json   → `npm ci`
 *   - npm-shrinkwrap.json → `npm ci`
 *   - yarn.lock           → `yarn install --immutable` (or --frozen-lockfile)
 *   - no lockfile + deps declared → FAIL (a lockfile is required)
 *   - no lockfile + no deps       → SKIP (nothing to install, no drift possible)
 */

const fs = require('fs');
const path = require('path');

const LOCKFILES = [
  { file: 'pnpm-lock.yaml', cmd: ['pnpm', 'install', '--frozen-lockfile'] },
  { file: 'package-lock.json', cmd: ['npm', 'ci'] },
  { file: 'npm-shrinkwrap.json', cmd: ['npm', 'ci'] },
  { file: 'yarn.lock', cmd: ['yarn', 'install', '--immutable'] },
];

function hasDependencies(pkg) {
  const has = (o) => o && typeof o === 'object' && Object.keys(o).length > 0;
  return Boolean(pkg && (has(pkg.dependencies) || has(pkg.devDependencies) || has(pkg.optionalDependencies)));
}

/**
 * Decide what to do for a directory.
 * @param {object} state { lockfiles: string[], pkg: object|null }
 * @returns {{action:'install'|'skip'|'fail', cmd?:string[], reason:string}}
 */
function decide(state) {
  const present = (state.lockfiles || []).slice();
  for (const lf of LOCKFILES) {
    if (present.includes(lf.file)) {
      return { action: 'install', cmd: lf.cmd, reason: `found ${lf.file}` };
    }
  }
  if (hasDependencies(state.pkg)) {
    return {
      action: 'fail',
      reason: 'dependencies are declared but no lockfile is committed — a frozen install is impossible',
    };
  }
  return { action: 'skip', reason: 'no lockfile and no declared dependencies — nothing to install' };
}

/** Inspect a directory and return the decision. */
function decideForDir(dir) {
  const lockfiles = LOCKFILES.map((l) => l.file).filter((f) => fs.existsSync(path.join(dir, f)));
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    /* no package.json */
  }
  return decide({ lockfiles, pkg });
}

module.exports = { decide, decideForDir, hasDependencies, LOCKFILES };

/* node:coverage disable */
if (require.main === module) {
  const { spawnSync } = require('child_process');
  const dir = process.argv[2] || '.';
  const frozen = process.argv[3] === undefined ? true : process.argv[3] !== 'false';

  if (!frozen) {
    process.stdout.write('quality-gate frozen-lockfile: disabled via config — skipping.\n');
    process.exit(0);
  }

  const d = decideForDir(dir);
  if (d.action === 'skip') {
    process.stdout.write(`quality-gate frozen-lockfile: SKIP — ${d.reason}.\n`);
    process.exit(0);
  }
  if (d.action === 'fail') {
    process.stderr.write(`quality-gate frozen-lockfile: FAILED — ${d.reason}\n`);
    process.stderr.write(`  ::error::frozen-lockfile: ${d.reason}\n`);
    process.exit(1);
  }

  process.stdout.write(`quality-gate frozen-lockfile: ${d.reason} → ${d.cmd.join(' ')}\n`);
  const res = spawnSync(d.cmd[0], d.cmd.slice(1), { cwd: dir, stdio: 'inherit' });
  if (res.error || res.status !== 0) {
    const msg = res.error ? res.error.message : `exit ${res.status}`;
    process.stderr.write(`quality-gate frozen-lockfile: FAILED — frozen install failed (${msg})\n`);
    process.stderr.write('  ::error::frozen-lockfile: lockfile drift or install failure\n');
    process.exit(1);
  }
  process.stdout.write('quality-gate frozen-lockfile: OK (frozen install succeeded).\n');
}
/* node:coverage enable */
