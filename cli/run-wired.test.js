'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runWired, loadAssertions, readCapture, TOOL_ROOT } = require('./run-wired');

const email = require('../wired/assertions/email-actually-queued');
const booking = require('../wired/assertions/booking-rejects-overlap');

const FIX = path.join(TOOL_ROOT, 'wired', 'fixtures');
const CLI = path.join(__dirname, 'run-wired.js');

function loadFixture(rel) {
  return JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
}

// --- email-actually-queued: RED on the no-op default, GREEN on a real provider ---

test('email: RED on a no-op/stub transport default (audited #131/#129)', () => {
  const v = email.assert(loadFixture('email-actually-queued/red-noop.json'));
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /no-op|stub/i);
});

test('email: RED when emailSent claimed but nothing was sent', () => {
  const v = email.assert(loadFixture('email-actually-queued/red-empty.json'));
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /ZERO|never delivered|#131/i);
});

test('email: GREEN when a real provider is wired', () => {
  const v = email.assert(loadFixture('email-actually-queued/green.json'));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.details.real, 1);
});

test('email: every known stub token is treated as a no-op', () => {
  for (const t of ['test', 'mock', 'noop', 'console', 'memory', 'fake', 'disabled', '']) {
    assert.strictEqual(email.isStubTransport(t), true, `'${t}' should be a stub`);
  }
  for (const t of ['ses', 'sendgrid', 'smtp', 'postmark', 'resend']) {
    assert.strictEqual(email.isStubTransport(t), false, `'${t}' should be real`);
  }
  assert.strictEqual(email.isStubTransport(undefined), true);
});

test('email: a mix of stub + real transports is GREEN (a real send happened)', () => {
  const v = email.assert({ outbound: [{ transport: 'console' }, { transport: 'ses', id: 'x' }] });
  assert.strictEqual(v.ok, true);
});

// --- booking-rejects-overlap: RED when overlap allowed, GREEN when prevented ---

test('booking: RED when two overlapping bookings are both accepted', () => {
  const v = booking.assert(loadFixture('booking-rejects-overlap/red.json'));
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /overlap|double-booking/i);
});

test('booking: GREEN when the overlapping second booking is rejected', () => {
  const v = booking.assert(loadFixture('booking-rejects-overlap/green.json'));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.details.accepted, 1);
});

test('booking: half-prevented (A accepted, B rejected, C accepted overlapping A) is RED', () => {
  const v = booking.assert({
    attempts: [
      { resource: 'r', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', accepted: true },
      { resource: 'r', start: '2026-01-01T10:30:00Z', end: '2026-01-01T11:30:00Z', accepted: false },
      { resource: 'r', start: '2026-01-01T10:45:00Z', end: '2026-01-01T11:15:00Z', accepted: true },
    ],
  });
  assert.strictEqual(v.ok, false);
});

test('booking: different resources do not count as overlap', () => {
  const v = booking.assert({
    attempts: [
      { resource: 'room-1', start: 0, end: 100, accepted: true },
      { resource: 'room-2', start: 50, end: 150, accepted: true },
    ],
  });
  // No two attempts overlap (different resources) -> overlap path never exercised -> fail-closed.
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /never exercised|fail-closed/i);
});

test('booking: accepts epoch-number times and rejects non-overlap as GREEN', () => {
  const v = booking.assert({
    attempts: [
      { resource: 'r', start: 0, end: 100, accepted: true },
      { resource: 'r', start: 50, end: 150, accepted: false },
    ],
  });
  assert.strictEqual(v.ok, true);
});

test('booking: fail-closed on fewer than two attempts', () => {
  assert.strictEqual(booking.assert({ attempts: [] }).ok, false);
  assert.strictEqual(booking.assert({ attempts: [{ start: 0, end: 1, accepted: true }] }).ok, false);
});

test('booking: fail-closed on an invalid interval', () => {
  const v = booking.assert({
    attempts: [
      { resource: 'r', start: 'not-a-date', end: '2026-01-01T11:00:00Z', accepted: true },
      { resource: 'r', start: '2026-01-01T10:30:00Z', end: '2026-01-01T11:30:00Z', accepted: true },
    ],
  });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /invalid interval|fail-closed/i);
});

// --- harness runner ---

