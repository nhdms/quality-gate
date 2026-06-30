'use strict';

/**
 * No-junk-diff check (T0).
 *
 * Fails the gate when a PR diff adds banned paths or oversized binary assets:
 * `.omc/`, build bundles, vendored design dumps, `node_modules/`, and images
 * over a size limit. The banned set and an allowlist are configurable via
 * gate.config.json's `noJunk` block.
 *
 * Zero dependencies: the gate runs on arbitrary self-hosted runners.
 */

const fs = require('fs');
const path = require('path');
const { matchesAny, normalize } = require('./lib/match');

// Defaults chosen from the audit: the 14k-line "fix CI" PR (#136) dumped
// design/binary junk and an `.omc/` directory. These hold unless overridden.
const DEFAULT_BANNED_PATHS = [
  '.omc/',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'out/',
  'coverage/',
  '*.min.js',
  '*.bundle.js',
  '*.map',
];

const DEFAULT_BANNED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.mp4',
  '.mov',
];

const DEFAULT_MAX_BINARY_BYTES = 1024 * 1024; // 1 MiB

function resolveOptions(noJunk) {
  const cfg = noJunk || {};
  return {
    bannedPaths: cfg.bannedPaths || DEFAULT_BANNED_PATHS,
    bannedExtensions: (cfg.bannedExtensions || DEFAULT_BANNED_EXTENSIONS).map((e) =>
      e.toLowerCase()
    ),
    maxBinaryBytes:
      typeof cfg.maxBinaryBytes === 'number' ? cfg.maxBinaryBytes : DEFAULT_MAX_BINARY_BYTES,
    allow: cfg.allow || [],
  };
}

/**
 * @param {Array<{path:string,size?:number}>} files added/changed files
 * @param {object} [noJunk] config block
 * @returns {Array<{path:string,reason:string}>} violations (empty = clean)
 */
function findJunk(files, noJunk) {
  const opts = resolveOptions(noJunk);
  const violations = [];

  for (const entry of files) {
    const file = typeof entry === 'string' ? { path: entry } : entry;
    const p = normalize(file.path);
    if (!p) continue;
    if (matchesAny(p, opts.allow)) continue;

    if (matchesAny(p, opts.bannedPaths)) {
      violations.push({ path: p, reason: 'banned path' });
      continue;
    }

    const ext = path.extname(p).toLowerCase();
    if (opts.bannedExtensions.includes(ext) && typeof file.size === 'number') {
      if (file.size > opts.maxBinaryBytes) {
        violations.push({
          path: p,
          reason: `binary asset ${file.size}B exceeds limit ${opts.maxBinaryBytes}B`,
        });
      }
    }
  }

  return violations;
}

module.exports = { findJunk, resolveOptions, DEFAULT_BANNED_PATHS, DEFAULT_MAX_BINARY_BYTES };

/* node:coverage disable */
if (require.main === module) {
  // CLI: node check-no-junk.js <files-list> [config.json]
  //   <files-list>: newline-separated paths (a file, or '-' for stdin).
  //   Sizes are stat'd from the working tree when the file exists.
  const [, , listArg, configPath] = process.argv;
  let listText = '';
  try {
    listText =
      !listArg || listArg === '-'
        ? fs.readFileSync(0, 'utf8')
        : fs.readFileSync(listArg, 'utf8');
  } catch (err) {
    process.stderr.write(`quality-gate no-junk: cannot read file list: ${err.message}\n`);
    process.exit(2);
  }

  let noJunk;
  if (configPath) {
    try {
      noJunk = JSON.parse(fs.readFileSync(configPath, 'utf8')).noJunk;
    } catch (err) {
      process.stderr.write(`quality-gate no-junk: cannot read config: ${err.message}\n`);
      process.exit(2);
    }
  }

  const files = listText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      let size;
      try {
        size = fs.statSync(p).size;
      } catch {
        /* deleted/absent: size-based rules simply don't apply */
      }
      return { path: p, size };
    });

  const violations = findJunk(files, noJunk);
  if (violations.length > 0) {
    process.stderr.write('quality-gate no-junk: FAILED — banned content in diff:\n');
    for (const v of violations) {
      process.stderr.write(`  ::error::no-junk: ${v.path} (${v.reason})\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`quality-gate no-junk: OK (${files.length} changed files clean).\n`);
}
/* node:coverage enable */
