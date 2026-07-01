'use strict';

/**
 * Behavioral smoke assertion: `email-actually-queued` (T3 wired-not-mock).
 *
 * Reproduces the audited "wired-not-mock" failure (#131/#129): an app reports
 * `emailSent: true` while the email transport is a no-op/stub that silently
 * drops every message — nothing is ever delivered.
 *
 * This is a BLACK-BOX check: it does not inspect the app's source or which
 * function was called. It inspects an *observation* — a capture of what the
 * system actually did when the email path was triggered — and asserts a real
 * outbound send/enqueue attempt happened over a real transport.
 *
 * Observation schema (the repo's glue produces this, see wired/README.md):
 *
 *   {
 *     "trigger": "POST /api/signup",          // optional: what was exercised
 *     "claimed": { "emailSent": true },        // optional: what the app reported
 *     "outbound": [                            // captured real send/enqueue attempts
 *       { "transport": "ses", "to": "a@b.com", "id": "0100018f..." }
 *     ]
 *   }
 *
 * RED  when `outbound` is empty (claimed sent, nothing captured) OR every
 *      captured attempt uses a known no-op/stub transport.
 * GREEN when at least one outbound attempt goes over a real (non-stub) transport.
 */

// Transport names that mean "this does not actually send anything". Matched
// case-insensitively against the whole transport token. These stub tokens are
// detector DATA, not a stub standing in on a prod path — this file is the T3
// harness that reasons about stubs, so the T1 anti-fake-done rule mis-fires.
// ast-grep-ignore: no-mock-in-prod-path
const STUB_TRANSPORTS = new Set([
  'test', 'tests', 'testing',
  'noop', 'no-op', 'none', 'null', 'void', 'off', 'disabled', 'disable',
  'mock', 'mocks', 'mocked', 'stub', 'stubs', 'fake', 'faked', 'dummy', 'sham',
  'console', 'log', 'logger', 'memory', 'in-memory', 'inmemory', 'local',
  'drain', 'blackhole', 'sink', 'devnull', 'dev-null', '/dev/null',
]);

/** A transport is a stub if it is empty/unnamed or a known no-op token. */
function isStubTransport(name) {
  if (name === undefined || name === null) return true;
  const t = String(name).trim().toLowerCase();
  if (t === '') return true;
  return STUB_TRANSPORTS.has(t);
}

/** Did the app *claim* it sent the email? (any of the common success flags) */
function claimedSent(claimed) {
  if (!claimed || typeof claimed !== 'object') return false;
  return claimed.emailSent === true || claimed.sent === true || claimed.ok === true || claimed.queued === true;
}

/**
 * @param {object} observation see schema above
 * @returns {{ok:boolean, reason:string, details:object}}
 */
function assert(observation) {
  const obs = observation || {};
  const outbound = Array.isArray(obs.outbound) ? obs.outbound : [];
  const claimed = claimedSent(obs.claimed);

  if (outbound.length === 0) {
    return {
      ok: false,
      reason: claimed
        ? 'reported emailSent:true but captured ZERO outbound send/enqueue attempts — the email is never delivered (audited #131/#129)'
        : 'no outbound send/enqueue attempt was captured when the email path was triggered — it is a no-op',
      details: { outbound: 0, real: 0, claimedSent: claimed },
    };
  }

  const real = outbound.filter((o) => !isStubTransport(o && o.transport));
  if (real.length === 0) {
    const transports = outbound.map((o) => (o && o.transport) || '(unnamed)').join(', ');
    return {
      ok: false,
      reason: `email routed only to a no-op/stub transport (${transports}) — nothing actually leaves the system`,
      details: { outbound: outbound.length, real: 0, transports },
    };
  }

  const transports = real.map((o) => o.transport).join(', ');
  // This ok:true is DERIVED from proven-real sends (`real` = outbound over
  // non-stub transports); it is the opposite of a lying return. The T1 rule
  // mis-fires because the same function body names stub transports as data.
  // ast-grep-ignore: no-lying-return
  return {
    ok: true,
    reason: `${real.length} real outbound send/enqueue attempt(s) captured over: ${transports}`,
    details: { outbound: outbound.length, real: real.length, transports },
  };
}

module.exports = {
  id: 'email-actually-queued',
  title: 'Email is actually queued/sent (not a no-op)',
  describe:
    'Triggering an email path must produce a real outbound send/enqueue attempt — ' +
    'not a stub transport that drops the message while reporting success.',
  isStubTransport,
  claimedSent,
  assert,
};
