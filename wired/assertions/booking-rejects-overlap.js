'use strict';

/**
 * Behavioral smoke assertion: `booking-rejects-overlap` (T3 wired-not-mock).
 *
 * Reproduces the audited "double-booking only half-prevented" failure: a
 * booking/slot system that lets two overlapping reservations both succeed.
 *
 * BLACK-BOX: it observes the *outcome* of attempting overlapping bookings, not
 * the internal guard. The repo's glue exercises its real booking path (real DB,
 * real constraint) with a pair of deliberately-overlapping requests and records
 * which attempts the system accepted.
 *
 * Observation schema (see wired/README.md):
 *
 *   {
 *     "trigger": "two overlapping bookings on room-1",
 *     "attempts": [
 *       { "id": "a", "resource": "room-1", "start": "2026-01-01T10:00:00Z", "end": "2026-01-01T11:00:00Z", "accepted": true },
 *       { "id": "b", "resource": "room-1", "start": "2026-01-01T10:30:00Z", "end": "2026-01-01T11:30:00Z", "accepted": true }
 *     ]
 *   }
 *
 * `start`/`end` accept ISO-8601 strings or epoch numbers. `resource` is optional
 * (overlap is only checked within the same resource); omit it for a single
 * shared resource. Intervals are half-open [start, end).
 *
 * RED  when two ACCEPTED attempts on the same resource overlap (double-booking).
 * GREEN when no two accepted attempts overlap, AND the capture actually
 *       exercised an overlapping pair (so a vacuous "nothing booked" can't pass).
 */

/** Parse a time to epoch ms; returns null when unparseable. */
function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Half-open interval overlap on the same resource. */
function intervalsOverlap(a, b) {
  return a.resource === b.resource && a.start < b.end && b.start < a.end;
}

/** Normalize an attempt into { resource, start, end, accepted } with parsed times. */
function normalize(attempt) {
  const a = attempt || {};
  return {
    raw: a,
    resource: a.resource === undefined || a.resource === null ? '__default__' : String(a.resource),
    start: toMs(a.start),
    end: toMs(a.end),
    accepted: a.accepted === true,
  };
}

/**
 * @param {object} observation see schema above
 * @returns {{ok:boolean, reason:string, details:object}}
 */
function assert(observation) {
  const obs = observation || {};
  const raw = Array.isArray(obs.attempts) ? obs.attempts : [];
  const attempts = raw.map(normalize);

  if (attempts.length < 2) {
    return {
      ok: false,
      reason: `capture has ${attempts.length} booking attempt(s) — need at least two overlapping attempts to prove overlap is rejected (fail-closed)`,
      details: { attempts: attempts.length },
    };
  }

  // Every attempt must carry a valid interval, else we cannot reason about overlap.
  const bad = attempts.find((a) => a.start === null || a.end === null || a.end <= a.start);
  if (bad) {
    return {
      ok: false,
      reason: `a booking attempt has a missing/invalid interval (start='${bad.raw.start}', end='${bad.raw.end}') — cannot prove overlap is rejected (fail-closed)`,
      details: { attempts: attempts.length },
    };
  }

  // Confirm the capture actually exercised an overlapping pair (accepted or not).
  let exercisedOverlap = false;
  for (let i = 0; i < attempts.length && !exercisedOverlap; i++) {
    for (let j = i + 1; j < attempts.length; j++) {
      if (intervalsOverlap(attempts[i], attempts[j])) {
        exercisedOverlap = true;
        break;
      }
    }
  }
  if (!exercisedOverlap) {
    return {
      ok: false,
      reason: 'no two attempts in the capture overlap in time — the overlap path was never exercised (fail-closed)',
      details: { attempts: attempts.length },
    };
  }

  // The real check: any two ACCEPTED attempts that overlap == double-booking.
  const accepted = attempts.filter((a) => a.accepted);
  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const a = accepted[i];
      const b = accepted[j];
      if (intervalsOverlap(a, b)) {
        return {
          ok: false,
          reason: `two accepted bookings overlap on resource '${a.resource}' (${a.raw.start}..${a.raw.end} ∩ ${b.raw.start}..${b.raw.end}) — double-booking is allowed`,
          details: { attempts: attempts.length, accepted: accepted.length },
        };
      }
    }
  }

  return {
    ok: true,
    reason: `overlap exercised and rejected — ${accepted.length} accepted of ${attempts.length} attempts, no two accepted bookings overlap`,
    details: { attempts: attempts.length, accepted: accepted.length },
  };
}

module.exports = {
  id: 'booking-rejects-overlap',
  title: 'Overlapping bookings are actually rejected',
  describe:
    'Creating two overlapping bookings/slots must be rejected by the system — ' +
    'only one of an overlapping pair may be accepted.',
  toMs,
  intervalsOverlap,
  normalize,
  assert,
};
