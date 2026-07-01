// CLEAN (regression for issue #19): genuine retry/backoff delay helpers. These
// wrap setTimeout in a Promise but only ADVANCE TIME — the callback fabricates
// nothing. This is the exact shape that produced the false positive against
// fillr@dev (server/integrations/scheduling/base-adapter.ts). Must stay GREEN.
const RETRY_POLICY = { baseDelayMs: 100, maxDelayMs: 30000, jitterMs: 250 };

// Exponential backoff sleep — the literal false-positive shape from the audit.
function delay(attempt: number): Promise<void> {
  const base = Math.min(RETRY_POLICY.baseDelayMs * Math.pow(2, attempt), RETRY_POLICY.maxDelayMs);
  const jitter = Math.random() * RETRY_POLICY.jitterMs;
  return new Promise((res) => setTimeout(res, base + jitter));
}

// Plain sleep helpers — bare resolve, or a zero-arg wrapper. No fabricated result.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export { delay, sleep, pause };
