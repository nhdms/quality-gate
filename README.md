# quality-gate

Portable quality gate: hardened CI mechanics + anti-fake-done rules + visual/UI
oracle + wired-not-mock smoke. Reusable across projects via GitHub reusable
workflows; auto-injected by agent-orchestrator.

## Use it in your repo

Add a `gate.config.json` to your repo root (see the schema in
[`gate.schema.json`](./gate.schema.json)):

```json
{ "stack": "auto", "thresholds": { "changedLineCoverage": 80, "minTests": 1 } }
```

Then call the gate from any workflow (the 3-line consumer snippet):

```yaml
jobs:
  gate:
    uses: nhdms/quality-gate/.github/workflows/gate.yml@main
    with:
      config: ./gate.config.json   # optional — this is the default
```

That's it. The gate validates your config, auto-detects your stack
(`ts | go | rust`), and runs the matching lane.

## What the gate enforces (T0 mechanics)

These are the hardened CI mechanics — the layer that stops a structurally hollow
gate from going green. Stack-agnostic checks run on the PR diff for every stack;
the rest run in the per-stack lane.

| Check | What fails the gate | Config knob |
| ----- | ------------------- | ----------- |
| **No silent-zero-tests** | Fewer than `minTests` tests actually executed; banned `--passWithNoTests` flag found in package scripts | `thresholds.minTests` |
| **Frozen lockfile** | Lockfile drift, or deps declared with no committed lockfile | `frozenLockfile` |
| **Changed-line coverage** | Coverage on *changed* lines below threshold (not global %) | `thresholds.changedLineCoverage`, `coverage.exclude` |
| **Secret scan** | Any secret (AWS key, GitHub PAT, private key, …) in an added diff line | `secrets.allow` |
| **No-junk-diff** | Adding `.omc/`, build bundles, `node_modules/`, or an oversized binary | `noJunk.bannedPaths`, `noJunk.maxBinaryBytes`, `noJunk.allow` |
| **Retry-as-failure** | e2e retries exceed tolerance; every retry is surfaced as a ⚠️ annotation | `e2e.report`, `thresholds.maxRetries` |

Example config exercising the knobs:

```json
{
  "stack": "auto",
  "thresholds": { "changedLineCoverage": 80, "minTests": 1, "maxRetries": 0 },
  "frozenLockfile": true,
  "noJunk": { "allow": ["docs/fixtures/"], "maxBinaryBytes": 1048576 },
  "secrets": { "allow": ["test/fixtures/"] }
}
```

Every check ships with a fixture proving it goes **RED** on the bad case and
**GREEN** on the clean case (`cli/*.test.js`), including regressions against the
exact audited snippets (`vitest run --passWithNoTests`,
`pnpm install --no-frozen-lockfile`).

> Pin to `@main` for now. Once the interface is proven (#adoption) it gets a
> `@v1` tag — pin that for stability.

## Inputs

| Input    | Default               | Description                                          |
| -------- | --------------------- | ---------------------------------------------------- |
| `config` | `./gate.config.json`  | Path to your gate config.                            |
| `stack`  | `auto`                | Force a stack (`ts`/`go`/`rust`) or `auto`-detect.   |

## Outputs

| Output  | Description                                       |
| ------- | ------------------------------------------------ |
| `stack` | The stack the gate ran against (detected/forced).|

## How stack detection works

`stack: auto` inspects the repo root, in precedence order:

| Stack | Detected from                                                  |
| ----- | -------------------------------------------------------------- |
| rust  | `Cargo.toml` / `Cargo.lock`                                    |
| go    | `go.mod` / `go.sum`                                            |
| ts    | `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `package.json` |

Primary-language manifests (Go/Rust) win over `package.json`, so a Go service
with auxiliary JS tooling is still detected as `go`. Set `stack` explicitly to
override.

## Layout

```
.github/workflows/gate.yml        reusable workflow (workflow_call) — the stable entrypoint
.github/workflows/_lane-*.yml     per-stack lanes (ts/go/rust) — stubs for now
.github/workflows/ci.yml          this repo's own CI: unit tests + self-dogfood
gate.schema.json                  JSON Schema for gate.config.json
gate.config.json                  this repo's own gate config
cli/detect-stack.js               stack auto-detect (zero deps)
cli/validate-config.js            config schema validator (zero deps)
cli/check-no-junk.js              no-junk-diff check (banned paths / big binaries)
cli/check-secrets.js              portable secret scanner over added diff lines
cli/check-min-tests.js            test-count parser + minTests gate (TAP/jest/vitest/go/rust)
cli/lint-test-cmd.js              bans --passWithNoTests / --no-frozen-lockfile in scripts
cli/check-frozen-lockfile.js      frozen/immutable install selection + drift
cli/check-changed-coverage.js     lcov ∩ diff → changed-line coverage gate
cli/check-retries.js              e2e retry surfacing (retry-as-failure)
cli/config-get.js                 jq-free config reader for the lanes
cli/lib/match.js                  shared path/glob matcher
cli/*.test.js                     unit tests + fixtures (node --test)
rules/  visual/                   future: anti-fake-done rules, visual oracle
```

## Develop

```sh
node --test        # run cli unit tests (no dependencies required)
```

## Status

- **#1 Foundation** — scaffold, stable `workflow_call` interface, config schema,
  stack detect, lane stubs, self-dogfood. ✅
- **#2 T0 mechanics** — the hardened CI mechanics above (no silent-zero-tests,
  frozen lockfile, changed-line coverage, secret scan, no-junk-diff,
  retry-as-failure). ✅
- T1 anti-fake-done ruleset, T2 visual oracle, T3 wired-not-mock smoke land in
  later issues.
