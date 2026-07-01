# Releasing the gate (maintainers)

Consumers pin the reusable workflow at a **moving major tag**:

```yaml
uses: nhdms/quality-gate/.github/workflows/gate.yml@v1
```

When a caller resolves `gate.yml@v1`, GitHub loads the workflow **and every
local sub-lane it references** (`./.github/workflows/_lane-*.yml`) at the commit
the `v1` tag points to. The internal tooling checkouts (`cli/`, `rules/`) are
also pinned to `ref: v1`, so the whole bundle — workflow + lanes + CLI — is
whatever `v1` currently points at.

## The rule: `v1` MUST advance on every interface change

Because `v1` is what consumers actually load, **the tag has to move to each new
release commit on `main`**. If it doesn't, `@v1` silently rots: consumers keep
loading an old commit while `main` moves ahead, and none of the newer fixes,
lanes, or the `ref: v1` self-pinning reach them.

> ⚠️ A tag left behind is worse than no tag — it looks pinned and stable while
> serving stale, self-inconsistent code (e.g. a `v1` commit whose `gate.yml`
> still says `ref: main`, so the "one frozen bundle" guarantee is a lie).

After merging any PR that changes the gate's behavior or the `workflow_call`
interface (inputs/outputs, lanes, CLI, rules), move `v1` to the merge commit:

```sh
git checkout main && git pull --ff-only
git tag -f -a v1 -m "quality-gate v1 — <what changed>"   # re-point the moving major tag
git push -f origin v1
```

Verify it landed on the intended commit (and that the tagged tree is
self-consistent — its `gate.yml` should say `ref: v1`, not `ref: main`):

```sh
git ls-remote --tags origin v1                 # -> new merge SHA
git show v1:.github/workflows/gate.yml | grep 'ref:'   # -> ref: v1
```

### Optional: immutable point releases

For consumers that want a truly frozen pin, also cut an immutable `vMAJOR.MINOR`
tag that never moves (e.g. `v1.3`), and let `v1` float to the newest of them:

```sh
git tag -a v1.3 -m "quality-gate v1.3"
git push origin v1.3
git tag -f -a v1 v1.3 && git push -f origin v1   # v1 tracks the latest v1.x
```

## Breaking changes

Only cut `v2` when the `workflow_call` **interface** breaks in a way a pinned
`@v1` consumer cannot absorb (a removed/renamed input, a changed output
contract). Everything else — new checks, new lanes, stricter defaults behind
config — ships under `v1`, because per-project differences belong in
`gate.config.json`, never in a forked workflow.

## Current state (adoption / #3)

At the time the portability adoption (#3) landed, `v1` still pointed at the
pre-#3 T2 merge (`2c6315b`), whose `gate.yml` uses `ref: main`. **Right after #3
merges, re-point `v1` to the #3 merge commit** using the commands above — that
is the first application of this rule, and it makes the `@v1 = one frozen,
self-consistent bundle` guarantee in [`ADOPTION.md`](./ADOPTION.md) actually
true.
