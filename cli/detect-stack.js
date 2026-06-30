'use strict';

/**
 * Stack auto-detection for the quality gate.
 *
 * Detects `ts | go | rust` from the lockfiles / manifests present in a
 * directory. Primary-language manifests (go.mod, Cargo.toml) take precedence
 * over package.json, because Go/Rust repos frequently carry auxiliary JS
 * tooling (package.json for prettier, husky, etc.) that must not be mistaken
 * for the project's stack.
 */

const fs = require('fs');
const path = require('path');

// Ordered by precedence: the first stack whose signature files are present wins.
const SIGNATURES = [
  { stack: 'rust', files: ['Cargo.toml', 'Cargo.lock'] },
  { stack: 'go', files: ['go.mod', 'go.sum'] },
  { stack: 'ts', files: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'package.json'] },
];

/**
 * @param {string} dir directory to inspect
 * @returns {('ts'|'go'|'rust'|null)} detected stack, or null if undetectable
 */
function detectStack(dir = process.cwd()) {
  for (const sig of SIGNATURES) {
    for (const file of sig.files) {
      if (fs.existsSync(path.join(dir, file))) {
        return sig.stack;
      }
    }
  }
  return null;
}

module.exports = { detectStack, SIGNATURES };

if (require.main === module) {
  const dir = process.argv[2] || process.cwd();
  const stack = detectStack(dir);
  if (!stack) {
    process.stderr.write(
      `quality-gate: could not auto-detect stack in '${dir}'.\n` +
        `  Looked for: pnpm-lock.yaml/package-lock.json/yarn.lock/package.json (ts),\n` +
        `              go.mod/go.sum (go), Cargo.toml/Cargo.lock (rust).\n` +
        `  Set the 'stack' input explicitly to one of: ts | go | rust.\n`
    );
    process.exit(2);
  }
  process.stdout.write(stack + '\n');
}
