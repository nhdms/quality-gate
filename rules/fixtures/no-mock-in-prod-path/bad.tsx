// KNOWN-BAD (from audit): onboarding wizard that is "100% mock" — hardcoded
// MOCK_ data rendered as if real, and a setTimeout fake standing in for the
// save API call. Ships in a production component path.
import { useState } from "react";

const MOCK_STEPS = [
  { id: 1, title: "Welcome" },
  { id: 2, title: "Your profile" },
];

export function OnboardingWizard() {
  const [steps] = useState(MOCK_STEPS);

  async function save() {
    // Fake the network round-trip: resolve with a fabricated "saved" result so
    // the UI "feels" wired. (A plain delay — setTimeout(resolve, 800) — would
    // be legitimate; faking a RESULT is what makes this a mock round-trip.)
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, id: 1 }), 800));
  }

  return (
    <ol onClick={save}>
      {steps.map((s) => (
        <li key={s.id}>{s.title}</li>
      ))}
    </ol>
  );
}
