import type {
  DropScene,
  ExperimentSpec,
  PendulumScene,
  ProjectileScene,
  SceneSpec,
} from "@/lib/contracts/experiment";
import { determineOutcome } from "@/lib/physics/evidence";
import { applySceneChange } from "./scene-paths";

/**
 * Server-side ground truth for prediction correctness.
 *
 * The model may propose wording, parameters, objectives, and misconception
 * content — it never decides correctness. This module computes the outcome
 * key for the base prediction and every counterfactual from declarative
 * data only (scene numbers plus testChange / counterfactual.change), never
 * from natural-language question text.
 *
 * Calculation policy (documented, deterministic):
 * - Correctness for drop/projectile uses the renderer's exported
 *   determineOutcome function, keeping server truth and observed evidence
 *   exactly aligned.
 * - Duration/feasibility uses analytic closed forms whenever drag is irrelevant:
 *     drop (vacuum):        t = sqrt(2h/g)
 *     projectile (Cd = 0):  t = (v·sinθ + sqrt((v·sinθ)² + 2gh)) / g,
 *                           range = v·cosθ · t
 *     pendulum (small-angle): T = 2π·sqrt(L/g) — mass and damping cancel.
 * - When drag is enabled, a fixed-step semi-implicit Euler integration with
 *   quadratic drag F = ½·ρ·Cd·A·|v|·v, A = πr², dt = 1/240 s, capped at
 *   20 s of simulated time. The drop scene provides ρ (airDensity); the
 *   projectile scene has no air-density field, so the standard sea-level
 *   ρ = 1.2 kg/m³ is used whenever object.dragCoefficient > 0.
 *
 * Outcome thresholds (aligned with the renderer's evidence semantics):
 * - drop tie window: |tA − tB| < 0.035 s
 * - projectile hit tolerance: |range − target| ≤ max(0.8 m, 5.5% of target)
 * - pendulum period change: ratio within ±1% counts as unchanged
 */

export const OUTCOME_KEYS = {
  drop: ["object_a_first", "object_b_first", "tie"],
  projectile: ["undershoot", "hit", "overshoot"],
  pendulum: ["period_increases", "period_decreases", "period_unchanged"],
} as const;

export type DropOutcome = (typeof OUTCOME_KEYS.drop)[number];
export type ProjectileOutcome = (typeof OUTCOME_KEYS.projectile)[number];
export type PendulumOutcome = (typeof OUTCOME_KEYS.pendulum)[number];

export const FIXED_TIMESTEP_S = 1 / 240;
export const MAX_SIMULATED_SECONDS = 20;
export const DROP_TIE_THRESHOLD_S = 0.035;
export const PENDULUM_PERIOD_EPSILON = 0.01;
export const PROJECTILE_AIR_DENSITY = 1.2;

