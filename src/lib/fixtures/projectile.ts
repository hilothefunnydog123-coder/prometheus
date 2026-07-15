import type { ExperimentSpec } from "@/lib/contracts/experiment";

/**
 * Golden fixture: projectile vs target. Mirrors the renderer's demo. At
 * 15 m/s and 45° from 1 m the analytic range is ≈ 23.9 m against an 18 m
 * target (tolerance max(0.8, 5.5%) ≈ 0.99 m) → overshoot; the 22°
 * counterfactual lands ≈ 18.1 m → hit. Server-computed outcomes match.
 */
export const projectileFixture: ExperimentSpec = {
  version: "1.0",
  id: "projectile-arc",
  title: "The Hidden Second Motion",
  gradeBand: "8-10",
  objective: "Separate horizontal motion from vertical acceleration.",
  sourceSummary:
    "A ball launches toward a luminous target while gravity bends its path.",
  scene: {
    family: "projectile",
    gravity: 9.81,
    launch: { speed: 15, angleDegrees: 45, height: 1 },
    object: { id: "projectile", mass: 1, radius: 0.32, dragCoefficient: 0, color: "#ff8a3d" },
    targetDistance: 18,
  },
  controls: [
    { id: "speed", label: "Launch speed", unit: "m/s", min: 8, max: 24, step: 1, value: 15, targetPath: "scene.launch.speed" },
    { id: "angle", label: "Launch angle", unit: "°", min: 15, max: 70, step: 1, value: 45, targetPath: "scene.launch.angleDegrees" },
    { id: "gravity", label: "Gravity", unit: "m/s²", min: 2, max: 15, step: 0.5, value: 9.81, targetPath: "scene.gravity" },
  ],
  measurements: [
    { id: "position", label: "Horizontal position", unit: "m", color: "#ff8a3d" },
    { id: "height", label: "Height", unit: "m", color: "#5de1ff" },
  ],
  prediction: {
    prompt: "At 15 m/s and 45°, where will the ball land relative to the target?",
    reasoningPrompt: "How do the horizontal and vertical motions combine?",
    choices: [
      { id: "short", label: "Before the target", outcomeKey: "undershoot" },
      { id: "hit", label: "Inside the target", outcomeKey: "hit" },
      { id: "long", label: "Past the target", outcomeKey: "overshoot" },
    ],
    correctOutcomeKey: "overshoot",
  },
  misconception: {
    id: "projectile-force",
    title: "A forward force must keep acting",
    description:
      "Once launched, horizontal velocity persists while gravity accelerates vertically.",
    explanationRubric: [
      "Separates velocity components",
      "Names gravity as vertical",
      "Uses the measured arc",
    ],
  },
  counterfactuals: [
    {
      id: "lower-angle",
      title: "Flatten the launch",
      prompt: "Keep launch speed fixed but lower the angle to 22°.",
      change: { targetPath: "scene.launch.angleDegrees", value: 22 },
      prediction: {
        prompt: "With the flatter launch, where will the ball land?",
        reasoningPrompt: "Which velocity component changed most?",
        choices: [
          { id: "short-2", label: "Before the target", outcomeKey: "undershoot" },
          { id: "hit-2", label: "Inside the target", outcomeKey: "hit" },
          { id: "long-2", label: "Past the target", outcomeKey: "overshoot" },
        ],
        correctOutcomeKey: "hit",
      },
    },
  ],
};
