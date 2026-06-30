// Mock data in a *.test.tsx is legitimate. This file is identical in spirit to
// bad.tsx but lives on a test path, so the rule's `ignores` must skip it. Used
// to prove the rule does not fire on test code.
const MOCK_STEPS = [{ id: 1, title: "Welcome" }];

export async function fakeSave() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return MOCK_STEPS;
}
