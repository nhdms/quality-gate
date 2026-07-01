# Anti-fake-done static ruleset (T1)

A versioned [ast-grep](https://ast-grep.github.io) ruleset that catches the
**"optimistic success signaling"** defect class — code that reports
`OK`/`sent`/`prevented` when the guarantee is absent. This is the insidious
**"fake-done"** that passes every other automated check: the types compile, the
tests are green, the function returns `{ ok: true }` — but nothing actually
happened.

The rules are derived directly from the audit findings (the fixtures **are** the
spec). They run as a **blocking lane** in `gate.yml` (the `ts` lane).

- **Version:** see [`VERSION`](./VERSION) / [`manifest.json`](./manifest.json).
  Pin a known set when consuming the gate.
- **Engine:** ast-grep `0.39.5` (pinned in `package.json` and installed by the
  lane).
- **Languages:** TS / TSX / JS / JSX. A single `tsx` grammar covers them all via
  `languageGlobs` in [`sgconfig.yml`](./sgconfig.yml). Go/Rust variants can be
  added later as sibling rule files without touching this layout.

## Layout

```
rules/
  sgconfig.yml          ast-grep project config (rule dirs + language mapping)
  VERSION               semver of the ruleset
  manifest.json         machine-readable rule list + version (for pinning)
  rules/                the rule definitions (one .yml per rule)
  fixtures/<rule-id>/   bad.* (must go RED) + good.* (must stay GREEN)
```

The runner is [`../cli/run-rules.js`](../cli/run-rules.js); the regression test
is [`../cli/run-rules.test.js`](../cli/run-rules.test.js). Every rule has a
positive (bad) and negative (good/clean) fixture, and the test asserts each rule
goes RED on the bad case and GREEN on the clean one.

## Running locally

```sh
npm ci                                   # installs the pinned ast-grep
node cli/run-rules.js .                   # scan the current repo (blocking)
node --test cli/run-rules.test.js         # run the rule regression suite
```

## Configuration

Per-project toggles live in `gate.config.json` (validated by
`gate.schema.json`), never hardcoded in the workflow:

```json
{
  "stack": "ts",
  "rules": {
    "enabled": true,
    "disabled": ["no-mock-in-prod-path"],
    "warnOnly": ["no-dev-script-in-layout"]
  }
}
```

- **`enabled`** (bool, default `true`) — master switch for the lane.
- **`disabled`** (string[]) — rule ids that are never run.
- **`warnOnly`** (string[]) — rule ids that are reported but do **not** fail the
  gate (advisory severity).

All rules skip test/spec/story/`__mocks__`/`fixtures`/`node_modules` paths
(`ignores` in each rule) so legitimate mocks in tests are never flagged.

---

## Rules

### no-noop-default-prod

**Severity: error.** A provider/transport whose default resolves to a
no-op/stub when an env var is unset, with no production guard.

> Audit: fillr `lib/email/client.ts` — `EMAIL_PROVIDER ?? "test"` silently
> resolves to a no-op transport that drops every email while reporting success.

Flags `process.env.X ?? "<stub>"` / `process.env.X || "<stub>"` where the
fallback literal is a known stub/no-op token (`test`, `mock`, `stub`, `noop`,
`fake`, `dummy`, `disabled`, `console`, `memory`, `local`, …).

**Fix:** throw when the var is unset in production instead of defaulting to a
stub. Genuinely-optional config with a non-stub default (`PORT || 3000`,
`LOG_LEVEL ?? "info"`) is not flagged.

### no-lying-return

**Severity: error.** A function that reports a hardcoded success value
(`sent: true`, `emailSent: true`, `ok: true`, …) while, in the same body,
constructing or calling a transport whose name marks it as stub / unimplemented
/ mock / fake.

> Audit: `dispatch.ts` returns `emailSent: true` over an
> `UnimplementedEmailTransport`.

Catches two syntactic shapes of the same lie: (1) a literal success flag in the
returned object (`return { emailSent: true }`), and (2) the flag set by a bare
assignment to a flag-named identifier later returned via a variable
(`let emailSent = false; …; emailSent = true; return { emailSent }`). A `const`/
`let` **declarator** that derives the flag from the real result
(`const emailSent = await transport.send(…)`) is a different node kind and stays
green.

**Fix:** derive the success flag from the real transport result
(`emailSent: result.accepted.length > 0`).

### no-mock-in-prod-path

**Severity: error.** Mock / hardcoded / placeholder data, or
`setTimeout`/`setInterval` fakes standing in for real async work, on a
**non-test** production code path (pages, components, server).

> Audit: an onboarding wizard that was "100% mock" — `MOCK_` data rendered as
> real plus a `setTimeout` faking the save call.

Flags (1) `const/let/var` whose **name** advertises mock/fake/placeholder data,
and (2) a `new Promise(...)` whose **timer callback fakes a result** — it
resolves with a fabricated value, flips a done/success flag, or calls a setter.
Generic `TODO` comments are intentionally **not** matched, to keep the rule
precise.

> A plain delay/backoff — `new Promise(res => setTimeout(res, ms))` — only
> advances time and is **not** matched. Genuine retry/sleep/jitter helpers are
> legitimate production code; flagging them was a false positive (issue #19).

**Fix:** wire to real data/IO, or move the mock to a test file (test paths are
ignored).

### no-dev-script-in-layout

**Severity: error.** Dev / design tooling scripts injected into the root layout
or production HTML.

> Audit: a Figma MCP design-capture script
> (`https://mcp.figma.com/.../capture.js`) shipped in `app/layout.tsx`.

Flags string/template literals whose value is an unmistakable dev/design-tooling
endpoint: Figma MCP, `*.capture.js`, ngrok tunnels, `webpack-dev-server`,
`browser-sync`, `react-devtools`, loopback host with a port+path, and common dev
overlays. Catches both JSX `<script src="…">` / `<Script src="…" />` and
imperative `el.src = "…"` injection.

**Fix:** remove dev/design tooling from shipped output; keep it in dev-only
tooling.

---

## Caveats

- The unified `tsx` grammar cannot parse legacy angle-bracket type assertions
  (`<Foo>bar`) in `.ts` files. Modern code uses `bar as Foo`; the few files that
  don't will simply be skipped with a parse warning, not crash the lane.
- These rules are high-signal heuristics, not a proof system. They target the
  exact shapes the audit found. New fake-done shapes should be added as new
  rules with their own fixtures, and the ruleset version bumped.
