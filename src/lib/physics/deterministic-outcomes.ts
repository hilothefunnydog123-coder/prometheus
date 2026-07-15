import {
  sceneSchema,
  type DropScene,
  type ExperimentSpec,
  type PendulumScene,
  type ProjectileScene,
  type SceneSpec,
} from "@/lib/contracts/experiment";
import {
  DROP_TIE_TOLERANCE_SECONDS,
  MAX_SIMULATION_TIME_SECONDS,
  PENDULUM_PERIOD_RELATIVE_TOLERANCE,
  PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER,
  PROJECTILE_TARGET_RADIUS_METERS,
  determineOutcome,
  pendulumPeriod,
  projectileMetrics,
  quadraticDragDropTime,
  undampedPendulumPeriod,
} from "./evidence";

export { pendulumPeriod } from "./evidence";

/**
 * Physics-owned server boundary for evaluating model-authored experiments.
 *
 * The model may choose a valid scene and write instructional text. It never
 * decides which prediction is correct: every outcome key is derived from the
 * same functions that build the evidence shown by the renderer.
 */

export const OUTCOME_KEYS = {
  drop: ["object_a_first", "object_b_first", "tie"],
  projectile: ["undershoot", "hit", "overshoot"],
  pendulum: ["period_increases", "period_decreases", "period_unchanged"],
} as const;

export const MAX_SIMULATED_SECONDS = MAX_SIMULATION_TIME_SECONDS;
export const FIXED_TIMESTEP_S = 1 / 240;
export const DROP_TIE_THRESHOLD_S = DROP_TIE_TOLERANCE_SECONDS;
export const PENDULUM_PERIOD_EPSILON =
  PENDULUM_PERIOD_RELATIVE_TOLERANCE;
export const PROJECTILE_AIR_DENSITY =
  PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER;

export type DropOutcome = (typeof OUTCOME_KEYS.drop)[number];
export type ProjectileOutcome = (typeof OUTCOME_KEYS.projectile)[number];
export type PendulumOutcome = (typeof OUTCOME_KEYS.pendulum)[number];

export interface SceneChange {
  targetPath: string;
  value: number;
}

export interface ProjectileFlight {
  range: number;
  flightTime: number;
}

type DragBody = Pick<
  DropScene["objects"][number],
  "mass" | "radius" | "dragCoefficient"
>;

const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function scenePathSegments(targetPath: string) {
  if (!/^scene(?:\.[a-zA-Z0-9]+)+$/.test(targetPath)) return null;
  const segments = targetPath.split(".");
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    return null;
  }
  return segments.slice(1);
}

function valueAtPath(root: unknown, segments: string[]): unknown {
  let cursor = root;
  for (const segment of segments) {
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Apply exactly one existing numeric scene change and revalidate its bounds. */
export function applySceneChange(
  scene: SceneSpec,
  targetPath: string,
  value: number,
): SceneSpec {
  if (!Number.isFinite(value)) {
    throw new RangeError("scene change value must be finite");
  }
  const segments = scenePathSegments(targetPath);
  if (!segments || segments.length === 0) {
    throw new RangeError(`invalid numeric scene path: ${targetPath}`);
  }
  const currentValue = valueAtPath(scene, segments);
  if (typeof currentValue !== "number") {
    throw new RangeError(`scene path is not an existing numeric value: ${targetPath}`);
  }
  if (Object.is(currentValue, value)) {
    throw new RangeError("scene change must modify exactly one numeric value");
  }

  const clone = structuredClone(scene) as SceneSpec & Record<string, unknown>;
  let cursor = clone as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next === null || typeof next !== "object") {
      throw new RangeError(`scene path is not an existing numeric value: ${targetPath}`);
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;

  const parsed = sceneSchema.safeParse(clone);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RangeError(
      `scene change violates contract bounds at ${issue?.path.join(".") || targetPath}`,
    );
  }
  return parsed.data;
}

/** Exact fall time under gravity and optional quadratic drag. */
export function dropFallTime(
  height: number,
  gravity: number,
  airDensity: number,
  body: DragBody,
) {
  return quadraticDragDropTime(
    height,
    gravity,
    airDensity,
    body.mass,
    body.radius,
    body.dragCoefficient,
  );
}

export function projectileFlight(scene: ProjectileScene): ProjectileFlight {
  const { range, flightTime } = projectileMetrics(scene);
  return { range, flightTime };
}

/**
 * The target ring has a fixed 0.92 m radius in scene units, so hit tolerance
 * is fixed as well; it does not grow arbitrarily with target distance.
 */
export function projectileHitTolerance(target: number) {
  if (!Number.isFinite(target) || target <= 0) {
    throw new RangeError("target distance must be finite and greater than zero");
  }
  return PROJECTILE_TARGET_RADIUS_METERS;
}

export function dropOutcome(scene: DropScene): DropOutcome {
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
  return determineOutcome(after, before) as PendulumOutcome;
}

/** Compute a prediction key from numeric scene data, never prompt wording. */
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

/** Duration of the physical event, or null only beyond solver safeguards. */
export function sceneDuration(scene: SceneSpec): number | null {
  let duration: number;
  if (scene.family === "drop") {
    duration = Math.max(
      ...scene.objects.map((body) =>
        dropFallTime(scene.height, scene.gravity, scene.airDensity, body),
      ),
    );
  } else if (scene.family === "projectile") {
    duration = projectileFlight(scene).flightTime;
  } else {
    const repeatingPeriod = pendulumPeriod(scene);
    const referencePeriod =
      repeatingPeriod ??
      undampedPendulumPeriod(
        scene.length,
        scene.gravity,
        scene.releaseAngleDegrees,
      );
    duration = 2 * referencePeriod;
  }
  return duration <= MAX_SIMULATED_SECONDS ? duration : null;
}

/**
 * Replace every model-declared answer with the renderer's deterministic
 * result. Counterfactual correctness follows counterfactual.change, which is
 * the single world change the renderer applies.
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
    const changedScene = applySceneChange(
      finalized.scene,
      counterfactual.change.targetPath,
      counterfactual.change.value,
    );
    const key =
      finalized.scene.family === "pendulum"
        ? pendulumComparisonOutcome(
            finalized.scene,
            changedScene as PendulumScene,
          )
        : expectedOutcomeKey(changedScene);
    if (key === null) {
      throw new Error(
        `counterfactual "${counterfactual.id}" outcome is not computable`,
      );
    }
    counterfactual.prediction.correctOutcomeKey = key;
  }
  return finalized;
}
