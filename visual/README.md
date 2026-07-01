# visual/ — Visual/UI oracle (T2)

The visual oracle closes the gap that motivates the whole gate: **CI is otherwise
blind to UI breakage and design drift.** A page can render blank, overflow on
mobile, or diverge from the design and still go green if the URL merely resolves.
This lane renders the real UI, diffs it against an approved baseline, and emits a
[`visual-verdict`](../cli/visual-verdict.js) score that turns the gate **RED** on
regression.

## How it works

For every `visual.routes` entry, at every `visual.breakpoints` width
(default **375 / 768 / 1280**), the lane:

1. **Captures** a full-page screenshot with Playwright/Chromium and records
   whether the page overflowed its viewport horizontally
   ([`cli/visual-capture.js`](../cli/visual-capture.js)).
2. **Diffs** the capture against the approved baseline in `visual.baselineDir`
   ([`cli/visual-diff.js`](../cli/visual-diff.js) — a zero-dependency PNG pixel
   comparator).
3. **Scores** each screen and renders a pass/fail verdict
   ([`cli/visual-verdict.js`](../cli/visual-verdict.js)), surfaced in the PR check
   output and job summary.

A screen turns the gate **RED** on any of:

| Failure | Why it matters |
| ------- | -------------- |
| Pixel drift above `maxDiffRatio` | The UI changed vs the approved design (a deliberate 1px/colour drift is caught). |
| Horizontal overflow at a breakpoint | Mobile breakage — e.g. a fixed-pixel table wider than a 375px viewport. Caught even before a baseline exists. |
| Dimension mismatch vs baseline | Layout regression (page got taller/wider). |
| **No approved baseline** | Treated as a hard fail — never a silent pass. See below. |
| Capture error / blank page | The page didn't render. |

## Configuration

In your repo's `gate.config.json`:

```json
{
  "stack": "auto",
  "visual": {
    "routes": ["/auth/login", "/dashboard"],
    "breakpoints": [375, 768, 1280],
    "baselineDir": "visual/baseline",
    "baseURL": "http://localhost:3000",
    "minScore": 90,
    "maxDiffRatio": 0,
    "tolerance": 2,
    "blocking": true
  }
}
```

| Key | Default | Meaning |
| --- | ------- | ------- |
| `routes` | — | Routes to capture. **Presence of a non-empty `routes` activates the lane.** |
| `breakpoints` | `[375,768,1280]` | Viewport widths (px). |
| `baselineDir` | `visual/baseline` | Where approved baselines live (committed to the consuming repo). |
| `baseURL` | `http://localhost:3000` | Where the routes are served during capture. An explicit `VISUAL_BASE_URL` env var (set by the `visual_base_url` workflow input) **overrides** this — so a per-PR preview URL wins over a pinned config value. |
| `minScore` | `90` | Minimum visual-verdict score (0-100) per screen. |
| `maxDiffRatio` | `0` | Max proportion of differing pixels (0 = pixel-perfect). Loosen for cross-runner antialiasing noise. |
| `tolerance` | `0` | Per-channel 0-255 colour tolerance before a pixel counts as different. |
| `blocking` | `true` | `true` = failures fail the gate; `false` = advisory-only (score surfaced, never blocks). Start advisory while seeding baselines, flip to blocking as the repo matures. |

> The caller is responsible for making `baseURL` reachable during the run — a
> started dev/preview server or a deployed preview. The harness itself is
> 100% portable; routes + baselines are per-project and live in the consuming
> repo.

## Baseline approval flow (no silent auto-baseline)

**Baselines must represent the _design_, not the last agent output.** If CI
auto-snapshotted whatever the UI currently looks like, it would lock a broken
state in as "correct" — exactly the failure mode this gate exists to prevent.
So a missing baseline is a hard **RED**, and baselines are only ever seeded or
re-approved by an explicit, human-run, reviewable command — **never by CI.**

### Seeding / re-approving baselines

1. Capture the current UI locally (start your app, then):

   ```bash
   node cli/visual-run.js ./gate.config.json .visual/captures .visual/manifest.json
   ```

2. **Review each capture in `.visual/captures/` against the design** (Figma
   export, signed-off mockup, or design-system reference). Do not approve a
   screenshot you haven't visually confirmed matches the intended design.

3. Approve the reviewed captures into `baselineDir`:

   ```bash
   # Dry run first — lists exactly what would be approved, writes nothing:
   node cli/visual-approve.js .visual/captures visual/baseline

   # Approve for real (explicit flag required):
   node cli/visual-approve.js .visual/captures visual/baseline --approve
   ```

4. Commit the baseline PNGs under `visual/baseline/` in a PR. The diff is
   human-reviewable: a reviewer sees exactly which approved images changed and
   signs off. This commit-and-review step IS the approval record.

To **re-approve** after an intentional design change, repeat the flow — the new
baselines land in a reviewable PR alongside the code change that motivated them.

### First adoption

For a repo adopting the oracle, set `"blocking": false` initially so the lane
runs advisory (surfacing scores) while you seed and stabilise baselines, then
flip to `"blocking": true` once the baselines reflect the approved design.
