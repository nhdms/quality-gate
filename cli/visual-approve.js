'use strict';

/**
 * Baseline approval helper for the visual oracle (T2).
 *
 * Copies freshly-captured screenshots into `visual.baselineDir` so they become
 * the approved baseline. This is the ONLY sanctioned way baselines get seeded
 * or re-approved, and it is deliberately a human-run, local command — it is
 * NEVER invoked by CI. The verdict step treats a missing baseline as a hard
 * fail precisely so that nothing auto-baselines silently and locks in a broken
 * UI as "correct".
 *
 * Guard: refuses to write unless `--approve` is passed, forcing an explicit,
 * reviewable act. The baseline must represent the DESIGN, not the last agent
 * output — see visual/README.md.
 *
 * Usage:
 *   node cli/visual-approve.js <capturesDir> <baselineDir> --approve
 */

const path = require('path');

/**
 * Compute which files would be copied (capture stem → baseline path).
 * Pure helper for testing; the CLI performs the actual copies.
 * @param {string[]} captureFiles basenames in the captures dir
 * @param {string} capturesDir
 * @param {string} baselineDir
 * @returns {Array<{from:string,to:string}>}
 */
function approvalPlan(captureFiles, capturesDir, baselineDir) {
  return (captureFiles || [])
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({
      from: path.join(capturesDir, f),
      to: path.join(baselineDir, f),
    }));
}

module.exports = { approvalPlan };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  const approve = args.includes('--approve');
  const [capturesDir, baselineDir] = args.filter((a) => !a.startsWith('--'));

  if (!capturesDir || !baselineDir) {
    process.stderr.write(
      'usage: visual-approve.js <capturesDir> <baselineDir> --approve\n'
    );
    process.exit(2);
  }

  let files = [];
  try {
    files = fs.readdirSync(capturesDir);
  } catch (err) {
    process.stderr.write(`visual-approve: cannot read captures: ${err.message}\n`);
    process.exit(2);
  }

  const plan = approvalPlan(files, capturesDir, baselineDir);
  if (plan.length === 0) {
    process.stderr.write('visual-approve: no .png captures found to approve.\n');
    process.exit(1);
  }

  if (!approve) {
    process.stdout.write(
      'visual-approve: DRY RUN (pass --approve to write). Would approve as baselines:\n'
    );
    for (const p of plan) process.stdout.write(`  ${p.from} -> ${p.to}\n`);
    process.stdout.write(
      '\nReview each screenshot against the DESIGN before approving — a baseline that\n' +
        'captures a broken UI locks that breakage in as "correct".\n'
    );
    process.exit(0);
  }

  fs.mkdirSync(baselineDir, { recursive: true });
  for (const p of plan) {
    fs.copyFileSync(p.from, p.to);
    process.stdout.write(`visual-approve: approved ${p.to}\n`);
  }
  process.stdout.write(`visual-approve: ${plan.length} baseline(s) approved.\n`);
}
/* node:coverage enable */
