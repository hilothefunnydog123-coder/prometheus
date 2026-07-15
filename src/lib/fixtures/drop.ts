import type { ExperimentSpec } from "@/lib/ai/contracts/experiment-spec";

/**
 * Golden fixture: classic free-fall drop. Fall time from 20 m at g = 9.81
 * is sqrt(2h/g) ≈ 2.02 s, comfortably inside the 6 s simulation window —
 * including every counterfactual (Moon gravity needs ≈ 4.97 s).
 */
export const dropFixture: ExperimentSpec = {
  id: "fixture-drop-classic",
  family: "drop",
  title: "The Two-Second Tower Drop",
  description:
    "A 1 kg ball is released from rest at the top of a 20 m tower. Watch it fall, then test what actually changes the fall time — and what does not.",
  concepts: ["free-fall", "acceleration"],
  parameters: {
    gravity: 9.81,
    mass: 1,
    height: 20,
  },
  simulation: {
    duration: 6,
    timestep: 1 / 60,
  },
  prediction: {
    question:
      "A 1 kg ball is dropped from a 20 m tower. About how long does it take to reach the ground?",
    outcomes: [
      { id: "one-second", label: "About 1 second" },
      { id: "two-seconds", label: "About 2 seconds" },
      { id: "four-seconds", label: "About 4 seconds" },
    ],
    correctOutcomeId: "two-seconds",
  },
  counterfactuals: [
    {
      id: "ten-times-heavier",
      label: "Make the ball 10 times heavier",
      patch: { parameter: "mass", value: 10 },
    },
    {
      id: "moon-gravity",
      label: "Move the tower to the Moon",
      patch: { parameter: "gravity", value: 1.62 },
    },
    {
      id: "quarter-height",
      label: "Drop from 5 m instead of 20 m",
      patch: { parameter: "height", value: 5 },
    },
  ],
  explanationPrompt:
    "You saw that the 10x heavier ball hit the ground at the same time. Explain why the mass did not change the fall time.",
};
