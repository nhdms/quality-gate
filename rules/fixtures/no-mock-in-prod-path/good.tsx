// CLEAN equivalent: the wizard loads real steps from the server and the save
// handler awaits a real request. No mock data, no fake timers.
import { useEffect, useState } from "react";

interface Step {
  id: number;
  title: string;
}

export function OnboardingWizard() {
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    fetch("/api/onboarding/steps")
      .then((r) => r.json())
      .then(setSteps);
  }, []);

  async function save() {
    const res = await fetch("/api/onboarding/save", { method: "POST" });
    return res.ok;
  }

  return (
    <ol onClick={save}>
      {steps.map((s) => (
        <li key={s.id}>{s.title}</li>
      ))}
    </ol>
  );
}