function withTempGate(cfg, captures, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-t3-'));
  try {
    const configPath = path.join(dir, 'gate.config.json');
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const capDir = path.join(dir, 'wired-captures');
    fs.mkdirSync(capDir, { recursive: true });
    for (const [id, obj] of Object.entries(captures || {})) {
      fs.writeFileSync(path.join(capDir, `${id}.json`), JSON.stringify(obj));
    }
    return fn({ configPath, capDir, dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('runner: skips when no wired[] is declared', () => {
  const r = runWired({ observations: {}, configPath: undefined });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.ok, true);
});

test('runner: reads captures from disk and reports per-assertion (RED set)', () => {
  withTempGate(
    { stack: 'ts', wired: ['email-actually-queued', 'booking-rejects-overlap'] },
    {
      'email-actually-queued': loadFixture('email-actually-queued/red-noop.json'),
      'booking-rejects-overlap': loadFixture('booking-rejects-overlap/red.json'),
    },
    ({ configPath, capDir }) => {
      const r = runWired({ configPath, captureDir: capDir });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.results.length, 2);
      assert.ok(r.results.every((x) => x.status === 'fail'));
    }
  );
});

test('runner: GREEN set passes the whole lane', () => {
  withTempGate(
    { stack: 'ts', wired: ['email-actually-queued', 'booking-rejects-overlap'] },
    {
      'email-actually-queued': loadFixture('email-actually-queued/green.json'),
      'booking-rejects-overlap': loadFixture('booking-rejects-overlap/green.json'),
    },
    ({ configPath, capDir }) => {
      const r = runWired({ configPath, captureDir: capDir });
      assert.strictEqual(r.ok, true, JSON.stringify(r.results));
      assert.ok(r.results.every((x) => x.status === 'pass'));
    }
  );
});

test('runner: fail-closed when a declared capture is missing', () => {
  withTempGate({ stack: 'ts', wired: ['email-actually-queued'] }, {}, ({ configPath, capDir }) => {
    const r = runWired({ configPath, captureDir: capDir });
    assert.strictEqual(r.ok, false);
    assert.match(r.results[0].reason, /no capture artifact|fail-closed/i);
  });
});

test('runner: invalid capture JSON fails (not crashes)', () => {
  withTempGate({ stack: 'ts', wired: ['email-actually-queued'] }, {}, ({ configPath, capDir }) => {
    fs.writeFileSync(path.join(capDir, 'email-actually-queued.json'), '{ not json');
    const r = runWired({ configPath, captureDir: capDir });
    assert.strictEqual(r.ok, false);
    assert.match(r.results[0].reason, /not valid JSON/i);
  });
});

test('runner: an unknown assertion id is an error (typo defense)', () => {
  const r = runWired({ observations: { 'no-such-assertion': {} }, configPath: undefined });
  // observations bypasses disk, but wired[] is read from config; use config form instead:
  assert.ok(r); // (above call skips because config has no wired[]) — assert via config:
  withTempGate({ stack: 'ts', wired: ['no-such-assertion'] }, {}, ({ configPath, capDir }) => {
    const rr = runWired({ configPath, captureDir: capDir });
    assert.strictEqual(rr.ok, false);
    assert.strictEqual(rr.results[0].status, 'error');
    assert.match(rr.results[0].reason, /unknown wired assertion/i);
  });
});

test('runner: observations map bypasses disk (in-memory assert)', () => {
  withTempGate({ stack: 'ts', wired: ['email-actually-queued'] }, {}, ({ configPath }) => {
    const r = runWired({ configPath, observations: { 'email-actually-queued': { outbound: [{ transport: 'ses', id: 'x' }] } } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.results[0].file, '(in-memory)');
  });
});

test('runner: a repo can supply a custom assertion via assertionsDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-t3-custom-'));
  try {
    const aDir = path.join(dir, 'assertions');
    fs.mkdirSync(aDir, { recursive: true });
    fs.writeFileSync(
      path.join(aDir, 'custom-check.js'),
      "module.exports = { id: 'custom-check', title: 'c', assert: (o) => ({ ok: o && o.good === true, reason: 'custom' }) };\n"
    );
    const capDir = path.join(dir, 'caps');
    fs.mkdirSync(capDir);
    fs.writeFileSync(path.join(capDir, 'custom-check.json'), JSON.stringify({ good: true }));
    const configPath = path.join(dir, 'gate.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ stack: 'ts', wired: ['custom-check'], wiredSetup: { assertionsDir: aDir } }));
    const r = runWired({ configPath, captureDir: capDir });
    assert.strictEqual(r.ok, true, JSON.stringify(r.results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAssertions discovers both built-ins', () => {
  const reg = loadAssertions([path.join(TOOL_ROOT, 'wired', 'assertions')]);
  assert.ok(reg.has('email-actually-queued'));
  assert.ok(reg.has('booking-rejects-overlap'));
});

test('readCapture flags a missing file', () => {
  const r = readCapture(os.tmpdir(), 'definitely-not-here-xyz');
  assert.strictEqual(r.missing, true);
});

// --- VERSION + manifest consistency (pinning parity with T1) ---

test('wired ruleset is versioned and the manifest matches the assertion files', () => {
  const version = fs.readFileSync(path.join(TOOL_ROOT, 'wired', 'VERSION'), 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, 'wired', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.version, version);

  const reg = loadAssertions([path.join(TOOL_ROOT, 'wired', 'assertions')]);
  const discovered = [...reg.keys()].sort();
  const manifestIds = manifest.assertions.map((a) => a.id).sort();
  assert.deepStrictEqual(manifestIds, discovered, 'manifest must list exactly the assertion modules');
});

// --- CLI end-to-end (exercises main()) ---

test('CLI exits 1 and emits ::error:: on a RED capture', () => {
  withTempGate({ stack: 'ts', wired: ['email-actually-queued'] }, {
    'email-actually-queued': loadFixture('email-actually-queued/red-noop.json'),
  }, ({ configPath, capDir }) => {
    const r = spawnSync('node', [CLI, '--config', configPath, '--capture-dir', capDir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /::error::wired\/email-actually-queued/);
  });
});

test('CLI exits 0 on a GREEN capture and skips with no wired[]', () => {
  withTempGate({ stack: 'ts', wired: ['email-actually-queued'] }, {
    'email-actually-queued': loadFixture('email-actually-queued/green.json'),
  }, ({ configPath, capDir }) => {
    const r = spawnSync('node', [CLI, '--config', configPath, '--capture-dir', capDir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
  });
  withTempGate({ stack: 'ts' }, {}, ({ configPath, capDir }) => {
    const r = spawnSync('node', [CLI, '--config', configPath, '--capture-dir', capDir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /skipping T3/);
  });
});
