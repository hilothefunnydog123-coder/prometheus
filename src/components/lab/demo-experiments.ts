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

export const springDemo: ExperimentSpec = {
  version: "1.0",
  id: "spring-resonance",
  title: "The Resonance Engine",
  gradeBand: "8-10",
  objective: "Discover how mass, stiffness, and damping shape harmonic motion.",
  sourceSummary:
    "A precision mass oscillates on a horizontal spring while displacement, velocity, and energy are tracked.",
  scene: {
    family: "spring",
    springConstant: 28,
    damping: 0.5,
    amplitude: 1.8,
    restLength: 3,
    body: {
      id: "oscillator",
      mass: 2,
      radius: 0.55,
      dragCoefficient: 0,
      color: "#b66dff",
    },
  },
  controls: [
    { id: "spring-k", label: "Spring stiffness", unit: "N/m", min: 4, max: 100, step: 1, value: 28, targetPath: "scene.springConstant" },
    { id: "spring-mass", label: "Oscillating mass", unit: "kg", min: 0.5, max: 12, step: 0.5, value: 2, targetPath: "scene.body.mass" },
    { id: "spring-damping", label: "Damping", unit: "N·s/m", min: 0, max: 8, step: 0.1, value: 0.5, targetPath: "scene.damping" },
    { id: "spring-amplitude", label: "Release distance", unit: "m", min: 0.2, max: 3, step: 0.1, value: 1.8, targetPath: "scene.amplitude" },
  ],
  measurements: [
    { id: "displacement", label: "Displacement", unit: "m", color: "#b66dff" },
    { id: "velocity", label: "Velocity", unit: "m/s", color: "#5de1ff" },
  ],
  prediction: {
    prompt: "If the moving mass becomes four times larger, what happens to the oscillation period?",
    reasoningPrompt: "How do inertia and the restoring force set the timing?",
    testChange: { targetPath: "scene.body.mass", value: 8 },
    choices: [
      { id: "spring-longer", label: "The period increases", outcomeKey: "period_increases" },
      { id: "spring-shorter", label: "The period decreases", outcomeKey: "period_decreases" },
      { id: "spring-same", label: "The period stays the same", outcomeKey: "period_unchanged" },
    ],
    correctOutcomeKey: "period_increases",
  },
  misconception: {
    id: "spring-mass-speed",
    title: "More mass makes the spring move faster",
    description:
      "A larger mass has more inertia, lowering the natural frequency unless spring stiffness also increases.",
    explanationRubric: ["Connects mass to inertia", "Names the restoring force", "Uses period or frequency evidence"],
  },
  counterfactuals: [
    {
      id: "stiffen-spring",
      title: "Charge the resonance engine",
      prompt: "Double the spring stiffness while every other property stays fixed.",
      change: { targetPath: "scene.springConstant", value: 56 },
      prediction: {
        prompt: "With the stiffer spring, what happens to the oscillation period?",
        reasoningPrompt: "How does a stronger restoring force change the cycle time?",
        testChange: { targetPath: "scene.springConstant", value: 56 },
        choices: [
          { id: "spring-longer-2", label: "The period increases", outcomeKey: "period_increases" },
          { id: "spring-shorter-2", label: "The period decreases", outcomeKey: "period_decreases" },
          { id: "spring-same-2", label: "The period stays the same", outcomeKey: "period_unchanged" },
        ],
        correctOutcomeKey: "period_decreases",
      },
    },
  ],
};

export const collisionDemo: ExperimentSpec = {
  version: "1.0",
  id: "momentum-collision",
  title: "The Momentum Exchange",
  gradeBand: "8-10",
  objective: "Track how mass and elasticity redistribute velocity in a collision.",
  sourceSummary:
    "Two instrumented bodies collide on a low-friction magnetic rail while momentum is conserved.",
  scene: {
    family: "collision",
    trackLength: 14,
    restitution: 1,
    objects: [
      { id: "pulse-a", mass: 1, radius: 0.62, dragCoefficient: 0, color: "#ff8a3d", initialVelocity: 6 },
      { id: "pulse-b", mass: 3, radius: 0.74, dragCoefficient: 0, color: "#5de1ff", initialVelocity: -1 },
    ],
  },
  controls: [
    { id: "collision-mass-a", label: "Orange mass", unit: "kg", min: 0.5, max: 10, step: 0.5, value: 1, targetPath: "scene.objects.0.mass" },
    { id: "collision-mass-b", label: "Blue mass", unit: "kg", min: 0.5, max: 10, step: 0.5, value: 3, targetPath: "scene.objects.1.mass" },
    { id: "collision-speed-a", label: "Orange velocity", unit: "m/s", min: 1, max: 12, step: 0.5, value: 6, targetPath: "scene.objects.0.initialVelocity" },
    { id: "collision-elasticity", label: "Elasticity", unit: "", min: 0, max: 1, step: 0.05, value: 1, targetPath: "scene.restitution" },
  ],
  measurements: [
    { id: "velocity-a", label: "Orange position", unit: "m", color: "#ff8a3d" },
    { id: "velocity-b", label: "Blue position", unit: "m", color: "#5de1ff" },
  ],
  prediction: {
    prompt: "Immediately after the elastic collision, which body has the greater speed?",
    reasoningPrompt: "Use momentum and relative speed to explain the exchange.",
    choices: [
      { id: "collision-a", label: "The lighter orange body", outcomeKey: "object_a_faster" },
      { id: "collision-b", label: "The heavier blue body", outcomeKey: "object_b_faster" },
      { id: "collision-same", label: "They leave with equal speed", outcomeKey: "same_speed" },
    ],
    correctOutcomeKey: "object_a_faster",
  },
  misconception: {
    id: "collision-bigger-faster",
    title: "The larger object always wins",
    description:
      "Collision outcomes depend on both momentum and elasticity; a light object can rebound with the greater speed.",
    explanationRubric: ["Uses momentum conservation", "Distinguishes speed from momentum", "Mentions elasticity or rebound"],
  },
  counterfactuals: [
    {
      id: "equalize-masses",
      title: "Make the masses equal",
      prompt: "Increase the orange body to 3 kg without changing either incoming velocity.",
      change: { targetPath: "scene.objects.0.mass", value: 3 },
      prediction: {
        prompt: "With equal masses, which body leaves with the greater speed?",
        reasoningPrompt: "What does an elastic collision do to the two velocities?",
        choices: [
          { id: "collision-a-2", label: "The orange body", outcomeKey: "object_a_faster" },
          { id: "collision-b-2", label: "The blue body", outcomeKey: "object_b_faster" },
          { id: "collision-same-2", label: "They leave with equal speed", outcomeKey: "same_speed" },
        ],
        correctOutcomeKey: "object_b_faster",
      },
    },
  ],
};

