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
    // Fake the network round-trip so the UI "feels" wired.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return true;
  }

  return (
    <ol onClick={save}>
      {steps.map((s) => (
        <li key={s.id}>{s.title}</li>
      ))}
    </ol>
  );
}
