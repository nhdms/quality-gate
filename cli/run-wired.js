'use strict';

/**
 * Wired-not-mock behavioral smoke harness (T3).
 *
 * T1 catches fake-done *statically*; T3 catches it *behaviorally*. It asserts a
 * feature actually does the thing end-to-end — email really enqueued, an
 * overlapping booking really rejected — by inspecting a capture of what the
 * system did, not by trusting a 200 or a `{ ok: true }`.
 *
 * The harness is ~70% portable: the gate owns the assertion logic
 * (wired/assertions/<id>.js); the consuming repo provides the *glue* — a small
 * step that exercises its real feature (against its own DB/fixtures) and writes
 * a capture artifact `<captureDir>/<assertion-id>.json`. The harness then runs
 * the matching assertion against that capture.
 *
 * Config (gate.config.json, validated by gate.schema.json):
 *
 *   "wired": ["email-actually-queued", "booking-rejects-overlap"],
 *   "wiredSetup": {
 *     "command": "npm run smoke:wired",   // optional: produces the captures
 *     "captureDir": "wired-captures",      // where <id>.json artifacts live
 *     "assertionsDir": "gate/assertions"   // optional: repo's own assertions
 *   }
 *
 * FAIL-CLOSED: a declared assertion with no capture artifact FAILS — absence of
 * evidence is not evidence of wiring. Run as a blocking lane.
 *
 * Dependency-free Node (built-ins only) so it stays portable across runners.
 */

const fs = require('fs');
const path = require('path');

const TOOL_ROOT = path.resolve(__dirname, '..');

/**
 * Load assertion modules from one or more directories. Each module must export
 * `{ id, assert }` (and ideally `title`/`describe`). Later dirs override earlier
 * ones by id, so a repo can shadow a built-in.
 * @returns {Map<string, object>}
 */
function loadAssertions(dirs) {
  const registry = new Map();
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!/\.js$/.test(file) || file.endsWith('.test.js') || file === 'index.js') continue;
      // eslint-disable-next-line global-require
      const mod = require(path.join(dir, file));
      if (mod && typeof mod.id === 'string' && typeof mod.assert === 'function') {
        registry.set(mod.id, mod);
      }
    }
  }
  return registry;
}

/** Read + parse gate.config.json, tolerant of absence (validated upstream). */
function readConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`gate config '${configPath}' is not valid JSON: ${err.message}`);
  }
}

/**
 * Read a capture artifact for an assertion id.
 * @returns {{observation?:object, missing?:boolean, invalid?:boolean, file:string, error?:string}}
 */
function readCapture(captureDir, id) {
  const file = path.join(captureDir, `${id}.json`);
  if (!fs.existsSync(file)) return { missing: true, file };
  try {
    return { observation: JSON.parse(fs.readFileSync(file, 'utf8')), file };
  } catch (err) {
    return { invalid: true, file, error: err.message };
  }
}

/**
 * Run every assertion named in `wired[]` against its capture.
 *
 * @param {object} opts
 * @param {string} [opts.configPath]
 * @param {string} [opts.captureDir] overrides wiredSetup.captureDir
 * @param {string} [opts.toolDir]
 * @param {object} [opts.observations] id->observation, bypasses disk (for tests)
 * @returns {{skipped:boolean, ok:boolean, results:Array, captureDir:string}}
 */
function runWired({ configPath, captureDir, toolDir = TOOL_ROOT, observations } = {}) {
  const cfg = readConfig(configPath);
  const wired = Array.isArray(cfg.wired) ? cfg.wired : [];
  const setup = (cfg && typeof cfg.wiredSetup === 'object' && cfg.wiredSetup) || {};
  const capDir = captureDir || setup.captureDir || 'wired-captures';

  if (wired.length === 0) {
    return { skipped: true, ok: true, results: [], captureDir: capDir };
  }

  const dirs = [path.join(toolDir, 'wired', 'assertions')];
  if (setup.assertionsDir) dirs.push(path.resolve(setup.assertionsDir));
  const registry = loadAssertions(dirs);

  const results = [];
  for (const id of wired) {
    const mod = registry.get(id);
    if (!mod) {
      results.push({
        id,
        ok: false,
        status: 'error',
        reason: `unknown wired assertion '${id}' — no checker found in: ${dirs.join(', ')}`,
      });
      continue;
    }

    let observation;
    let file = '(in-memory)';
    if (observations && Object.prototype.hasOwnProperty.call(observations, id)) {
      observation = observations[id];
    } else {
      const cap = readCapture(capDir, id);
      file = cap.file;
      if (cap.missing) {
        results.push({
          id,
          ok: false,
          status: 'fail',
          file,
          title: mod.title,
          reason: `no capture artifact at ${cap.file} — cannot prove '${id}' is wired (fail-closed)`,
        });
        continue;
      }
      if (cap.invalid) {
        results.push({
          id,
          ok: false,
          status: 'fail',
          file,
          title: mod.title,
          reason: `capture ${cap.file} is not valid JSON: ${cap.error}`,
        });
        continue;
      }
      observation = cap.observation;
    }

    let verdict;
    try {
      verdict = mod.assert(observation);
    } catch (err) {
      verdict = { ok: false, reason: `assertion threw: ${err.message}` };
    }
    results.push({
      id,
      ok: !!verdict.ok,
      status: verdict.ok ? 'pass' : 'fail',
      file,
      title: mod.title,
      reason: verdict.reason,
      details: verdict.details,
    });
  }

  return { skipped: false, ok: results.every((r) => r.ok), results, captureDir: capDir };
}

function formatResult(r) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  const where = r.file && r.file !== '(in-memory)' ? `  (${r.file})` : '';
  return `  [${mark}] ${r.id}${where}\n        ${r.reason || ''}`;
}

module.exports = { runWired, loadAssertions, readConfig, readCapture, formatResult, TOOL_ROOT };

/* node:coverage disable */
function main(argv) {
  const args = argv.slice(2);
  let configPath = './gate.config.json';
  let toolDir = TOOL_ROOT;
  let captureDir;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config') configPath = args[++i];
    else if (a === '--tool-dir') toolDir = args[++i];
    else if (a === '--capture-dir') captureDir = args[++i];
  }

  let result;
  try {
    result = runWired({ configPath, toolDir, captureDir });
  } catch (err) {
    process.stderr.write(`quality-gate (T3 wired): ${err.message}\n`);
    process.exit(2);
    return;
  }

  if (result.skipped) {
    process.stdout.write('quality-gate: no wired[] assertions declared — skipping T3 behavioral smoke.\n');
    process.exit(0);
    return;
  }

  process.stdout.write(
    `quality-gate: wired-not-mock behavioral smoke (T3) — ${result.results.length} assertion(s), captures in '${result.captureDir}/'\n`
  );
  for (const r of result.results) {
    process.stdout.write(formatResult(r) + '\n');
    if (!r.ok) process.stdout.write(`::error::wired/${r.id}: ${r.reason}\n`);
  }

  if (!result.ok) {
    const failed = result.results.filter((r) => !r.ok).map((r) => r.id).join(', ');
    process.stdout.write(`\nquality-gate: FAILED — wired-not-mock assertion(s) not satisfied: ${failed}\n`);
    process.exit(1);
    return;
  }
  process.stdout.write('\nquality-gate: PASSED — every declared capability is wired end-to-end.\n');
  process.exit(0);
}

if (require.main === module) {
  main(process.argv);
}
/* node:coverage enable */
