'use strict';

/**
 * Retry-as-failure-signal check (T0).
 *
 * The audit found e2e retries silently masking flake: a test that fails then
 * passes on retry is reported "green". This check inspects a Playwright JSON
 * report, surfaces EVERY retried test as a GitHub warning annotation, and fails
 * the gate when total retries exceed `thresholds.maxRetries` (default 0).
 *
 * "flaky-then-passed" must never be silently green.
 */

/**
 * Walk a Playwright JSON report and collect retried tests.
 * Report shape: { suites: [ { specs: [ { title, tests: [ { results: [ { retry, status } ] } ] } ], suites: [...] } ] }
 * @param {object} report parsed Playwright JSON
 * @returns {Array<{title:string,retries:number,status:string}>}
 */
function parsePlaywrightRetries(report) {
  const retried = [];

  function visitSuite(suite, trail) {
    const name = suite.title ? trail.concat(suite.title) : trail;
    for (const spec of suite.specs || []) {
      const specTitle = name.concat(spec.title || '').filter(Boolean).join(' › ');
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const maxRetry = results.reduce((m, r) => Math.max(m, r.retry || 0), 0);
        if (maxRetry > 0) {
          const final = results[results.length - 1] || {};
          retried.push({ title: specTitle, retries: maxRetry, status: final.status || 'unknown' });
        }
      }
    }
    for (const child of suite.suites || []) visitSuite(child, name);
  }

  for (const suite of report.suites || []) visitSuite(suite, []);
  return retried;
}

/**
 * @param {Array<{retries:number}>} retried
 * @param {number} maxRetries tolerated total retries
 * @returns {{ok:boolean,totalRetries:number,maxRetries:number,retried:Array,reason:string}}
 */
function evaluate(retried, maxRetries) {
  const max = typeof maxRetries === 'number' ? maxRetries : 0;
  const totalRetries = retried.reduce((s, r) => s + r.retries, 0);
  const ok = totalRetries <= max;
  return {
    ok,
    totalRetries,
    maxRetries: max,
    retried,
    reason: ok
      ? `${totalRetries} retr(ies) within tolerance ${max}`
      : `${totalRetries} retr(ies) exceed tolerance ${max} — flaky tests must not pass silently`,
  };
}

module.exports = { parsePlaywrightRetries, evaluate };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  // CLI: node check-retries.js <playwright-report.json> <maxRetries>
  const [, , reportPath, maxArg] = process.argv;
  if (!reportPath) {
    process.stdout.write('quality-gate retries: no e2e report provided — skipping.\n');
    process.exit(0);
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      process.stdout.write(`quality-gate retries: no report at ${reportPath} — skipping.\n`);
      process.exit(0);
    }
    process.stderr.write(`quality-gate retries: cannot read report: ${err.message}\n`);
    process.exit(2);
  }
  const retried = parsePlaywrightRetries(report);
  // Always surface retries as warning annotations, pass or fail.
  for (const r of retried) {
    process.stdout.write(
      `::warning::flaky-retry: "${r.title}" needed ${r.retries} retr(ies) (final: ${r.status})\n`
    );
  }
  const res = evaluate(retried, maxArg === undefined ? 0 : Number(maxArg));
  if (!res.ok) {
    process.stderr.write(`quality-gate retries: FAILED — ${res.reason}\n`);
    process.stderr.write(`  ::error::retries: ${res.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`quality-gate retries: OK — ${res.reason}.\n`);
}
/* node:coverage enable */
