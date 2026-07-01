# Adopting the shared gate (portability notes)

This gate is a **shared asset**, not a per-repo workflow. Two repos on different
stacks consume the exact same `gate.yml@v1` — proving the interface is portable,
not fillr-specific:

| Repo               | Org         | Stack            | Package manager | Detected as |
| ------------------ | ----------- | ---------------- | --------------- | ----------- |
| `akatsuki-io/fillr`| akatsuki-io | Next.js / TS     | pnpm            | `ts`        |
| `nhdms/agent-ord`  | nhdms       | TS workspace monorepo | pnpm       | `ts`        |

The consumer integration is identical for both — a trigger plus the 3-line
`gate` job (see [`examples/consumers/`](./examples/consumers/)):

```yaml
jobs:
  gate:
    uses: nhdms/quality-gate/.github/workflows/gate.yml@v1
    with:
      config: ./gate.config.json
```

Everything stack-specific lives in each repo's `gate.config.json` (validated by
[`gate.schema.json`](./gate.schema.json)) — **never** in a forked workflow. That
is the whole point of pinning `@v1`: the interface is frozen, so per-project
differences are pushed into config, not copied YAML.

## Why `@v1` (and what it pins)

Consumers pin `gate.yml@v1`. Because the reusable workflow resolves its own
sub-lanes (`./.github/workflows/_lane-*.yml`) and re-fetches the gate tooling
(`cli/`, `rules/`) at the **same** ref it was called with, every internal
tooling checkout is pinned to `ref: v1` too. A consumer therefore gets one
frozen, self-consistent bundle — the workflow and the CLI it runs can never
drift apart mid-release. `@main` still exists for gate development; consumers
should never pin it.

## Per-stack config differences discovered

Adopting the same gate across two repos surfaced concrete, real differences.
These are the portability lessons — captured here so the next repo skips them.

### 1. Self-hosted runner access is the true portability boundary

`gate.yml` and every lane run on `runs-on: [self-hosted, quality-gate]` (this
program does not use GitHub-hosted minutes). The reusable workflow is portable;
**the runner is not automatically**:

- **`nhdms/agent-ord`** is in the same org as `nhdms/quality-gate`, so the
  `quality-gate`-labelled self-hosted runner can be shared to it at the org
  level. Its existing CI already runs on `[self-hosted, Linux]`, so the host is
  present — only the runner **label/registration** has to be extended to the
  repo.
- **`akatsuki-io/fillr`** is a **different org**. Its current CI runs on
  GitHub-hosted runners inside a `container:` with a Postgres service — it has
  **no** `quality-gate` runner. Until that runner is registered/shared to
  akatsuki-io (or the org registers its own runner with the same label), the
  gate jobs will queue and never start. This is why the fillr change ships as a
  **draft PR for the user to land** once runner access is arranged — exactly the
  cross-org caveat called out in the issue.

**Takeaway:** the 3-line snippet is portable; a runner carrying the
`quality-gate` label must exist for the consuming repo. Config cannot substitute
for runner availability.

### 2. `--passWithNoTests` in the caller's `test` script (fillr)

fillr's `package.json` had:

```json
"test": "vitest run --passWithNoTests"
```

The gate's anti-fake-done lint (`cli/lint-test-cmd.js`, T0) scans **every**
package script and fails on `--passWithNoTests` — it "lets the test job pass
with zero tests executed", one of the exact audited hollow-gate snippets. So the
shared gate goes **RED** on fillr until that flag is removed:

```json
"test": "vitest run"
```

This is portability working as intended: the gate caught a fake-done pattern in
a repo it had never seen. It also doubles as fillr's built-in "junk PR goes red"
proof (see below). agent-ord's root `test`
(`pnpm -r --filter '!@aoagents/ao-web' test`) has no banned flag, so it needs no
change.

### 3. Changed-line coverage in a workspace monorepo

The `ts` lane enforces changed-line coverage from a root `coverage/lcov.info`.
Single-package repos emit that directly; **workspace monorepos** (both agent-ord
and fillr use pnpm workspaces) emit per-package lcov and must **merge** them to
the repo root for the gate to see them. Until a repo wires that aggregation, set
`thresholds.changedLineCoverage: 0` — the lane then emits a warning and does not
block (it never silently claims coverage it did not measure). Raise the
threshold once lcov is aggregated to the root. Both example configs ship with
`0` for this reason and annotate it as the follow-up.

### 4. Secret-scan / no-junk allowlists start empty

Neither consumer needs `secrets.allow` or `noJunk.allow` entries at adoption
(those exist for repos that commit fixture secrets or vendored bundles, like
this repo's own `cli/fixtures/`). Start empty; add narrowly-scoped allow globs
only when a legitimate path trips a check.

## Proving portability (the DoD, per repo)

- **Clean PR → green:** a normal PR in each repo passes the shared gate (once the
  runner is available and the fillr `test` script is de-flagged).
- **Junk / 0-test PR → red, in *either* repo:** the gate is not fillr-specific.
  - In **fillr**, restoring `--passWithNoTests` (or a 0-test change while the
    flag is present) fails the T0 anti-fake-done lint.
  - In **agent-ord**, a PR that adds a banned path (`node_modules/`, a build
    bundle) or an unsecured secret in an added line fails the stack-agnostic
    diff mechanics — no stack-specific setup required.

## Adopting in a new repo (checklist)

1. Ensure a self-hosted runner carrying the `quality-gate` label is available to
   the repo (org-shared or repo-registered).
2. Add `gate.config.json` at the repo root (copy the closest
   [`examples/consumers/`](./examples/consumers/) config).
3. Add `.github/workflows/quality-gate.yml` with the 3-line `gate` job pinned at
   `@v1`.
4. Remove any `--passWithNoTests` / `--no-frozen-lockfile` from package scripts.
5. If it is a workspace monorepo, aggregate per-package `lcov.info` to
   `coverage/lcov.info` before raising `thresholds.changedLineCoverage` above 0.
6. Open a PR and confirm the `gate` check runs and is green.
