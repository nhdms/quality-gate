'use strict';

/**
 * Visual oracle orchestrator (T2).
 *
 * Ties capture → diff into a single manifest the verdict step consumes:
 *   1. Playwright captures each route × breakpoint (overflow recorded).
 *   2. Each capture is diffed against its approved baseline in `visual.baselineDir`.
 *   3. A manifest.json is written: one entry per screen with comparison metrics,
 *      overflow flag, and a `baselineMissing` flag (never auto-baselined here).
 *
 * `cli/visual-verdict.js` then turns the manifest into a pass/fail + score.
 * Splitting capture from judgement keeps the verdict logic pure and unit-tested.
 */

const { compareFiles } = require('./visual-diff');
const { safeName } = require('./visual-capture');
const { get } = require('./config-get');

/**
 * Build manifest entries by diffing captures against baselines on disk.
 * Pure except for the injected `fs`/`path`/`compare` so it is unit-testable.
 * @param {Array<{route,width,file,path,overflow,error}>} captures
 * @param {string} baselineDir
 * @param {{fs:object,path:object,tolerance?:number,compare?:Function}} deps
 * @returns {object[]} verdict manifest entries
 */
function buildManifest(captures, baselineDir, deps) {
  const { fs, path } = deps;
  const compare = deps.compare || compareFiles;
  const tolerance = deps.tolerance;

  return (captures || []).map((cap) => {
    const base = {
      route: cap.route,
      width: cap.width,
      captured: cap.path,
      overflow: !!cap.overflow,
    };

    if (cap.error) {
      return { ...base, captureError: cap.error, baseline: null, comparison: null };
    }

    const baselineFile = path.join(baselineDir, cap.file || safeName(cap.route, cap.width));
    if (!fs.existsSync(baselineFile)) {
      return { ...base, baseline: baselineFile, baselineMissing: true, comparison: null };
    }

    let comparison = null;
    let captureError = null;
    try {
      comparison = compare(cap.path, baselineFile, { tolerance });
    } catch (err) {
      captureError = `diff failed: ${err.message}`;
    }
    return { ...base, baseline: baselineFile, comparison, captureError };
  });
}

/**
 * Resolve the base URL to capture against. An explicit VISUAL_BASE_URL (set by
 * gate.yml's `visual_base_url` input — e.g. a per-PR preview URL) must WIN over
 * the static `visual.baseURL` in config; otherwise a consumer that pins a config
 * baseURL could never point a run at a dynamic preview origin.
 * @param {object} cfg parsed gate config
 * @param {object} [env] environment (defaults to process.env)
 * @returns {string}
 */
function resolveBaseURL(cfg, env) {
  const e = env || process.env;
  const fromEnv = e.VISUAL_BASE_URL;
  if (fromEnv) return fromEnv;
  return get(cfg, 'visual.baseURL', 'http://localhost:3000');
}

module.exports = { buildManifest, resolveBaseURL };

/* node:coverage disable */
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { captureAll } = require('./visual-capture');

  // CLI: node visual-run.js <config.json> [outDir] [manifestOut]
  const [, , configPath, outDirArg, manifestArg] = process.argv;
  const outDir = outDirArg || '.visual/captures';
  const manifestOut = manifestArg || '.visual/manifest.json';

  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`quality-gate visual: cannot read config: ${err.message}\n`);
    process.exit(2);
  }

  const visual = cfg.visual || {};
  const routes = get(cfg, 'visual.routes', []);
  if (!Array.isArray(routes) || routes.length === 0) {
    // A `visual` block with no routes is almost certainly a misconfiguration:
    // silently passing it would be the exact fake-done this lane exists to stop.
    if (cfg.visual) {
      process.stderr.write(
        '::warning::quality-gate visual: a `visual` block is configured but `routes` is empty — nothing captured. Add routes or remove the block.\n'
      );
    } else {
      process.stdout.write('quality-gate visual: no visual config — skipping.\n');
    }
    process.exit(0);
  }
  const baseURL = resolveBaseURL(cfg);
  const baselineDir = get(cfg, 'visual.baselineDir', 'visual/baseline');
  const breakpoints = get(cfg, 'visual.breakpoints', undefined);
  const tolerance = get(cfg, 'visual.tolerance', 0);

  (async () => {
    const captures = await captureAll({ baseURL, routes, breakpoints, outDir, fs, path });
    const entries = buildManifest(captures, baselineDir, { fs, path, tolerance });
    fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
    fs.writeFileSync(manifestOut, JSON.stringify({ entries, visual }, null, 2));
    process.stdout.write(
      `quality-gate visual: captured ${captures.length} screen(s) → ${manifestOut}\n`
    );
  })().catch((err) => {
    process.stderr.write(`::error::quality-gate visual: capture failed: ${err.message}\n`);
    process.exit(1);
  });
}
/* node:coverage enable */
