'use strict';

/**
 * Tiny config reader so the lanes can pull values from gate.config.json without
 * depending on `jq` on the runner. Reads a dotted key with a fallback default.
 *
 *   node cli/config-get.js ./gate.config.json thresholds.minTests 1
 */

const fs = require('fs');

/**
 * @param {object} obj source object
 * @param {string} dotted dotted path, e.g. "thresholds.minTests"
 * @param {*} dflt value returned when the path is absent
 */
function get(obj, dotted, dflt) {
  let cur = obj;
  for (const key of String(dotted).split('.')) {
    if (cur && typeof cur === 'object' && key in cur) {
      cur = cur[key];
    } else {
      return dflt;
    }
  }
  return cur === undefined ? dflt : cur;
}

module.exports = { get };

/* node:coverage disable */
if (require.main === module) {
  const [, , configPath, key, dflt] = process.argv;
  if (!configPath || !key) {
    process.stderr.write('usage: config-get.js <config.json> <dotted.key> [default]\n');
    process.exit(2);
  }
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // Missing/invalid config → emit the default; the gate's detect job already
    // validated the config, so this path is only hit when truly absent.
  }
  const val = get(cfg, key, dflt === undefined ? '' : dflt);
  process.stdout.write(typeof val === 'object' ? JSON.stringify(val) : String(val));
}
/* node:coverage enable */
