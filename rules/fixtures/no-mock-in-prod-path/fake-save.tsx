// KNOWN-BAD (branch 2, isolated): a faked async round-trip. No mock-NAMED data
// here — the ONLY defect is the timer callback that fabricates a result instead
// of doing real IO. Two audited shapes:
//   - the timer resolves with a fabricated value, and
//   - the timer flips a "success" flag before resolving.
export function connectAccount() {
  // Resolves with fabricated data — a fake save/connect round-trip.
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, id: 42 }), 1500));
}

export function startScrape() {
  let done = false;
  // Flips a success flag inside the timer, then resolves — a fake round-trip.
  return new Promise((resolve) => {
    setTimeout(() => {
      done = true;
      resolve(done);
    }, 1200);
  });
}