export const orbitDemo: ExperimentSpec = {
  version: "1.0",
  id: "orbital-window",
  title: "The Orbital Window",
  gradeBand: "11-12",
  objective: "Connect tangential speed, gravity, and orbital energy.",
  sourceSummary:
    "A satellite begins tangentially above a luminous planet to test what speed keeps it in orbit along a numerically integrated two-body trajectory.",
  scene: {
    family: "orbit",
    gravitationalParameter: 20,
    centralRadius: 1.2,
    orbitalRadius: 5,
    initialSpeed: 2,
    satellite: {
      id: "satellite",
      mass: 0.8,
      radius: 0.28,
      dragCoefficient: 0,
      color: "#7fffb0",
    },
  },
  controls: [
    { id: "orbit-gravity", label: "Gravity strength", unit: "m³/s²", min: 4, max: 60, step: 1, value: 20, targetPath: "scene.gravitationalParameter" },
    { id: "orbit-radius", label: "Starting radius", unit: "m", min: 3, max: 10, step: 0.25, value: 5, targetPath: "scene.orbitalRadius" },
    { id: "orbit-speed", label: "Tangential speed", unit: "m/s", min: 0.5, max: 5, step: 0.1, value: 2, targetPath: "scene.initialSpeed" },
  ],
  measurements: [
    { id: "orbit-x", label: "Orbital x position", unit: "m", color: "#7fffb0" },
    { id: "orbit-y", label: "Orbital y position", unit: "m", color: "#5de1ff" },
  ],
  prediction: {
    prompt: "At exactly circular-orbit speed, what path will the satellite follow?",
    reasoningPrompt: "How does sideways motion continuously miss the planet?",
    choices: [
      { id: "orbit-stable", label: "A stable bound orbit", outcomeKey: "stable_orbit" },
      { id: "orbit-escape", label: "An escape trajectory", outcomeKey: "escape" },
      { id: "orbit-impact", label: "A collision with the planet", outcomeKey: "impact" },
    ],
    correctOutcomeKey: "stable_orbit",
  },
  misconception: {
    id: "orbit-no-gravity",
    title: "Orbit means gravity has stopped",
    description:
      "An orbit is continuous free fall: gravity constantly bends tangential motion toward the central body.",
    explanationRubric: ["Identifies continuous free fall", "Connects tangential speed to curvature", "Uses energy or trajectory evidence"],
  },
  counterfactuals: [
    {
      id: "escape-burn",
      title: "Execute an escape burn",
      prompt: "Increase tangential speed from 2.0 m/s to 3.0 m/s at the same radius.",
      change: { targetPath: "scene.initialSpeed", value: 3 },
      prediction: {
        prompt: "After the speed increase, which trajectory follows?",
        reasoningPrompt: "Compare the new kinetic energy with the escape threshold.",
        choices: [
          { id: "orbit-stable-2", label: "A stable bound orbit", outcomeKey: "stable_orbit" },
          { id: "orbit-escape-2", label: "An escape trajectory", outcomeKey: "escape" },
          { id: "orbit-impact-2", label: "A collision with the planet", outcomeKey: "impact" },
        ],
        correctOutcomeKey: "escape",
      },
    },
  ],
};

export const demoExperiments = [
  dropDemo,
  projectileDemo,
  pendulumDemo,
  springDemo,
  collisionDemo,
  orbitDemo,
];

export function demoForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (/spring|resonance|oscillator|hooke/.test(normalized)) return springDemo;
  if (/collision|momentum|elastic|inelastic|crash/.test(normalized)) return collisionDemo;
  if (/orbit|satellite|planet|escape velocity|kepler/.test(normalized)) return orbitDemo;
  if (/pendulum|swing|period|string/.test(normalized)) return pendulumDemo;
  if (/projectile|launch|throw|arc|cannon|ball/.test(normalized)) return projectileDemo;
  return dropDemo;
}
