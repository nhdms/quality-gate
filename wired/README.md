# Wired-not-mock behavioral smoke harness (T3)

T1 catches fake-done **statically** (a function returns `{ sent: true }` next to
a stub transport). T3 catches it **behaviorally**: it asserts the feature
*actually does the thing* end-to-end — the email is really enqueued, the
overlapping booking is really rejected — by observing what the system **did**,
not by trusting a `200` or a hardcoded success flag.

This is the layer that catches the audited "wired-not-mock" failures:
`emailSent: true` while no email ever leaves the box (#131/#129), and
double-booking that was only half-prevented.

- **Version:** [`VERSION`](./VERSION) / [`manifest.json`](./manifest.json). Pin a
  known set when consuming the gate.
- **Runner:** [`../cli/run-wired.js`](../cli/run-wired.js) (dependency-free Node).
- **Regression test:** [`../cli/run-wired.test.js`](../cli/run-wired.test.js) —
  every assertion goes **RED** on the bad case and **GREEN** on the clean one.
- **Lane:** runs as a **blocking** step in the `ts` lane, only when the caller
  declares `wired[]`.

## How it works

Assertions are **black-box**: they never read your source or check which
function was called (so they survive refactors). They inspect an *observation* —
a small JSON **capture artifact** of what your system actually did when the path
was triggered.

```
your glue (per repo)                 the harness (portable)
─────────────────────                ──────────────────────
exercise the real feature   ──►  wired-captures/<assertion-id>.json  ──►  assert(observation) ──► PASS / FAIL
(real DB, real provider)              (the capture)                        (wired/assertions/<id>.js)
```

The gate owns the assertion logic (~70% portable); you own the ~30% glue that
produces the capture against your own setup.

## Configure it

```json
{
  "stack": "ts",
  "wired": ["email-actually-queued", "booking-rejects-overlap"],
  "wiredSetup": {
    "command": "npm run smoke:wired",
    "captureDir": "wired-captures"
  }
}
```

- **`wired`** (string[]) — assertion ids that must pass. Each must resolve to a
  built-in (below) or a custom assertion (see *Adding your own*).
- **`wiredSetup.command`** (string, optional) — your glue. The lane runs it
  before the harness; it should exercise the real feature and write
  `<captureDir>/<assertion-id>.json`.
- **`wiredSetup.captureDir`** (string, default `wired-captures`) — where the
  harness reads captures from.
- **`wiredSetup.assertionsDir`** (string, optional) — a dir of your own
  assertion modules, merged with the built-ins.

> **Fail-closed.** A declared assertion with no capture artifact **fails** the
> gate. Absence of evidence is not evidence of wiring.

## Built-in assertions

### `email-actually-queued`

Triggering an email path must produce a **real** outbound send/enqueue attempt —
not a no-op/stub transport that drops the message while reporting success.

Capture (`wired-captures/email-actually-queued.json`):

```json
{
  "trigger": "POST /api/signup",
  "claimed": { "emailSent": true },
  "outbound": [{ "transport": "ses", "to": "a@b.com", "id": "0100018f..." }]
}
```

- **RED** — `outbound` is empty (claimed sent, nothing captured) **or** every
  attempt uses a known stub transport (`test`, `mock`, `noop`, `console`,
  `memory`, …). This is the audited #131/#129 condition.
- **GREEN** — at least one attempt over a real transport (`ses`, `sendgrid`,
  `smtp`, a real queue, …).

### `booking-rejects-overlap`

Creating two overlapping bookings/slots must be rejected — only one of an
overlapping pair may be accepted.

Capture (`wired-captures/booking-rejects-overlap.json`):

```json
{
  "trigger": "two overlapping bookings on room-1",
  "attempts": [
    { "resource": "room-1", "start": "2026-01-01T10:00:00Z", "end": "2026-01-01T11:00:00Z", "accepted": true },
    { "resource": "room-1", "start": "2026-01-01T10:30:00Z", "end": "2026-01-01T11:30:00Z", "accepted": false }
  ]
}
```

`start`/`end` accept ISO-8601 strings or epoch ms; `resource` is optional (omit
for a single shared resource). Intervals are half-open `[start, end)`.

- **RED** — two **accepted** attempts on the same resource overlap.
- **GREEN** — the overlap was exercised and no two accepted attempts overlap.
- **fail-closed** — fewer than two attempts, an invalid interval, or no
  overlapping pair in the capture (the path was never actually exercised).

## Producing captures (the glue)

Your `wiredSetup.command` is whatever exercises your real feature. A typical
shape:

```js
// scripts/smoke-wired.mjs  — runs against a real (test) DB + real provider stubbed at the EDGE only
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('wired-captures', { recursive: true });

// 1) capture an outbound side-effect by spying at the transport boundary
const outbound = [];
const provider = makeSesProvider({ onSend: (m) => outbound.push({ transport: 'ses', to: m.to, id: m.MessageId }) });
await signup({ email: 'a@b.com' }, { mailer: provider });  // your REAL signup path
writeFileSync('wired-captures/email-actually-queued.json', JSON.stringify({ claimed: { emailSent: true }, outbound }));

// 2) attempt two overlapping bookings against the real constraint
const attempts = [];
for (const b of [{ start: '...T10:00Z', end: '...T11:00Z' }, { start: '...T10:30Z', end: '...T11:30Z' }]) {
  const res = await createBooking({ resource: 'room-1', ...b });   // your REAL booking path
  attempts.push({ resource: 'room-1', ...b, accepted: res.ok });
}
writeFileSync('wired-captures/booking-rejects-overlap.json', JSON.stringify({ attempts }));
```

The point: stub only at the **outermost edge** (so nothing actually leaves the
machine) and record the attempt. Everything between the entrypoint and that edge
is the real wiring under test.

## Adding your own assertion (minimal glue)

1. Drop a module in your `wiredSetup.assertionsDir`:

   ```js
   // gate/assertions/webhook-actually-delivered.js
   module.exports = {
     id: 'webhook-actually-delivered',
     title: 'Webhook is actually delivered',
     assert(observation) {
       const delivered = (observation.deliveries || []).filter((d) => d.status === 200);
       return delivered.length > 0
         ? { ok: true, reason: `${delivered.length} webhook(s) delivered` }
         : { ok: false, reason: 'no webhook delivery with a 2xx was captured' };
     },
   };
   ```

2. Add `"webhook-actually-delivered"` to `wired[]`.
3. Have your glue write `wired-captures/webhook-actually-delivered.json`.

An assertion module exports `{ id, assert }` (plus optional `title`/`describe`).
`assert(observation)` returns `{ ok: boolean, reason: string, details?: object }`.

## Running locally

```sh
node --test cli/run-wired.test.js                  # the assertion regression suite
node cli/run-wired.js --config ./gate.config.json  # run against captures on disk
```
