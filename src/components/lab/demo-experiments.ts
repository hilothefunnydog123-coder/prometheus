import type { ExperimentSpec } from "@/lib/contracts/experiment";

export const dropDemo: ExperimentSpec = {
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
    description: "Weight increases gravitational force, but mass increases inertia by the same proportion.",
    explanationRubric: ["Names equal acceleration", "Separates force from acceleration", "Uses observed timing"],
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
        testChange: { targetPath: "scene.airDensity", value: 1.2 },
        choices: [
          { id: "heavy-drag", label: "The compact orange sphere", outcomeKey: "object_a_first" },
          { id: "light-drag", label: "The wide blue sphere", outcomeKey: "object_b_first" },
          { id: "same-drag", label: "They still arrive together", outcomeKey: "tie" },
        ],
        correctOutcomeKey: "object_a_first",
      },
    },
  ],
};

export const projectileDemo: ExperimentSpec = {
  version: "1.0",
  id: "projectile-arc",
  title: "The Hidden Second Motion",
  gradeBand: "8-10",
  objective: "Separate horizontal motion from vertical acceleration.",
  sourceSummary: "A ball launches toward a luminous target while gravity bends its path.",
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
    { id: "gravity", label: "Gravity", unit: "m/s²", min: 2, max: 15, step: 0.01, value: 9.81, targetPath: "scene.gravity" },
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
    description: "Once launched, horizontal velocity persists while gravity accelerates vertically.",
    explanationRubric: ["Separates velocity components", "Names gravity as vertical", "Uses the measured arc"],
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
        testChange: { targetPath: "scene.launch.angleDegrees", value: 22 },
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

export const pendulumDemo: ExperimentSpec = {
  version: "1.0",
  id: "pendulum-period",
  title: "The Massless Clock",
  gradeBand: "8-10",
  objective: "Discover which variables control a pendulum’s period.",
  sourceSummary: "A pendulum swings from a fixed pivot while its energy changes form.",
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
    testChange: { targetPath: "scene.bob.mass", value: 12 },
    choices: [
      { id: "increase", label: "The period increases", outcomeKey: "period_increases" },
      { id: "decrease", label: "The period decreases", outcomeKey: "period_decreases" },
      { id: "unchanged", label: "The period stays the same", outcomeKey: "period_unchanged" },
    ],
    correctOutcomeKey: "period_unchanged",
  },
  misconception: {
    id: "pendulum-mass",
    title: "A heavier bob swings faster",
    description: "Mass scales gravitational force and inertia together, so it cancels from the period.",
    explanationRubric: ["Identifies length", "Identifies gravity", "Explains why mass cancels"],
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
        testChange: { targetPath: "scene.length", value: 3.2 },
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

export const demoExperiments = [dropDemo, projectileDemo, pendulumDemo];

export function demoForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (/pendulum|swing|period|string/.test(normalized)) return pendulumDemo;
  if (/projectile|launch|throw|arc|cannon|ball/.test(normalized)) return projectileDemo;
  return dropDemo;
}
