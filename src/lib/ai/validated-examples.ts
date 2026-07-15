import {
  collisionDemo,
  dropDemo,
  orbitDemo,
  pendulumDemo,
  projectileDemo,
  springDemo,
} from "@/components/lab/demo-experiments";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import type { LearningIntent } from "./contracts/learning-intent";
import { EXPERIMENT_FAMILIES, type ExperimentFamily } from "./text-rules";

/**
 * Renderer-compatible bundled examples used when the provider is unavailable
 * or cannot produce a valid experiment. They live with the existing lab demo
 * data; this module provides an AI-owned, deterministic selection boundary.
 */
const EXAMPLES = {
  drop: dropDemo,
  projectile: projectileDemo,
  pendulum: pendulumDemo,
  spring: springDemo,
  collision: collisionDemo,
  orbit: orbitDemo,
} as const satisfies Record<ExperimentFamily, ExperimentSpec>;

const KEYWORDS = {
  drop: ["drop", "fall", "gravity", "mass", "tower", "free-fall"],
  projectile: ["projectile", "launch", "throw", "angle", "range", "trajectory"],
  pendulum: ["pendulum", "swing", "period", "length", "oscillation"],
  spring: ["spring", "hooke", "resonance", "stiffness", "oscillator", "frequency"],
  collision: ["collision", "momentum", "elastic", "inelastic", "impact", "restitution"],
  orbit: ["orbit", "satellite", "planet", "kepler", "escape", "gravity"],
} as const;

export function closestValidatedExample(intent: LearningIntent): ExperimentSpec {
  if (intent.family !== "unknown") {
    return structuredClone(EXAMPLES[intent.family]);
  }

  const haystack = `${intent.topic} ${intent.concepts.join(" ")}`.toLowerCase();
  let bestFamily: keyof typeof EXAMPLES = "drop";
  let bestScore = -1;
  for (const family of EXPERIMENT_FAMILIES) {
    const score = KEYWORDS[family].reduce(
      (total, keyword) => total + (haystack.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestFamily = family;
      bestScore = score;
    }
  }
  return structuredClone(EXAMPLES[bestFamily]);
}
