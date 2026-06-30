'use strict';

/**
 * Visual verdict (T2).
 *
 * Turns a manifest of per-(route × breakpoint) comparison results into a
 * structured pass/fail verdict plus a 0-100 score, mirroring the
 * `oh-my-claudecode:visual-verdict` contract (score / verdict / differences).
 * This is what makes CI no longer blind to UI breakage and design drift.
 *
 * An entry fails (turns the gate RED) on ANY of:
 *   - capture error (page errored / blank)
 *   - no approved baseline  → "no silent auto-baseline"; a missing baseline is a
 *     hard fail, never a quiet pass. Baselines are seeded via the documented
 *     approval flow (see visual/README.md), never by CI.
 *   - horizontal overflow at the breakpoint (e.g. a fixed-pixel table wider than
 *     a 375px viewport) — an absolute defect, caught even before baselines exist
 *   - dimension mismatch vs the baseline
 *   - pixel drift above `maxDiffRatio`, or score below `minScore`
 *
 * Score = round(100 - diffRatio*100); a hard flag forces score 0.
 *
 * Zero runtime dependencies.
 */

const DEFAULTS = {
  minScore: 90, // the visual-verdict skill's pass threshold
  maxDiffRatio: 0, // pixel-perfect by default; loosen for cross-runner AA noise
};

function resolveOptions(visualCfg) {
  const cfg = visualCfg || {};
  return {
    minScore: typeof cfg.minScore === 'number' ? cfg.minScore : DEFAULTS.minScore,
    maxDiffRatio: typeof cfg.maxDiffRatio === 'number' ? cfg.maxDiffRatio : DEFAULTS.maxDiffRatio,
  };
}

/**
 * Score and judge a single manifest entry.
 * @param {object} entry
 * @param {{minScore:number,maxDiffRatio:number}} opts
 * @returns {{id:string,score:number,pass:boolean,differences:string[]}}
 */
function judgeEntry(entry, opts) {
  const id = `${entry.route || '?'} @${entry.width || '?'}px`;
  const differences = [];

  if (entry.captureError) {
    return { id, score: 0, pass: false, differences: [`capture failed: ${entry.captureError}`] };
  }
  if (entry.baselineMissing) {
    return {
      id,
      score: 0,
      pass: false,
      differences: ['no approved baseline (seed via approval flow; never auto-baselined)'],
    };
  }

  let hard = false;
  if (entry.overflow) {
    differences.push(`horizontal overflow at ${entry.width}px (content wider than viewport)`);
    hard = true;
  }
  const cmp = entry.comparison || {};
  if (cmp.dimensionMismatch) {
    differences.push('dimension mismatch vs baseline (likely a layout regression)');
    hard = true;
  }

  const diffRatio = typeof cmp.diffRatio === 'number' ? cmp.diffRatio : 0;
  const score = hard ? 0 : Math.max(0, Math.round(100 - diffRatio * 100));

  if (!hard && diffRatio > opts.maxDiffRatio) {
    const pct = (diffRatio * 100).toFixed(3);
    differences.push(`pixel drift ${pct}% (${cmp.diffPixels}/${cmp.totalPixels}) exceeds max ${(opts.maxDiffRatio * 100).toFixed(3)}%`);
  }
  if (!hard && score < opts.minScore) {
    differences.push(`score ${score} below minimum ${opts.minScore}`);
  }

  const pass = !hard && diffRatio <= opts.maxDiffRatio && score >= opts.minScore;
  return { id, score, pass, differences };
}

/**
 * Produce an aggregate verdict over all entries.
 * @param {object[]} entries manifest entries
 * @param {object} [visualCfg] the gate.config.json `visual` block
 * @returns {{score:number,verdict:string,pass:boolean,results:object[],
 *            differences:string[]}}
 */
function verdict(entries, visualCfg) {
  const opts = resolveOptions(visualCfg);
  const results = (entries || []).map((e) => judgeEntry(e, opts));

  const pass = results.length > 0 && results.every((r) => r.pass);
  // Overall score is the worst single comparison — one broken screen fails it.
  const score = results.length ? Math.min(...results.map((r) => r.score)) : 0;
  const differences = results
    .filter((r) => !r.pass)
    .flatMap((r) => r.differences.map((d) => `${r.id}: ${d}`));

  return {
    score,
    verdict: pass ? 'pass' : 'fail',
    pass,
    results,
    differences,
  };
}

module.exports = { verdict, judgeEntry, resolveOptions, DEFAULTS };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  // CLI: node visual-verdict.js <manifest.json> [config.json]
  //   <manifest.json>: { entries: [...] } produced by visual-run.js
  const [, , manifestArg, configPath] = process.argv;
  if (!manifestArg) {
    process.stderr.write('usage: visual-verdict.js <manifest.json> [config.json]\n');
    process.exit(2);
  }

  let entries = [];
  try {
    const m = JSON.parse(fs.readFileSync(manifestArg, 'utf8'));
    entries = Array.isArray(m) ? m : m.entries || [];
  } catch (err) {
    process.stderr.write(`quality-gate visual: cannot read manifest: ${err.message}\n`);
    process.exit(2);
  }

  let visualCfg;
  if (configPath) {
    try {
      visualCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')).visual;
    } catch (err) {
      process.stderr.write(`quality-gate visual: cannot read config: ${err.message}\n`);
      process.exit(2);
    }
  }

  const v = verdict(entries, visualCfg);

  // Surface the score for the PR check output (GitHub Actions annotations +
  // job summary if available).
  process.stdout.write(`quality-gate visual: score=${v.score} verdict=${v.verdict}\n`);
  for (const r of v.results) {
    const tag = r.pass ? 'OK' : 'FAIL';
    process.stdout.write(`  [${tag}] ${r.id} score=${r.score}\n`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = ['### Visual oracle', '', `**Score: ${v.score}/100 — ${v.verdict.toUpperCase()}**`, '', '| Screen | Score | Result |', '| ------ | ----- | ------ |'];
    for (const r of v.results) {
      lines.push(`| ${r.id} | ${r.score} | ${r.pass ? '✅' : '❌'} |`);
    }
    if (v.differences.length) {
      lines.push('', '**Differences:**', ...v.differences.map((d) => `- ${d}`));
    }
    try {
      fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
    } catch {
      /* summary is best-effort */
    }
  }

  if (!v.pass) {
    process.stderr.write(`::error::quality-gate visual: FAILED (score ${v.score})\n`);
    for (const d of v.differences) {
      process.stderr.write(`  ::error::visual: ${d}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('quality-gate visual: OK (UI matches approved baselines).\n');
}
/* node:coverage enable */
