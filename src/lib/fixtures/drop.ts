import type { ExperimentSpec } from "@/lib/contracts/experiment";

/**
 * Golden fixture: the Galileo drop. Mirrors the renderer's built-in demo so
 * the fallback experience matches the frontend exactly. In vacuum both
 * spheres land together (tie); the counterfactual turns air on, and the
 * heavier sphere (same size/shape) wins because its drag-to-mass ratio is
 * smaller. Server-computed outcomes: base = tie, add-drag = object_a_first.
 */
export const dropFixture: ExperimentSpec = {
  version: "1.0",
  id: "galileo-drop",
  title: "The Galileo Drop",
  gradeBand: "8-10",
  objective: "Test whether mass changes the acceleration of a falling object.",
  sourceSummary:
    "Two spheres begin at the same height with equal size and shape, but different masses.",
  scene: {
    family: "drop",
    gravity: 9.81,
    height: 8,
    airDensity: 0,
    objects: [
      { id: "heavy", mass: 8, radius: 0.48, dragCoefficient: 0.47, color: "#ff8a3d" },
      { id: "light", mass: 1, radius: 0.48, dragCoefficient: 0.47, color: "#5de1ff" },
    ],
  },
  controls: [
    { id: "mass-a", label: "Orange mass", unit: "kg", min: 1, max: 16, step: 1, value: 8, targetPath: "scene.objects.0.mass" },
    { id: "mass-b", label: "Blue mass", unit: "kg", min: 1, max: 16, step: 1, value: 1, targetPath: "scene.objects.1.mass" },
    { id: "height", label: "Drop height", unit: "m", min: 3, max: 14, step: 1, value: 8, targetPath: "scene.height" },
  ],
  measurements: [
    { id: "height-a", label: "Orange height", unit: "m", color: "#ff8a3d" },
    { id: "height-b", label: "Blue height", unit: "m", color: "#5de1ff" },
  ],
  prediction: {
    prompt: "Released at exactly the same moment, which sphere reaches the floor first?",
    reasoningPrompt: "What evidence from the motion supports your answer?",
    choices: [
      { id: "heavy", label: "The 8 kg orange sphere", outcomeKey: "object_a_first" },
      { id: "light", label: "The 1 kg blue sphere", outcomeKey: "object_b_first" },
      { id: "same", label: "They arrive together", outcomeKey: "tie" },
    ],
    correctOutcomeKey: "tie",
  },
  misconception: {
    id: "mass-fall-speed",
    title: "Heavier means faster",
    description:
      "Weight increases gravitational force, but mass increases inertia by the same proportion.",
    explanationRubric: [
      "Names equal acceleration",
      "Separates force from acceleration",
      "Uses observed timing",
    ],
  },
  counterfactuals: [
    {
      id: "add-drag",
      title: "Now let the air interfere",
      prompt: "Air resistance is introduced while size, shape, and mass stay fixed.",
      change: { targetPath: "scene.airDensity", value: 1.2 },
      prediction: {
        prompt: "With air resistance turned on, which sphere reaches the floor first now?",
        reasoningPrompt: "How did the drag-to-mass ratio change the result?",
        choices: [
          { id: "heavy-drag", label: "The heavy orange sphere", outcomeKey: "object_a_first" },
          { id: "light-drag", label: "The light blue sphere", outcomeKey: "object_b_first" },
          { id: "same-drag", label: "They still arrive together", outcomeKey: "tie" },
        ],
        correctOutcomeKey: "object_a_first",
      },
    },
  ],
};
