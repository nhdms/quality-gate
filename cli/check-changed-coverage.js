'use strict';

/**
 * Changed-line coverage gate (T0).
 *
 * Coverage must meet `thresholds.changedLineCoverage` on the lines the PR
 * actually changed — NOT a global %, which the audit found can stay green while
 * new code ships untested. Intersects added lines (from `git diff -U0`) with an
 * LCOV report and computes the hit ratio over instrumented changed lines.
 *
 * Zero dependencies; pure parsers so the math is unit-tested against fixtures.
 */

const path = require('path');
const { matchesAny, normalize } = require('./lib/match');

/**
 * Parse an LCOV report into { [file]: Map(lineNo -> hits) }.
 * Honours SF (source file) and DA (line,hits) records.
 */
function parseLcov(text) {
  const files = {};
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = normalize(line.slice(3));
      if (!files[current]) files[current] = new Map();
    } else if (line.startsWith('DA:') && current) {
      const [no, hits] = line.slice(3).split(',');
      files[current].set(Number(no), Number(hits));
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return files;
}

/**
 * Parse a unified diff (produced with -U0) into { [file]: Set(addedLineNo) }.
 * Line numbers are in the NEW file's coordinate space.
 */
function parseDiffAddedLines(diffText) {
  const byFile = {};
  let current = null;
  let newLine = 0;
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).trim();
      current = target === '/dev/null' ? null : normalize(target.replace(/^b\//, ''));
      if (current && !byFile[current]) byFile[current] = new Set();
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      byFile[current].add(newLine);
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // removed line: does not advance the new-file counter
    } else if (!raw.startsWith('\\')) {
      // context line (only present with >0 context): advances new-file counter
      newLine++;
    }
  }
  return byFile;
}

/** Match an lcov path to a diff path by suffix (handles absolute vs repo-rel). */
function lcovKeyFor(diffPath, lcovFiles) {
  if (lcovFiles[diffPath]) return diffPath;
  const base = normalize(diffPath);
  for (const key of Object.keys(lcovFiles)) {
    const nk = normalize(key);
    if (nk === base || nk.endsWith('/' + base) || base.endsWith('/' + nk)) return key;
  }
  return null;
}

/**
 * @param {object} lcovFiles parseLcov output
 * @param {object} addedByFile parseDiffAddedLines output
 * @param {object} [opts] { exclude: string[] }
 * @returns {{covered:number,total:number,pct:number,uncovered:Array<{file:string,line:number}>}}
 */
function changedLineCoverage(lcovFiles, addedByFile, opts) {
  const exclude = (opts && opts.exclude) || [];
  let covered = 0;
  let total = 0;
  const uncovered = [];

  for (const [file, addedSet] of Object.entries(addedByFile)) {
    if (matchesAny(file, exclude)) continue;
    if (path.extname(file) === '.test.js' || /\.test\.[jt]sx?$/.test(file)) continue;
    const key = lcovKeyFor(file, lcovFiles);
    if (!key) continue; // not an instrumented source file → not coverable
    const hitMap = lcovFiles[key];
    for (const lineNo of addedSet) {
      if (!hitMap.has(lineNo)) continue; // non-executable line (blank, brace, comment)
      total++;
      if (hitMap.get(lineNo) > 0) covered++;
      else uncovered.push({ file, line: lineNo });
    }
  }

  const pct = total === 0 ? 100 : (covered / total) * 100;
  return { covered, total, pct, uncovered };
}

/**
 * @returns {{ok:boolean, pct:number, total:number, threshold:number, reason:string, uncovered:Array}}
 */
function evaluate(result, threshold) {
  const t = typeof threshold === 'number' ? threshold : 0;
  if (result.total === 0) {
    return {
      ok: true,
      pct: 100,
      total: 0,
      threshold: t,
      reason: 'no instrumented changed lines to cover',
      uncovered: [],
    };
  }
  const ok = result.pct >= t;
  return {
    ok,
    pct: result.pct,
    total: result.total,
    threshold: t,
    reason: `${result.covered}/${result.total} changed lines covered (${result.pct.toFixed(1)}%) vs threshold ${t}%`,
    uncovered: result.uncovered,
  };
}

module.exports = { parseLcov, parseDiffAddedLines, changedLineCoverage, evaluate, lcovKeyFor };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  // CLI: node check-changed-coverage.js <lcov> <diff> <threshold> [config.json]
  const [, , lcovPath, diffPath, thrArg, configPath] = process.argv;
  if (!lcovPath || !diffPath) {
    process.stderr.write('usage: check-changed-coverage.js <lcov> <diff> <threshold> [config.json]\n');
    process.exit(2);
  }
  let exclude = [];
  if (configPath) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      exclude = (cfg.coverage && cfg.coverage.exclude) || [];
    } catch {
      /* optional */
    }
  }
  let lcov;
  let diff;
  try {
    lcov = parseLcov(fs.readFileSync(lcovPath, 'utf8'));
    diff = parseDiffAddedLines(fs.readFileSync(diffPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`quality-gate coverage: cannot read inputs: ${err.message}\n`);
    process.exit(2);
  }
  const res = evaluate(changedLineCoverage(lcov, diff, { exclude }), Number(thrArg));
  if (!res.ok) {
    process.stderr.write(`quality-gate coverage: FAILED — ${res.reason}\n`);
    for (const u of res.uncovered.slice(0, 50)) {
      process.stderr.write(`  ::warning file=${u.file},line=${u.line}::changed line not covered\n`);
    }
    process.stderr.write(`  ::error::changed-line coverage ${res.pct.toFixed(1)}% < ${res.threshold}%\n`);
    process.exit(1);
  }
  process.stdout.write(`quality-gate coverage: OK — ${res.reason}.\n`);
}
/* node:coverage enable */
