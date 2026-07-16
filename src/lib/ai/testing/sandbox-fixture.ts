import type { ExperimentSpec } from "@/lib/contracts/experiment";

/**
 * A known-good generic sandbox experiment used across tests. Two equal-size
 * balls of different mass fall toward a floor: in a vacuum they tie, and with
 * dense air the heavier one lands first. The outcome is computed by the shared
 * engine from the compare_bodies rule, never asserted by this data.
 */
export function sandboxDropSpec(): ExperimentSpec {
  return {
    version: "1.0",
    id: "sandbox-free-fall",
    title: "Do heavier balls fall faster?",
    gradeBand: "8-10",
    objective: "Test whether a heavier ball reaches the floor before a lighter ball.",
    sourceSummary:
      "Two balls of equal size but different mass are released together above a floor.",
    scene: {
      family: "sandbox",
      gravity: 9.81,
      airDensity: 0,
      restitution: 0.3,
      hasFloor: true,
      centralGravity: 0,
      collisions: false,
      duration: 3,
      bodies: [
        {
          id: "heavy",
          label: "Heavy ball",
          mass: 8,
          radius: 0.5,
          dragCoefficient: 0.47,
          fixed: false,
          color: "#ff8a3d",
          position: { x: -2, y: 12 },
          velocity: { x: 0, y: 0 },
        },
        {
          id: "light",
          label: "Light ball",
          mass: 1,
          radius: 0.5,
          dragCoefficient: 0.47,
          fixed: false,
          color: "#5de1ff",
          position: { x: 2, y: 12 },
          velocity: { x: 0, y: 0 },
        },
      ],
      springs: [],
      outcomeRule: {
        kind: "compare_bodies",
        metric: "time_to_floor",
        bodyA: "heavy",
        bodyB: "light",
        comparator: "less",
        tolerance: 0.05,
      },
    },
    controls: [
      {
        id: "air",
        label: "Air density",
        unit: "kg/m³",
        min: 0,
        max: 2,
        step: 0.1,
        value: 0,
        targetPath: "scene.airDensity",
      },
    ],
    measurements: [
      { id: "heavy-height", label: "Heavy ball height", unit: "m", color: "#ff8a3d" },
      { id: "light-height", label: "Light ball height", unit: "m", color: "#5de1ff" },
    ],
    prediction: {
      prompt: "Released together in a vacuum, which heavier ball reaches the floor first?",
      reasoningPrompt: "What does the fall timing tell you about mass and acceleration?",
      choices: [
        { id: "heavy-first", label: "The heavier ball lands first", outcomeKey: "a" },
        { id: "light-first", label: "The lighter ball lands first", outcomeKey: "b" },
        { id: "together", label: "They land together", outcomeKey: "tie" },
      ],
      correctOutcomeKey: "a",
    },
    misconception: {
      id: "heavier-falls-faster",
      title: "Heavier objects fall faster",
      description:
        "In a vacuum, gravity gives every mass the same acceleration, so timing does not depend on how heavy a ball is.",
      explanationRubric: ["Names equal acceleration", "Separates weight from acceleration"],
    },
    counterfactuals: [
      {
        id: "add-air",
        title: "Now add thick air",
        prompt: "Fill the room with dense air while size and shape stay fixed.",
        change: { targetPath: "scene.airDensity", value: 1.5 },
        prediction: {
          prompt: "With thick air, which heavier ball reaches the floor first?",
          reasoningPrompt: "How does drag per unit mass differ between the balls?",
          choices: [
            { id: "heavy-first-2", label: "The heavier ball lands first", outcomeKey: "a" },
            { id: "light-first-2", label: "The lighter ball lands first", outcomeKey: "b" },
            { id: "together-2", label: "They land together", outcomeKey: "tie" },
          ],
          correctOutcomeKey: "a",
        },
      },
    ],
  };
}
