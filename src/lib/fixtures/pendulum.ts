import type { ExperimentSpec } from "@/lib/contracts/experiment";

/**
 * Golden fixture: the massless clock. Mirrors the renderer's demo, with the
 * base prediction's controlled comparison made declarative via testChange
 * (bob mass 2 kg → 12 kg, i.e. "six times heavier"): the small-angle period
 * 2π·sqrt(L/g) is mass-independent → period_unchanged. The counterfactual
 * lengthens the string 1.8 m → 3.2 m → period_increases.
 */
export const pendulumFixture: ExperimentSpec = {
  version: "1.0",
  id: "pendulum-period",
  title: "The Massless Clock",
  gradeBand: "8-10",
  objective: "Discover which variables control a pendulum's period.",
  sourceSummary:
    "A pendulum swings from a fixed pivot while its energy changes form.",
  scene: {
    family: "pendulum",
    gravity: 9.81,
    length: 1.8,
    releaseAngleDegrees: 35,
    damping: 0.08,
    bob: { id: "bob", mass: 2, radius: 0.42, dragCoefficient: 0.47, color: "#5de1ff" },
  },
  controls: [
    { id: "length", label: "String length", unit: "m", min: 0.6, max: 4, step: 0.1, value: 1.8, targetPath: "scene.length" },
    { id: "mass", label: "Bob mass", unit: "kg", min: 0.5, max: 12, step: 0.5, value: 2, targetPath: "scene.bob.mass" },
    { id: "angle", label: "Release angle", unit: "°", min: 10, max: 60, step: 1, value: 35, targetPath: "scene.releaseAngleDegrees" },
  ],
  measurements: [
    { id: "angle", label: "Angle", unit: "°", color: "#5de1ff" },
    { id: "speed", label: "Speed", unit: "m/s", color: "#ff8a3d" },
  ],
  prediction: {
    prompt: "If the bob becomes six times heavier, what happens to the period?",
    reasoningPrompt: "What controls the timing of one complete swing?",
    choices: [
      { id: "increase", label: "The period increases", outcomeKey: "period_increases" },
      { id: "decrease", label: "The period decreases", outcomeKey: "period_decreases" },
      { id: "unchanged", label: "The period stays the same", outcomeKey: "period_unchanged" },
    ],
    correctOutcomeKey: "period_unchanged",
    testChange: { targetPath: "scene.bob.mass", value: 12 },
  },
  misconception: {
    id: "pendulum-mass",
    title: "A heavier bob swings faster",
    description:
      "Mass scales gravitational force and inertia together, so it cancels from the period.",
    explanationRubric: [
      "Identifies length",
      "Identifies gravity",
      "Explains why mass cancels",
    ],
  },
  counterfactuals: [
    {
      id: "longer-string",
      title: "Change the clock, not the weight",
      prompt: "Lengthen the pendulum from 1.8 m to 3.2 m.",
      change: { targetPath: "scene.length", value: 3.2 },
      prediction: {
        prompt: "With a longer string, what happens to the period?",
        reasoningPrompt: "How does a longer path change the timing?",
        choices: [
          { id: "increase-2", label: "The period increases", outcomeKey: "period_increases" },
          { id: "decrease-2", label: "The period decreases", outcomeKey: "period_decreases" },
          { id: "unchanged-2", label: "The period stays the same", outcomeKey: "period_unchanged" },
        ],
        correctOutcomeKey: "period_increases",
      },
    },
  ],
};
