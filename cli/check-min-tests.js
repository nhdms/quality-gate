'use strict';

/**
 * No-silent-zero-tests check (T0).
 *
 * Defends against the audited `vitest run --passWithNoTests` hole, where a unit
 * job goes green having executed zero tests. The gate runs the test runner
 * WITHOUT that flag and then asserts that at least `thresholds.minTests` tests
 * actually executed, parsing the count from the runner's output.
 *
 * Supports the common formats so it stays stack-agnostic:
 *   - TAP   : `# tests 12`  (node --test, tap reporters)
 *   - vitest: `Tests  12 passed (12)`
 *   - jest  : `Tests:  12 passed, 12 total`
 *   - mocha  : `12 passing`
 * Falls back to counting TAP `ok`/`not ok` assertion lines.
 */

/**
 * @param {string} output captured stdout/stderr of the test run
 * @returns {number|null} number of tests executed, or null if unparseable
 */
function countTests(output) {
  const text = String(output);

  // TAP plan/summary: `# tests 12` (node --test emits this).
  let m = text.match(/^#\s*tests\s+(\d+)\s*$/im);
  if (m) return Number(m[1]);

  // jest: `Tests:       12 passed, 1 failed, 13 total`
  m = text.match(/^Tests:\s+.*?(\d+)\s+total/im);
  if (m) return Number(m[1]);

  // vitest: `Tests  12 passed (12)` or `Test Files ...` -> prefer the `(N)` total
  m = text.match(/^\s*Tests\s+.*?\((\d+)\)/im);
  if (m) return Number(m[1]);
  m = text.match(/^\s*Tests\s+(\d+)\s+passed/im);
  if (m) return Number(m[1]);

  // mocha: `12 passing`
  m = text.match(/^\s*(\d+)\s+passing\b/im);
  if (m) return Number(m[1]);

  // rust (cargo test): `test result: ok. 12 passed; 0 failed; 1 ignored; ...`
  // Summed across crates; "executed" = passed + failed.
  const rust = [...text.matchAll(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed/gim)];
  if (rust.length) return rust.reduce((s, mm) => s + Number(mm[1]) + Number(mm[2]), 0);

  // go (`go test -v`): one `--- PASS|FAIL|SKIP: TestName` marker per test.
  const go = text.split('\n').filter((l) => /^\s*--- (PASS|FAIL|SKIP):/.test(l));
  if (go.length) return go.length;

  // Fallback: count TAP test points (`ok 1 - ...`, `not ok 2 - ...`),
  // excluding TAP version / plan lines.
  const okLines = text
    .split('\n')
    .filter((l) => /^(ok|not ok)\s+\d+/.test(l.trim()));
  if (okLines.length > 0) return okLines.length;

  return null;
}

/**
 * @param {number|null} count tests executed (null = unknown)
 * @param {number} minTests required minimum
 * @returns {{ok:boolean, count:number|null, minTests:number, reason:string}}
 */
function evaluate(count, minTests) {
  const min = typeof minTests === 'number' ? minTests : 1;
  if (count === null) {
    return {
      ok: false,
      count: null,
      minTests: min,
      reason: `could not determine test count from runner output (refusing to assume tests ran)`,
    };
  }
  if (count < min) {
    return {
      ok: false,
      count,
      minTests: min,
      reason: `only ${count} test(s) executed, require >= ${min}`,
    };
  }
  return { ok: true, count, minTests: min, reason: `${count} test(s) executed (>= ${min})` };
}

module.exports = { countTests, evaluate };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  // CLI: node check-min-tests.js <output-file|-> <minTests>
  const [, , outArg, minArg] = process.argv;
  let output = '';
  try {
    output =
      !outArg || outArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(outArg, 'utf8');
  } catch (err) {
    process.stderr.write(`quality-gate min-tests: cannot read output: ${err.message}\n`);
    process.exit(2);
  }
  const minTests = minArg === undefined ? 1 : Number(minArg);
  const res = evaluate(countTests(output), minTests);
  if (!res.ok) {
    process.stderr.write(`quality-gate min-tests: FAILED — ${res.reason}\n`);
    process.stderr.write(`  ::error::min-tests: ${res.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`quality-gate min-tests: OK — ${res.reason}.\n`);
}
/* node:coverage enable */