export function projectileHitTolerance(target: number): number {
  return Math.max(0.8, target * 0.055);
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

interface DragBody {
  mass: number;
  radius: number;
  dragCoefficient: number;
}

/**
 * Fall time from `height` (m) under gravity with quadratic drag.
 * Returns null if the object has not landed within MAX_SIMULATED_SECONDS.
 */
export function dropFallTime(
  height: number,
  gravity: number,
  airDensity: number,
  body: DragBody,
): number | null {
  if (airDensity <= 0 || body.dragCoefficient <= 0) {
    return Math.sqrt((2 * height) / gravity);
  }
  const k =
    (0.5 * airDensity * body.dragCoefficient * Math.PI * body.radius ** 2) /
    Math.max(body.mass, 0.001);
  let y = height;
  let v = 0;
  let t = 0;
  while (t < MAX_SIMULATED_SECONDS) {
    const acceleration = gravity - k * v * Math.abs(v);
    const nextV = v + acceleration * FIXED_TIMESTEP_S;
    const nextY = y - nextV * FIXED_TIMESTEP_S;
    if (nextY <= 0) {
      // Linear interpolation within the final step keeps comparisons stable.
      const fraction = y / (y - nextY);
      return t + FIXED_TIMESTEP_S * fraction;
    }
    y = nextY;
    v = nextV;
    t += FIXED_TIMESTEP_S;
  }
  return null;
}

export interface ProjectileFlight {
  range: number;
  flightTime: number;
}

/** Range and flight time; null if flight exceeds MAX_SIMULATED_SECONDS. */
export function projectileFlight(scene: ProjectileScene): ProjectileFlight | null {
  const angle = radians(scene.launch.angleDegrees);
  const vx0 = scene.launch.speed * Math.cos(angle);
  const vy0 = scene.launch.speed * Math.sin(angle);

  if (scene.object.dragCoefficient <= 0) {
    const flightTime =
      (vy0 + Math.sqrt(vy0 * vy0 + 2 * scene.gravity * scene.launch.height)) /
      scene.gravity;
    if (flightTime > MAX_SIMULATED_SECONDS) return null;
    return { range: vx0 * flightTime, flightTime };
  }

  const k =
    (0.5 *
      PROJECTILE_AIR_DENSITY *
      scene.object.dragCoefficient *
      Math.PI *
      scene.object.radius ** 2) /
    Math.max(scene.object.mass, 0.001);
  let x = 0;
  let y = scene.launch.height;
  let vx = vx0;
  let vy = vy0;
  let t = 0;
  while (t < MAX_SIMULATED_SECONDS) {
    const speed = Math.hypot(vx, vy);
    const ax = -k * speed * vx;
    const ay = -scene.gravity - k * speed * vy;
    const nextVx = vx + ax * FIXED_TIMESTEP_S;
    const nextVy = vy + ay * FIXED_TIMESTEP_S;
    const nextX = x + nextVx * FIXED_TIMESTEP_S;
    const nextY = y + nextVy * FIXED_TIMESTEP_S;
    if (nextY <= 0 && nextVy < 0) {
      const fraction = y / (y - nextY);
      return {
        range: x + (nextX - x) * fraction,
        flightTime: t + FIXED_TIMESTEP_S * fraction,
      };
    }
    x = nextX;
    y = nextY;
    vx = nextVx;
    vy = nextVy;
    t += FIXED_TIMESTEP_S;
  }
  return null;
}

/** Small-angle pendulum period. Mass, damping, and release angle cancel. */
export function pendulumPeriod(scene: PendulumScene): number {
  return 2 * Math.PI * Math.sqrt(scene.length / scene.gravity);
}

export function dropOutcome(scene: DropScene): DropOutcome | null {
  return determineOutcome(scene) as DropOutcome;
}

export function projectileOutcome(
  scene: ProjectileScene,
): ProjectileOutcome | null {
  if (scene.targetDistance === undefined) return null;
  return determineOutcome(scene) as ProjectileOutcome;
}

export function pendulumComparisonOutcome(
  before: PendulumScene,
  after: PendulumScene,
): PendulumOutcome {
  const ratio = pendulumPeriod(after) / pendulumPeriod(before);
  if (ratio > 1 + PENDULUM_PERIOD_EPSILON) return "period_increases";
  if (ratio < 1 - PENDULUM_PERIOD_EPSILON) return "period_decreases";
  return "period_unchanged";
}

export interface SceneChange {
  targetPath: string;
  value: number;
}

/**
 * Compute the outcome key a prediction must declare correct.
 *
 * - drop / projectile: the outcome of the world under observation (the base
 *   scene, with `change` applied first when present).
 * - pendulum: a controlled comparison — period before vs after `change`;
 *   `change` is REQUIRED (from prediction.testChange or counterfactual
 *   .change) because a period question has no meaning in a single world.
 *
 * Returns null when the outcome is not computable (missing change for a
 * pendulum, missing targetDistance, or > 20 s of simulated time) — callers
 * turn that into a validation error.
 */
export function expectedOutcomeKey(
  scene: SceneSpec,
  change?: SceneChange,
): string | null {
  if (scene.family === "pendulum") {
    if (!change) return null;
    const after = applySceneChange(scene, change.targetPath, change.value);
    return pendulumComparisonOutcome(scene, after as PendulumScene);
  }
  const observed = change
    ? applySceneChange(scene, change.targetPath, change.value)
    : scene;
  if (observed.family === "drop") return dropOutcome(observed);
  if (observed.family === "projectile") return projectileOutcome(observed);
  return null;
}

/**
 * The simulated duration a spec's scene needs (used for the ≤ 20 s rule):
 * drop = slowest object's fall, projectile = flight time, pendulum = two
 * full periods. Null when it exceeds the cap.
 */
export function sceneDuration(scene: SceneSpec): number | null {
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    const timeA = dropFallTime(scene.height, scene.gravity, scene.airDensity, a);
    const timeB = dropFallTime(scene.height, scene.gravity, scene.airDensity, b);
    if (timeA === null || timeB === null) return null;
    const duration = Math.max(timeA, timeB);
    return duration <= MAX_SIMULATED_SECONDS ? duration : null;
  }
  if (scene.family === "projectile") {
    const flight = projectileFlight(scene);
    if (flight === null || flight.flightTime > MAX_SIMULATED_SECONDS) return null;
    return flight.flightTime;
  }
  const duration = 2 * pendulumPeriod(scene);
  return duration <= MAX_SIMULATED_SECONDS ? duration : null;
}

/**
 * Overwrite correctOutcomeKey on the base prediction and every
 * counterfactual with server-computed values. Assumes the spec has already
 * passed structural validation; throws if an outcome is not computable.
 */
export function finalizeCorrectness(spec: ExperimentSpec): ExperimentSpec {
  const finalized = structuredClone(spec);

  const baseKey = expectedOutcomeKey(
    finalized.scene,
    finalized.prediction.testChange,
  );
  if (baseKey === null) {
    throw new Error("base prediction outcome is not computable");
  }
  finalized.prediction.correctOutcomeKey = baseKey;

  for (const counterfactual of finalized.counterfactuals) {
    const change = counterfactual.prediction.testChange ?? counterfactual.change;
    const key =
      finalized.scene.family === "pendulum"
        ? expectedOutcomeKey(finalized.scene, change)
        : expectedOutcomeKey(
            applySceneChange(
              finalized.scene,
              counterfactual.change.targetPath,
              counterfactual.change.value,
            ),
          );
    if (key === null) {
      throw new Error(
        `counterfactual "${counterfactual.id}" outcome is not computable`,
      );
    }
    counterfactual.prediction.correctOutcomeKey = key;
  }
  return finalized;
}
