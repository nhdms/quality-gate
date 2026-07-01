# agent-ord integration — the gate as the fleet's reliability layer (T4)

This is the "final mile": making the gate **frictionless to adopt** (`gate init`)
and wiring it into [agent-orchestrator](https://github.com/nhdms/agent-ord) so
**every product the fleet ships is gated by default**. Two hooks turn the gate
into agent-ord's missing reliability layer:

1. **Auto-inject** — onboarding a repo runs `gate init` automatically, so the
   gate is present and running without a human step.
2. **Done-condition = gate** — a worker session is "done" only when the
   **quality-gate passes**, not merely when generic CI is green. The gate result
   is the merge oracle: it catches UI-broken and fake-done output *before* merge.

Everything agent-ord needs ships in this repo: the `gate` CLI (`cli/gate.js`,
exposed as the `gate` bin) with two subcommands — `gate init` and `gate check`.

---

## 1. `gate init` — scaffold the gate into any repo

```bash
npx --yes github:nhdms/quality-gate gate init [dir]   # or: node cli/gate.js init [dir]
```

`gate init` drops three things into the target repo and is **idempotent** — a
re-run never overwrites an edited file or duplicates a directory, so onboarding
the same repo twice is a safe no-op:

| Artifact | Purpose |
| --- | --- |
| `.github/workflows/quality-gate.yml` | The trigger + the 3-line `gate` job calling `gate.yml@v1`. No gate logic is copied. |
| `gate.config.json` | A valid stub **pre-filled from the detected stack** (`ts`/`go`/`rust`, else `auto`). Passes `gate.schema.json` out of the box. |
| `visual/baseline/` | Where approved visual baselines land (kept via `.gitkeep`; baselines are seeded by the documented approval flow, never auto-snapshotted). |

The only manual follow-up is **filling `visual.routes` and seeding baselines** —
optional, and off until you opt in. On a fresh repo the scaffold is GREEN on a
clean PR (`changedLineCoverage` starts advisory at `0`) and RED the moment a
planted violation lands (the anti-fake-done, no-junk, and secret mechanics are
on from line one). See [`ADOPTION.md`](./ADOPTION.md) for the portability notes.

---

## 2. Auto-inject into agent-ord onboarding

agent-ord already has a **"project type detected"** onboarding step. Hook
`gate init` onto the end of it so the gate is injected the moment a repo's stack
is known:

```
onboard(repo):
  stack = detectProjectType(repo)        # agent-ord's existing step
  ...
  runInRepo(repo, "gate init --stack " + stack)   # <-- inject the gate
  commit(repo, "ci: adopt quality-gate (auto-injected by agent-ord)")
```

A concrete, runnable reference implementation of that hook lives in
[`examples/consumers/agent-ord/onboarding-hook.sh`](./examples/consumers/agent-ord/onboarding-hook.sh).
Because `gate init` is idempotent, wiring it into onboarding is safe even for
repos that already adopted the gate manually.

**Result (DoD):** onboarding a new repo yields the gate *present and running*
with no human steps — the workflow, config, and baseline dir are committed as
part of onboarding.

> Runner caveat (unchanged from ADOPTION.md): the gate jobs need a self-hosted
> runner carrying the `quality-gate` label reachable from the consuming repo.
> Same-org repos inherit it; cross-org repos need it shared/registered first.
> `gate init` scaffolds the *workflow*; it cannot conjure a runner.

---

## 3. Done-condition = gate (the merge oracle)

The core change: **a worker session is "done" only when the quality-gate
passes.** "CI green" is not enough — the audit showed CI can be green while the
UI is broken or the work is fake-done (hollow tests, lying returns, mock-in-prod).
The gate is what catches those, so the gate result *is* the done-condition.

Two equivalent signals, depending on where agent-ord evaluates the condition:

### a) Canonical: the CI `gate` check on the PR

Once the PR is open, the source of truth is the `gate` check produced by
`quality-gate.yml`. agent-ord's done-condition requires its conclusion to be
`success`:

```bash
# done  ⇢  the `gate` check on the PR head is green
gh pr checks "$PR" --json name,state \
  | jq -e '[.[] | select(.name=="gate result" or .name=="gate")] | any and all(.state=="SUCCESS")'
```

A worker that produces UI-broken output fails the **visual lane**; one that
produces fake-done output fails the **anti-fake-done ruleset** / **script lint**
— either way the `gate` check is not `success`, so the worker is **NOT marked
done** and the change is **NOT merged**.

### b) Local pre-flight: `gate check`

Before opening (or while iterating on) a PR, a worker can evaluate the same
oracle locally without waiting for CI:

```bash
gate check .            # exit 0 = quality-gate satisfied; exit 1 = NOT done
```

`gate check` runs the fake-done-catching lanes against the working tree
(config validity, package-script lint, anti-fake-done static ruleset) and
**fails closed** — a lane it cannot actually run (e.g. the ruleset without its
tooling) is reported FAILED, never silently skipped, because a merge oracle must
never green-light a result it did not verify. (The visual/UI lane needs a
running server, so it is enforced by the CI `gate` check, not this local
pre-flight.)

**Result (DoD):** an autopilot worker whose output is UI-broken or fake-done
does not satisfy the done-condition — the gate blocks it before merge.

---

## 4. End-to-end: `ao spawn` → implement → gate → merge

```
1. ao spawn <issue>
     └─ agent-ord onboards the repo (if new):
          detect stack → `gate init --stack <stack>` → commit the gate  (§2)

2. worker implements the issue on a feature branch
     └─ optional local pre-flight:  `gate check .`   (fast fail on fake-done)  (§3b)

3. worker opens a PR
     └─ `quality-gate.yml` runs `gate.yml@v1`:
          detect + validate → diff mechanics (no-junk, secrets)
          → stack lane (ts/go/rust) → visual lane (if routes configured)
          → `gate result` aggregates every lane

4. DONE-CONDITION: worker is "done" ⇔ the `gate` check is SUCCESS   (§3a)
     ├─ green  → eligible to merge  ✅
     └─ red    → NOT done: UI-broken or fake-done caught → back to step 2  ❌

5. merge — only gate-green changes land. The gate is the merge oracle.
```

This is where "apply the gate to other projects" becomes **automatic**: every
repo the fleet touches is gated by default, and nothing merges until the gate —
not merely CI — is green.
