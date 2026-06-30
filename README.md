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
.github/workflows/_lanes/*.yml    per-stack lanes (ts/go/rust) — stubs for now
.github/workflows/ci.yml          this repo's own CI: unit tests + self-dogfood
gate.schema.json                  JSON Schema for gate.config.json
gate.config.json                  this repo's own gate config
cli/detect-stack.js               stack auto-detect (zero deps)
cli/validate-config.js            config schema validator (zero deps)
cli/*.test.js                     unit tests (node --test)
rules/  visual/                   future: anti-fake-done rules, visual oracle
```

## Develop

```sh
node --test        # run cli unit tests (no dependencies required)
```

## Status

This is the **foundation** (issue #1): scaffold, stable `workflow_call`
interface, config schema, stack detect, lane stubs, and self-dogfood. The real
check logic (T0 coverage, T1 ruleset, T2 visual, T4 wired/CLI) lands in later
issues.
