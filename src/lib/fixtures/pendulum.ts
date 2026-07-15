import type { ExperimentSpec } from "@/lib/ai/contracts/experiment-spec";

/**
 * Golden fixture: simple pendulum. One period is 2π·sqrt(L/g) ≈ 2.84 s at
 * the base settings; the slowest counterfactual (Moon gravity, ≈ 6.98 s)
 * still completes one full period inside the 10 s simulation window.
 */
export const pendulumFixture: ExperimentSpec = {
  id: "fixture-pendulum-period",
  family: "pendulum",
  title: "What Sets a Pendulum's Beat",
  description:
    "A 1 kg bob swings on a 2 m string, released from 15 degrees. Predict what changes the time of one full swing — mass, length, or gravity — then test each one.",
  concepts: ["pendulum-period", "oscillation"],
  parameters: {
    gravity: 9.81,
    mass: 1,
    length: 2,
    releaseAngleDeg: 15,
  },
  simulation: {
    duration: 10,
    timestep: 1 / 60,
  },
  prediction: {
    question:
      "If we double the mass of the pendulum bob, what happens to the time of one full swing?",
    outcomes: [
      { id: "shorter", label: "The swing gets shorter" },
      { id: "same", label: "The swing time stays the same" },
      { id: "longer", label: "The swing gets longer" },
    ],
    correctOutcomeId: "same",
  },
  counterfactuals: [
    {
      id: "double-mass",
      label: "Double the mass of the bob",
      patch: { parameter: "mass", value: 2 },
    },
    {
      id: "quarter-length",
      label: "Shorten the string to 0.5 m",
      patch: { parameter: "length", value: 0.5 },
    },
    {
      id: "moon-gravity",
      label: "Swing it on the Moon",
      patch: { parameter: "gravity", value: 1.62 },
    },
  ],
  explanationPrompt:
    "You saw that doubling the mass left the period unchanged. Explain why the bob's mass does not affect the pendulum's period.",
};
