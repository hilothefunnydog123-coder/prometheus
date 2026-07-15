import type { ExperimentSpec } from "@/lib/ai/contracts/experiment-spec";

/**
 * Golden fixture: projectile launched at 45°. Flight time is
 * 2·v·sin(θ)/g ≈ 2.88 s at the base settings; every counterfactual stays
 * under the 8 s simulation window.
 */
export const projectileFixture: ExperimentSpec = {
  id: "fixture-projectile-45",
  family: "projectile",
  title: "The Best Launch Angle",
  description:
    "A 0.5 kg ball is launched at 20 m/s at a 45 degree angle. Predict how changing the angle or speed moves the landing spot, then test it.",
  concepts: ["projectile-motion", "launch-angle"],
  parameters: {
    gravity: 9.81,
    mass: 0.5,
    initialSpeed: 20,
    angleDeg: 45,
  },
  simulation: {
    duration: 8,
    timestep: 1 / 60,
  },
  prediction: {
    question:
      "We launch at 45 degrees. If we lower the angle to 30 degrees at the same speed, where does the ball land?",
    outcomes: [
      { id: "closer", label: "Closer to the launcher" },
      { id: "same-spot", label: "At the same distance" },
      { id: "farther", label: "Farther from the launcher" },
    ],
    correctOutcomeId: "closer",
  },
  counterfactuals: [
    {
      id: "angle-30",
      label: "Lower the launch angle to 30 degrees",
      patch: { parameter: "angleDeg", value: 30 },
    },
    {
      id: "angle-60",
      label: "Raise the launch angle to 60 degrees",
      patch: { parameter: "angleDeg", value: 60 },
    },
    {
      id: "half-speed",
      label: "Halve the launch speed to 10 m/s",
      patch: { parameter: "initialSpeed", value: 10 },
    },
  ],
  explanationPrompt:
    "Explain why 45 degrees gives the longest range when the launch and landing heights are the same.",
};
