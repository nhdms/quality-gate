'use strict';

/**
 * Anti-fake-done lint of the caller's package scripts (T0).
 *
 * Regression-tests against the exact audited snippets that made the ai-sdlc
 * gate hollow:
 *   - `vitest run --passWithNoTests`  → a unit job goes green with zero tests
 *   - `pnpm install --no-frozen-lockfile` → lockfile drift can never fail CI
 *
 * Any script value containing a banned flag fails the gate. The runner-selected
 * test command is invoked by the gate itself WITHOUT these flags; this lint
 * stops a caller from smuggling them back in via package.json scripts.
 */

// Matched case-insensitively against each script's command string.
const BANNED_FLAGS = [
  { flag: '--passWithNoTests', why: 'lets the test job pass with zero tests executed' },
  { flag: '--no-frozen-lockfile', why: 'disables frozen-lockfile install — lockfile drift can never fail' },
  { flag: '--frozen-lockfile=false', why: 'disables frozen-lockfile install — lockfile drift can never fail' },
];

/**
 * @param {object} pkg parsed package.json
 * @returns {Array<{script:string,flag:string,why:string}>} violations
 */
function lintScripts(pkg) {
  const scripts = (pkg && pkg.scripts) || {};
  const violations = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    const lower = String(cmd).toLowerCase();
    for (const { flag, why } of BANNED_FLAGS) {
      if (lower.includes(flag.toLowerCase())) {
        violations.push({ script: name, flag, why });
      }
    }
  }
  return violations;
}

module.exports = { lintScripts, BANNED_FLAGS };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  // CLI: node lint-test-cmd.js [package.json]
  const pkgPath = process.argv[2] || 'package.json';
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    // No package.json (e.g. non-JS repo) is not a violation here.
    if (err.code === 'ENOENT') {
      process.stdout.write(`quality-gate lint-test-cmd: no ${pkgPath} — skipping.\n`);
      process.exit(0);
    }
    process.stderr.write(`quality-gate lint-test-cmd: cannot read ${pkgPath}: ${err.message}\n`);
    process.exit(2);
  }
  const violations = lintScripts(pkg);
  if (violations.length > 0) {
    process.stderr.write('quality-gate lint-test-cmd: FAILED — banned flags in package scripts:\n');
    for (const v of violations) {
      process.stderr.write(`  ::error::lint-test-cmd: scripts.${v.script} uses ${v.flag} (${v.why})\n`);
    }
    process.exit(1);
  }
  process.stdout.write('quality-gate lint-test-cmd: OK (no banned flags in scripts).\n');
}
/* node:coverage enable */
