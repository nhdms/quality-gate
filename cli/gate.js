#!/usr/bin/env node
'use strict';

/**
 * `gate` — unified CLI entrypoint for the portable quality-gate (T4).
 *
 * Subcommands:
 *   gate init  [dir] [--ref <tag>] [--stack <ts|go|rust|auto>]
 *       Scaffold the gate into a repo (workflow + config stub + baseline dir).
 *       Idempotent. See gate-init.js.
 *   gate check [dir] [--config <path>]
 *       Run the local merge-oracle (the autopilot done-condition). Exit 0 when
 *       the quality-gate is satisfied, 1 when a fake-done/UI check fails. See
 *       gate-check.js.
 *
 * Exposed as the `gate` bin (see package.json) so agent-ord's onboarding step
 * can invoke `npx gate init` and its autopilot done-condition can shell out to
 * `gate check`.
 */

const path = require('path');

const USAGE = `gate — portable quality-gate CLI

usage:
  gate init  [dir] [--ref <tag>] [--stack <ts|go|rust|auto>]   scaffold the gate into a repo
  gate check [dir] [--config <gate.config.json>]               run the merge-oracle (done-condition)
  gate help                                                    show this help
`;

function main(argv) {
  const [sub, ...rest] = argv;

  switch (sub) {
    case 'init': {
      const { gateInit } = require('./gate-init');
      const opts = {};
      let dir = process.cwd();
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--ref') opts.ref = rest[++i];
        else if (a === '--stack') opts.stack = rest[++i];
        else if (!a.startsWith('-')) dir = path.resolve(a);
      }
      let result;
      try {
        result = gateInit(dir, opts);
      } catch (err) {
        process.stderr.write(`gate init: ${err.message}\n`);
        return 2;
      }
      process.stdout.write(`gate init: scaffolding into ${dir} (stack: ${result.stack}, pinned @${result.ref})\n`);
      for (const a of result.actions) {
        process.stdout.write(`  ${a.status === 'created' ? 'created ' : 'exists  '} ${a.path}\n`);
      }
      const created = result.actions.filter((a) => a.status === 'created').length;
      process.stdout.write(
        created === 0
          ? 'gate init: already initialised — nothing to do.\n'
          : 'gate init: done. Next: fill visual.routes + seed baselines (optional), then open a PR.\n'
      );
      return 0;
    }

    case 'check': {
      const { gateCheck } = require('./gate-check');
      const opts = {};
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--config') opts.configPath = rest[++i];
        else if (!a.startsWith('-')) opts.dir = path.resolve(a);
      }
      const { ok, checks } = gateCheck(opts);
      process.stdout.write('gate check: merge oracle\n');
      for (const c of checks) {
        process.stdout.write(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
        if (!c.ok) process.stderr.write(`    ${c.detail}\n`);
      }
      if (ok) {
        process.stdout.write('gate check: PASS — quality-gate satisfied (done-condition met).\n');
        return 0;
      }
      process.stderr.write('gate check: FAIL — quality-gate NOT satisfied; worker is NOT done.\n');
      return 1;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(USAGE);
      return sub === undefined ? 2 : 0;

    default:
      process.stderr.write(`gate: unknown subcommand '${sub}'\n\n${USAGE}`);
      return 2;
  }
}

module.exports = { main, USAGE };

/* node:coverage disable */
if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
/* node:coverage enable */
