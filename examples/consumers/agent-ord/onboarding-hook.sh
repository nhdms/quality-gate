#!/usr/bin/env bash
#
# agent-ord onboarding hook — auto-inject the quality-gate (T4, §2).
#
# Reference implementation of the step agent-ord runs at the END of its existing
# "project type detected" onboarding, so every repo the fleet onboards is gated
# by default — no human step. Because `gate init` is idempotent, running this on
# an already-adopted repo is a safe no-op.
#
# Usage (from agent-ord, inside the freshly cloned repo):
#   onboarding-hook.sh <repo-dir> [detected-stack]
#
# If <detected-stack> is omitted, `gate init` auto-detects it from the repo's
# manifests/lockfiles — so agent-ord can pass its own detected type or defer to
# the gate's detection.
set -euo pipefail

REPO_DIR="${1:?usage: onboarding-hook.sh <repo-dir> [stack]}"
STACK="${2:-auto}"

# Resolve the `gate` CLI. In agent-ord this is typically `npx --yes
# github:nhdms/quality-gate gate`; here we allow an explicit GATE_BIN override
# for testing against a local checkout (e.g. `node /path/to/cli/gate.js`).
GATE_CMD=("${GATE_BIN:-npx --yes github:nhdms/quality-gate gate}")
# shellcheck disable=SC2206
GATE_CMD=(${GATE_CMD[@]})

echo "agent-ord: injecting quality-gate into ${REPO_DIR} (stack: ${STACK})"

init_args=(init "${REPO_DIR}")
if [ "${STACK}" != "auto" ]; then
  init_args+=(--stack "${STACK}")
fi
"${GATE_CMD[@]}" "${init_args[@]}"

# Commit the scaffold as part of onboarding, so the gate is present AND running
# on the very first PR. Skip the commit when nothing changed (idempotent re-run).
if command -v git >/dev/null 2>&1 && git -C "${REPO_DIR}" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "${REPO_DIR}" add .github/workflows/quality-gate.yml gate.config.json visual/baseline/.gitkeep 2>/dev/null || true
  if ! git -C "${REPO_DIR}" diff --cached --quiet; then
    git -C "${REPO_DIR}" commit -m "ci: adopt quality-gate (auto-injected by agent-ord)" >/dev/null
    echo "agent-ord: committed quality-gate scaffold"
  else
    echo "agent-ord: quality-gate already present — nothing to commit"
  fi
fi

echo "agent-ord: done. The gate will run on the next PR; done-condition = gate green."
