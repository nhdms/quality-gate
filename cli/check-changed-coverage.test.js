'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseLcov,
  parseDiffAddedLines,
  changedLineCoverage,
  evaluate,
  lcovKeyFor,
} = require('./check-changed-coverage');

const CLI = path.join(__dirname, 'check-changed-coverage.js');
const COV = path.join(__dirname, 'fixtures', 'coverage');

const LCOV = fs.readFileSync(path.join(COV, 'sample.lcov'), 'utf8');
const DIFF = fs.readFileSync(path.join(COV, 'sample.diff'), 'utf8');

test('parseLcov builds a per-file line->hits map', () => {
  const f = parseLcov(LCOV);
  assert.strictEqual(f['src/math.js'].get(1), 1);
  assert.strictEqual(f['src/math.js'].get(3), 0);
});

test('parseDiffAddedLines collects new-file line numbers', () => {
  const added = parseDiffAddedLines(DIFF);
  assert.deepStrictEqual([...added['src/math.js']].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('computes changed-line coverage over the intersection', () => {
  const res = changedLineCoverage(parseLcov(LCOV), parseDiffAddedLines(DIFF));
  assert.strictEqual(res.total, 5);
  assert.strictEqual(res.covered, 4);
  assert.strictEqual(Math.round(res.pct), 80);
});

test('passes at threshold 80 (DoD: gate GREEN), fails at 90 (DoD: gate RED)', () => {
  const res = changedLineCoverage(parseLcov(LCOV), parseDiffAddedLines(DIFF));
  assert.strictEqual(evaluate(res, 80).ok, true);
  assert.strictEqual(evaluate(res, 90).ok, false);
});

test('vacuously passes when no changed line is instrumented', () => {
  const res = changedLineCoverage(parseLcov(LCOV), { 'README.md': new Set([1, 2]) });
  assert.strictEqual(res.total, 0);
  assert.strictEqual(evaluate(res, 100).ok, true);
});

test('test files are excluded from the denominator', () => {
  const lcov = parseLcov('SF:src/a.test.js\nDA:1,0\nend_of_record\n');
  const res = changedLineCoverage(lcov, { 'src/a.test.js': new Set([1]) });
  assert.strictEqual(res.total, 0);
});

test('config-driven exclude globs drop files from the denominator', () => {
  const lcov = parseLcov('SF:gen/x.js\nDA:1,0\nend_of_record\n');
  const res = changedLineCoverage(lcov, { 'gen/x.js': new Set([1]) }, { exclude: ['gen/'] });
  assert.strictEqual(res.total, 0);
});

test('lcovKeyFor matches by path suffix (absolute vs repo-relative)', () => {
  const lcov = { '/abs/repo/src/math.js': new Map() };
  assert.strictEqual(lcovKeyFor('src/math.js', lcov), '/abs/repo/src/math.js');
});

test('CLI exits 0 at threshold 80 and 1 at threshold 90', () => {
  const lcovPath = path.join(COV, 'sample.lcov');
  const diffPath = path.join(COV, 'sample.diff');
  const r1 = spawnSync('node', [CLI, lcovPath, diffPath, '80'], { encoding: 'utf8' });
  assert.strictEqual(r1.status, 0);
  const r2 = spawnSync('node', [CLI, lcovPath, diffPath, '90'], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 1);
  assert.match(r2.stderr, /::error::changed-line coverage/);
});
