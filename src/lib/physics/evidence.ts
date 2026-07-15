import {
  sceneSchema,
  type CounterfactualSpec,
  type ExperimentSpec,
  type PendulumScene,
  type ProjectileScene,
  type SceneSpec,
} from "@/lib/contracts/experiment";

export type EvidencePoint = {
  time: number;
  primary: number;
  secondary?: number;
  tertiary?: number;
};

export type SimulationEvidence = {
  outcomeKey: string;
  duration: number;
  summary: string;
  metricA: { label: string; value: string };
  metricB: { label: string; value: string };
  points: EvidencePoint[];
};

export type ProjectileMetrics = {
  flightTime: number;
  range: number;
  apex: number;
  impactSpeed: number;
};

export const DROP_TIE_TOLERANCE_SECONDS = 1 / 30;
export const PROJECTILE_TARGET_RADIUS_METERS = 0.92;
export const PENDULUM_PERIOD_RELATIVE_TOLERANCE = 0.01;
export const PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER = 1.225;

const MAX_PROJECTILE_STEPS = 1_000_000;
const MAX_PROJECTILE_TIME_SECONDS = 3_600;
const MAX_INTEGRATION_STEP_SECONDS = 1 / 240;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function assertFinite(name: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertPositive(name: string, value: number) {
  assertFinite(name, value);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

function assertNonNegative(name: string, value: number) {
  assertFinite(name, value);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function withinInclusiveThreshold(
  difference: number,
  threshold: number,
  scale: number,
) {
  const floatingPointSlack = Number.EPSILON * Math.max(1, scale) * 8;
  return difference <= threshold + floatingPointSlack;
}

function assertValidScene(scene: SceneSpec) {
  const parsed = sceneSchema.safeParse(scene);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "scene";
    throw new RangeError(`Invalid ${path}: ${issue?.message ?? "unknown error"}`);
  }
}

function projectedArea(radius: number) {
  return Math.PI * radius * radius;
}

function quadraticDragFactor(
  airDensity: number,
  mass: number,
  radius: number,
  dragCoefficient: number,
) {
  assertNonNegative("air density", airDensity);
  assertPositive("mass", mass);
  assertPositive("radius", radius);
  assertNonNegative("drag coefficient", dragCoefficient);
  return (
    (airDensity * dragCoefficient * projectedArea(radius)) / (2 * mass)
  );
}

export function vacuumDropTime(height: number, gravity: number) {
  assertNonNegative("height", height);
  assertPositive("gravity", gravity);
  return Math.sqrt((2 * height) / gravity);
}

/**
 * Exact impact time for release from rest under F_drag = 1/2 rho C_d A v^2.
 * The stable acosh(exp(kh)) form avoids overflow at the contract maxima.
 */
export function quadraticDragDropTime(
  height: number,
  gravity: number,
  airDensity: number,
  mass: number,
  radius: number,
  dragCoefficient: number,
) {
  const vacuumTime = vacuumDropTime(height, gravity);
  const dragFactor = quadraticDragFactor(
    airDensity,
    mass,
    radius,
    dragCoefficient,
  );
  if (dragFactor === 0 || height === 0) return vacuumTime;

  const scaledHeight = dragFactor * height;
  const inverseHyperbolicCosine =
    scaledHeight +
    Math.log1p(Math.sqrt(-Math.expm1(-2 * scaledHeight)));
  const time =
    inverseHyperbolicCosine / Math.sqrt(gravity * dragFactor);
  if (!Number.isFinite(time)) {
    throw new RangeError("quadratic-drag drop time is not finite");
  }
  return time;
}

function logCosh(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude < 1e-3) {
    const squared = magnitude * magnitude;
    return squared / 2 - (squared * squared) / 12;
  }
  if (magnitude < 12) return Math.log(Math.cosh(magnitude));
  return magnitude + Math.log1p(Math.exp(-2 * magnitude)) - Math.LN2;
}

function dropHeightAtTime(
  initialHeight: number,
  gravity: number,
  time: number,
  dragFactor: number,
  impactTime: number,
) {
  if (time >= impactTime) return 0;
  if (dragFactor < 1e-12) {
    return Math.max(0, initialHeight - 0.5 * gravity * time * time);
  }
  const distance =
    logCosh(Math.sqrt(gravity * dragFactor) * time) / dragFactor;
  return Math.max(0, initialHeight - distance);
}

export function classifyDropImpactTimes(timeA: number, timeB: number) {
  assertNonNegative("object A impact time", timeA);
  assertNonNegative("object B impact time", timeB);
  if (
    withinInclusiveThreshold(
      Math.abs(timeA - timeB),
      DROP_TIE_TOLERANCE_SECONDS,
      Math.max(timeA, timeB),
    )
  ) {
    return "tie";
  }
  return timeA < timeB ? "object_a_first" : "object_b_first";
}

export function classifyProjectileRange(
  range: number,
  target: number,
  tolerance = PROJECTILE_TARGET_RADIUS_METERS,
) {
  assertNonNegative("projectile range", range);
  assertPositive("target distance", target);
  assertPositive("target tolerance", tolerance);
  if (
    withinInclusiveThreshold(
      Math.abs(range - target),
      tolerance,
      Math.max(range, target),
    )
  ) {
    return "hit";
  }
  return range < target ? "undershoot" : "overshoot";
}

export function classifyPendulumPeriods(
  referencePeriod: number | null,
  evaluatedPeriod: number | null,
) {
  if (referencePeriod !== null) {
    assertPositive("reference pendulum period", referencePeriod);
  }
  if (evaluatedPeriod !== null) {
    assertPositive("evaluated pendulum period", evaluatedPeriod);
  }
  if (referencePeriod === null && evaluatedPeriod === null) {
    return "period_unchanged";
  }
  if (referencePeriod === null) return "period_decreases";
  if (evaluatedPeriod === null) return "period_increases";

  const tolerance =
    PENDULUM_PERIOD_RELATIVE_TOLERANCE *
    Math.max(referencePeriod, evaluatedPeriod);
  if (
    withinInclusiveThreshold(
      Math.abs(evaluatedPeriod - referencePeriod),
      tolerance,
      Math.max(referencePeriod, evaluatedPeriod),
    )
  ) {
    return "period_unchanged";
  }
  return evaluatedPeriod > referencePeriod
    ? "period_increases"
    : "period_decreases";
}

type ProjectileState = {
  time: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type ProjectileSolution = ProjectileMetrics & {
  points: EvidencePoint[];
};

function projectileDerivative(
  state: ProjectileState,
  gravity: number,
  dragFactor: number,
) {
  const speed = Math.hypot(state.vx, state.vy);
  return {
    x: state.vx,
    y: state.vy,
    vx: -dragFactor * speed * state.vx,
    vy: -gravity - dragFactor * speed * state.vy,
  };
}

function advanceProjectile(
  state: ProjectileState,
  step: number,
  gravity: number,
  dragFactor: number,
): ProjectileState {
  const k1 = projectileDerivative(state, gravity, dragFactor);
  const atHalfStep = (
    derivative: ReturnType<typeof projectileDerivative>,
  ): ProjectileState => ({
    time: state.time + step / 2,
    x: state.x + (derivative.x * step) / 2,
    y: state.y + (derivative.y * step) / 2,
    vx: state.vx + (derivative.vx * step) / 2,
    vy: state.vy + (derivative.vy * step) / 2,
  });
  const k2 = projectileDerivative(atHalfStep(k1), gravity, dragFactor);
  const k3 = projectileDerivative(atHalfStep(k2), gravity, dragFactor);
  const k4State: ProjectileState = {
    time: state.time + step,
    x: state.x + k3.x * step,
    y: state.y + k3.y * step,
    vx: state.vx + k3.vx * step,
    vy: state.vy + k3.vy * step,
  };
  const k4 = projectileDerivative(k4State, gravity, dragFactor);
  const next = {
    time: state.time + step,
    x: state.x + (step * (k1.x + 2 * k2.x + 2 * k3.x + k4.x)) / 6,
    y: state.y + (step * (k1.y + 2 * k2.y + 2 * k3.y + k4.y)) / 6,
    vx:
      state.vx + (step * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx)) / 6,
    vy:
      state.vy + (step * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy)) / 6,
  };
  if (
    !Number.isFinite(next.x) ||
    !Number.isFinite(next.y) ||
    !Number.isFinite(next.vx) ||
    !Number.isFinite(next.vy)
  ) {
    throw new RangeError("quadratic-drag projectile integration diverged");
  }
  return next;
}

function projectileStepSize(
  state: ProjectileState,
  gravity: number,
  dragFactor: number,
) {
  const dragRate = dragFactor * Math.hypot(state.vx, state.vy);
  const terminalRate = Math.sqrt(gravity * dragFactor);
  const rateLimitedStep =
    0.04 / Math.max(dragRate, terminalRate, Number.EPSILON);
  return Math.min(MAX_INTEGRATION_STEP_SECONDS, rateLimitedStep);
}

function initialProjectileState(scene: ProjectileScene): ProjectileState {
  const angle = radians(scene.launch.angleDegrees);
  return {
    time: 0,
    x: 0,
    y: scene.launch.height,
    vx: scene.launch.speed * Math.cos(angle),
    vy: scene.launch.speed * Math.sin(angle),
  };
}

function analyticProjectileSolution(
  scene: ProjectileScene,
  sampleCount: number,
): ProjectileSolution {
  const initial = initialProjectileState(scene);
  const discriminant = Math.hypot(
    initial.vy,
    Math.sqrt(2 * scene.gravity * scene.launch.height),
  );
  const flightTime = (initial.vy + discriminant) / scene.gravity;
  const range = initial.vx * flightTime;
  const apex =
    scene.launch.height + (initial.vy * initial.vy) / (2 * scene.gravity);
  const impactVy = initial.vy - scene.gravity * flightTime;
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const time = sampleCount === 1 ? 0 : (flightTime * index) / (sampleCount - 1);
    return {
      time,
      primary: initial.vx * time,
      secondary:
        index === sampleCount - 1
          ? 0
          : Math.max(
              0,
              scene.launch.height +
                initial.vy * time -
                0.5 * scene.gravity * time * time,
            ),
      tertiary: Math.hypot(
        initial.vx,
        initial.vy - scene.gravity * time,
      ),
    };
  });
  return {
    flightTime,
    range,
    apex,
    impactSpeed: Math.hypot(initial.vx, impactVy),
    points,
  };
}

function draggedProjectileImpact(
  scene: ProjectileScene,
  dragFactor: number,
): ProjectileMetrics {
  let state = initialProjectileState(scene);
  let apex = state.y;
  let steps = 0;

  while (
    steps < MAX_PROJECTILE_STEPS &&
    state.time < MAX_PROJECTILE_TIME_SECONDS
  ) {
    const step = projectileStepSize(state, scene.gravity, dragFactor);
    const next = advanceProjectile(state, step, scene.gravity, dragFactor);
    apex = Math.max(apex, state.y, next.y);

    if (state.vy > 0 && next.vy <= 0) {
      const fraction = state.vy / (state.vy - next.vy);
      apex = Math.max(apex, state.y + fraction * (next.y - state.y));
    }

    if (next.y <= 0 && next.vy < 0 && (state.time > 0 || state.y > 0)) {
      const denominator = state.y - next.y;
      const fraction = denominator > 0 ? state.y / denominator : 1;
      const flightTime = state.time + fraction * step;
      const range = state.x + fraction * (next.x - state.x);
      const impactVx = state.vx + fraction * (next.vx - state.vx);
      const impactVy = state.vy + fraction * (next.vy - state.vy);
      return {
        flightTime,
        range,
        apex,
        impactSpeed: Math.hypot(impactVx, impactVy),
      };
    }

    state = next;
    steps += 1;
  }
  throw new RangeError("projectile did not reach the ground within integration limits");
}

function draggedProjectilePoints(
  scene: ProjectileScene,
  dragFactor: number,
  metrics: ProjectileMetrics,
  sampleCount: number,
) {
  if (sampleCount === 0) return [];
  let state = initialProjectileState(scene);
  let steps = 0;
  return Array.from({ length: sampleCount }, (_, index) => {
    const targetTime =
      sampleCount === 1
        ? 0
        : (metrics.flightTime * index) / (sampleCount - 1);
    while (state.time < targetTime) {
      const remaining = targetTime - state.time;
      const step = Math.min(
        projectileStepSize(state, scene.gravity, dragFactor),
        remaining,
      );
      state = advanceProjectile(state, step, scene.gravity, dragFactor);
      steps += 1;
      if (steps >= MAX_PROJECTILE_STEPS) {
        throw new RangeError("projectile sampling exceeded integration limits");
      }
    }
    const isImpact = index === sampleCount - 1;
    return {
      time: targetTime,
      primary: isImpact ? metrics.range : state.x,
      secondary: isImpact ? 0 : Math.max(0, state.y),
      tertiary: Math.hypot(state.vx, state.vy),
    };
  });
}

function solveProjectile(scene: ProjectileScene, sampleCount: number) {
  assertValidScene(scene);
  const dragFactor = quadraticDragFactor(
    PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER,
    scene.object.mass,
    scene.object.radius,
    scene.object.dragCoefficient,
  );
  if (dragFactor === 0) return analyticProjectileSolution(scene, sampleCount);
  const metrics = draggedProjectileImpact(scene, dragFactor);
  return {
    ...metrics,
    points: draggedProjectilePoints(
      scene,
      dragFactor,
      metrics,
      sampleCount,
    ),
  };
}

export function projectileMetrics(scene: ProjectileScene): ProjectileMetrics {
  const solution = solveProjectile(scene, 0);
  return {
    flightTime: solution.flightTime,
    range: solution.range,
    apex: solution.apex,
    impactSpeed: solution.impactSpeed,
  };
}

type PendulumState = {
  angle: number;
  angularVelocity: number;
};

function advancePendulum(
  state: PendulumState,
  step: number,
  gravity: number,
  length: number,
  damping: number,
): PendulumState {
  const derivative = (value: PendulumState) => ({
    angle: value.angularVelocity,
    angularVelocity:
      -(gravity / length) * Math.sin(value.angle) -
      damping * value.angularVelocity,
  });
  const k1 = derivative(state);
  const k2 = derivative({
    angle: state.angle + (k1.angle * step) / 2,
    angularVelocity:
      state.angularVelocity + (k1.angularVelocity * step) / 2,
  });
  const k3 = derivative({
    angle: state.angle + (k2.angle * step) / 2,
    angularVelocity:
      state.angularVelocity + (k2.angularVelocity * step) / 2,
  });
  const k4 = derivative({
    angle: state.angle + k3.angle * step,
    angularVelocity: state.angularVelocity + k3.angularVelocity * step,
  });
  return {
    angle:
      state.angle +
      (step * (k1.angle + 2 * k2.angle + 2 * k3.angle + k4.angle)) / 6,
    angularVelocity:
      state.angularVelocity +
      (step *
        (k1.angularVelocity +
          2 * k2.angularVelocity +
          2 * k3.angularVelocity +
          k4.angularVelocity)) /
        6,
  };
}

/** Exact finite-amplitude period for an ideal, undamped simple pendulum. */
export function undampedPendulumPeriod(
  length: number,
  gravity: number,
  releaseAngleDegrees: number,
) {
  assertPositive("pendulum length", length);
  assertPositive("gravity", gravity);
  assertFinite("release angle", releaseAngleDegrees);
  if (releaseAngleDegrees <= 0 || releaseAngleDegrees >= 180) {
    throw new RangeError("release angle must be between zero and 180 degrees");
  }
  const halfAngleCosine = Math.cos(radians(releaseAngleDegrees) / 2);
  let arithmeticMean = 1;
  let geometricMean = halfAngleCosine;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const nextArithmetic = (arithmeticMean + geometricMean) / 2;
    const nextGeometric = Math.sqrt(arithmeticMean * geometricMean);
    arithmeticMean = nextArithmetic;
    geometricMean = nextGeometric;
    if (
      Math.abs(arithmeticMean - geometricMean) <=
      Number.EPSILON * arithmeticMean * 4
    ) {
      break;
    }
  }
  const ellipticIntegral = Math.PI / (2 * arithmeticMean);
  return 4 * Math.sqrt(length / gravity) * ellipticIntegral;
}

export function pendulumPeriod(scene: PendulumScene): number | null {
  assertValidScene(scene);
  const undampedPeriod = undampedPendulumPeriod(
    scene.length,
    scene.gravity,
    scene.releaseAngleDegrees,
  );
  if (scene.damping === 0) return undampedPeriod;

  const naturalAngularFrequency = Math.sqrt(scene.gravity / scene.length);
  const dampingRatio = scene.damping / (2 * naturalAngularFrequency);
  if (dampingRatio >= 1) return null;

  const linearDampedPeriod =
    (2 * Math.PI) /
    Math.sqrt(
      naturalAngularFrequency * naturalAngularFrequency -
        (scene.damping * scene.damping) / 4,
    );
  // Near critical damping, the amplitude is negligible before a numerically
  // measurable full cycle; the linearized limiting period is the stable value.
  if (dampingRatio > 0.9) return linearDampedPeriod;

  let state: PendulumState = {
    angle: radians(scene.releaseAngleDegrees),
    angularVelocity: 0,
  };
  let time = 0;
  const crossings: number[] = [];
  const amplitudeCorrection = undampedPeriod /
    (2 * Math.PI * Math.sqrt(scene.length / scene.gravity));
  const maximumTime = linearDampedPeriod * amplitudeCorrection * 1.6;
  const step = Math.min(
    MAX_INTEGRATION_STEP_SECONDS,
    1 / (240 * Math.max(naturalAngularFrequency, scene.damping)),
  );

  while (time < maximumTime && crossings.length < 3) {
    const next = advancePendulum(
      state,
      step,
      scene.gravity,
      scene.length,
      scene.damping,
    );
    if (state.angle !== 0 && state.angle * next.angle <= 0) {
      const fraction =
        Math.abs(state.angle) /
        (Math.abs(state.angle) + Math.abs(next.angle));
      crossings.push(time + fraction * step);
    }
    state = next;
    time += step;
  }
  return crossings.length === 3
    ? crossings[2]! - crossings[0]!
    : linearDampedPeriod;
}

function pendulumEvidencePoints(
  scene: PendulumScene,
  duration: number,
  sampleCount: number,
) {
  const naturalAngularFrequency = Math.sqrt(scene.gravity / scene.length);
  const maximumStep = Math.min(
    MAX_INTEGRATION_STEP_SECONDS,
    0.04 / Math.max(naturalAngularFrequency, scene.damping, Number.EPSILON),
  );
  let state: PendulumState = {
    angle: radians(scene.releaseAngleDegrees),
    angularVelocity: 0,
  };
  let time = 0;
  return Array.from({ length: sampleCount }, (_, index) => {
    const targetTime =
      sampleCount === 1 ? 0 : (duration * index) / (sampleCount - 1);
    while (time < targetTime) {
      const step = Math.min(maximumStep, targetTime - time);
      state = advancePendulum(
        state,
        step,
        scene.gravity,
        scene.length,
        scene.damping,
      );
      time += step;
    }
    const tangentialSpeed = Math.abs(scene.length * state.angularVelocity);
    const kineticEnergy =
      0.5 * scene.bob.mass * tangentialSpeed * tangentialSpeed;
    const potentialEnergy =
      scene.bob.mass *
      scene.gravity *
      scene.length *
      (1 - Math.cos(state.angle));
    return {
      time: targetTime,
      primary: (state.angle * 180) / Math.PI,
      secondary: tangentialSpeed,
      tertiary: kineticEnergy + potentialEnergy,
    };
  });
}

export function determineOutcome(
  scene: SceneSpec,
  referenceScene?: SceneSpec,
) {
  assertValidScene(scene);
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    const timeA = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      a.mass,
      a.radius,
      a.dragCoefficient,
    );
    const timeB = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      b.mass,
      b.radius,
      b.dragCoefficient,
    );
    return classifyDropImpactTimes(timeA, timeB);
  }

  if (scene.family === "projectile") {
    const { range } = projectileMetrics(scene);
    const target = scene.targetDistance ?? range;
    return classifyProjectileRange(range, target);
  }

  if (referenceScene === undefined) return "period_unchanged";
  assertValidScene(referenceScene);
  if (referenceScene.family !== "pendulum") {
    throw new TypeError("pendulum outcomes require a pendulum reference scene");
  }
  return classifyPendulumPeriods(
    pendulumPeriod(referenceScene),
    pendulumPeriod(scene),
  );
}

type SceneComparison = {
  targetPath: string;
  reference: SceneSpec;
  evaluated: SceneSpec;
};

const comparisonKey = Symbol("physics-scene-comparison");
type ExperimentWithComparison = ExperimentSpec & {
  [comparisonKey]?: SceneComparison;
};

function attachComparison(
  spec: ExperimentSpec,
  comparison: SceneComparison | undefined,
) {
  if (comparison) {
    (spec as ExperimentWithComparison)[comparisonKey] = comparison;
  }
  return spec;
}

function getComparison(spec: ExperimentSpec) {
  return (spec as ExperimentWithComparison)[comparisonKey];
}

function pathSegments(targetPath: string) {
  if (!/^scene(?:\.[a-zA-Z0-9]+)+$/.test(targetPath)) return null;
  const segments = targetPath.split(".");
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    return null;
  }
  return segments;
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

function comparisonForEvidence(spec: ExperimentSpec) {
  const stored = getComparison(spec);
  const testChange = spec.prediction.testChange;
  if (
    stored &&
    stored.evaluated === spec.scene &&
    (!testChange || stored.targetPath === testChange.targetPath)
  ) {
    return stored;
  }
  if (!testChange) return undefined;
  const segments = pathSegments(testChange.targetPath);
  if (!segments) return undefined;
  const currentValue = valueAtPath(spec, segments);
  if (typeof currentValue !== "number" || Object.is(currentValue, testChange.value)) {
    return undefined;
  }
  const evaluated = updateScenePath(
    spec,
    testChange.targetPath,
    testChange.value,
  );
  if (evaluated === spec) return undefined;
  return {
    targetPath: testChange.targetPath,
    reference: spec.scene,
    evaluated: evaluated.scene,
  } satisfies SceneComparison;
}

export function buildEvidence(spec: ExperimentSpec): SimulationEvidence {
  const { scene } = spec;
  assertValidScene(scene);
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    const dragFactorA = quadraticDragFactor(
      scene.airDensity,
      a.mass,
      a.radius,
      a.dragCoefficient,
    );
    const dragFactorB = quadraticDragFactor(
      scene.airDensity,
      b.mass,
      b.radius,
      b.dragCoefficient,
    );
    const timeA = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      a.mass,
      a.radius,
      a.dragCoefficient,
    );
    const timeB = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      b.mass,
      b.radius,
      b.dragCoefficient,
    );
    const duration = Math.max(timeA, timeB);
    const points = Array.from({ length: 31 }, (_, index) => {
      const time = (duration * index) / 30;
      return {
        time,
        primary: dropHeightAtTime(
          scene.height,
          scene.gravity,
          time,
          dragFactorA,
          timeA,
        ),
        secondary: dropHeightAtTime(
          scene.height,
          scene.gravity,
          time,
          dragFactorB,
          timeB,
        ),
      };
    });
    const outcomeKey = classifyDropImpactTimes(timeA, timeB);
    const hasDrag = dragFactorA > 0 || dragFactorB > 0;
    return {
      outcomeKey,
      duration,
      summary:
        outcomeKey === "tie"
          ? hasDrag
            ? "The quadratic-drag impact times differ by no more than one 30 fps frame. Equal timing follows from equal drag per unit mass, not mass alone."
            : "With drag absent, both objects accelerate at g and land together; inertial and gravitational mass cancel."
          : "Quadratic drag scales with air density, drag coefficient, frontal area, and speed squared; acceleration from drag is inversely proportional to mass.",
      metricA: { label: "Object A impact", value: `${timeA.toFixed(2)} s` },
      metricB: { label: "Object B impact", value: `${timeB.toFixed(2)} s` },
      points,
    };
  }

  if (scene.family === "projectile") {
    const solution = solveProjectile(scene, 36);
    const target = scene.targetDistance ?? solution.range;
    const hasDrag = scene.object.dragCoefficient > 0;
    return {
      outcomeKey: classifyProjectileRange(solution.range, target),
      duration: solution.flightTime,
      summary: hasDrag
        ? "Gravity and quadratic drag changed both velocity components; the drag force used standard air density and opposed the instantaneous velocity."
        : "With drag absent, horizontal velocity stayed constant while gravity changed vertical velocity, producing a parabolic path.",
      metricA: {
        label: "Calculated range",
        value: `${solution.range.toFixed(1)} m`,
      },
      metricB: {
        label: "Calculated apex",
        value: `${solution.apex.toFixed(1)} m`,
      },
      points: solution.points,
    };
  }

  const calculatedPeriod = pendulumPeriod(scene);
  const undampedPeriod = undampedPendulumPeriod(
    scene.length,
    scene.gravity,
    scene.releaseAngleDegrees,
  );
  const duration = Math.min((calculatedPeriod ?? undampedPeriod) * 2, 10);
  const comparison = comparisonForEvidence(spec);
  const outcomeKey = comparison
    ? determineOutcome(comparison.evaluated, comparison.reference)
    : "period_unchanged";
  return {
    outcomeKey,
    duration,
    summary:
      calculatedPeriod === null
        ? "Damping is at or above the critical value, so the bob returns without a repeating period. Mechanical energy still decreases monotonically."
        : scene.damping > 0
          ? "Length, gravity, release angle, and damping set the period in this model; bob mass cancels from the motion while damping removes mechanical energy."
          : "Length, gravity, and release angle set the nonlinear period; bob mass cancels from the motion, and mechanical energy is conserved.",
    metricA: {
      label: "Calculated period",
      value:
        calculatedPeriod === null
          ? "No oscillation"
          : `${calculatedPeriod.toFixed(2)} s`,
    },
    metricB: { label: "Bob mass", value: `${scene.bob.mass.toFixed(1)} kg` },
    points: pendulumEvidencePoints(scene, duration, 50),
  };
}

export function updateScenePath(
  spec: ExperimentSpec,
  targetPath: string,
  value: number,
): ExperimentSpec {
  if (!Number.isFinite(value)) return spec;
  const segments = pathSegments(targetPath);
  if (!segments) return spec;
  const currentValue = valueAtPath(spec, segments);
  if (typeof currentValue !== "number") return spec;

  const priorComparison = getComparison(spec);
  const clone = structuredClone(spec) as ExperimentSpec;
  let cursor: Record<string, unknown> = clone as ExperimentSpec &
    Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const next = cursor[segments[index]!];
    if (next === null || typeof next !== "object") return spec;
    cursor = next as Record<string, unknown>;
  }
  const finalSegment = segments.at(-1)!;

  if (Object.is(currentValue, value)) {
    return attachComparison(
      clone,
      priorComparison
        ? { ...priorComparison, evaluated: clone.scene }
        : undefined,
    );
  }

  cursor[finalSegment] = value;
  if (!sceneSchema.safeParse(clone.scene).success) return spec;

  const comparison: SceneComparison = {
    targetPath,
    reference: spec.scene,
    evaluated: clone.scene,
  };
  const testChange = spec.prediction.testChange;
  if (
    testChange?.targetPath === targetPath &&
    Object.is(testChange.value, value)
  ) {
    clone.prediction.correctOutcomeKey = determineOutcome(
      clone.scene,
      spec.scene,
    );
  }
  return attachComparison(clone, comparison);
}

function countSceneDifferences(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return 1;
  }
  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>),
  ]);
  let differences = 0;
  for (const key of keys) {
    differences += countSceneDifferences(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    );
  }
  return differences;
}

export function applyCounterfactual(
  spec: ExperimentSpec,
  counterfactual: CounterfactualSpec,
) {
  const { targetPath, value } = counterfactual.change;
  if (!Number.isFinite(value)) {
    throw new RangeError("counterfactual value must be finite");
  }
  const segments = pathSegments(targetPath);
  const currentValue = segments ? valueAtPath(spec, segments) : undefined;
  if (typeof currentValue !== "number") {
    throw new RangeError(`counterfactual path is not a numeric scene value: ${targetPath}`);
  }
  if (Object.is(currentValue, value)) {
    throw new RangeError("counterfactual must change exactly one physical variable");
  }
  const testChange = counterfactual.prediction.testChange;
  if (
    testChange &&
    (testChange.targetPath !== targetPath || !Object.is(testChange.value, value))
  ) {
    throw new RangeError(
      "counterfactual prediction must test the same single physical change",
    );
  }

  const updated = updateScenePath(spec, targetPath, value);
  if (updated === spec || countSceneDifferences(spec.scene, updated.scene) !== 1) {
    throw new RangeError("counterfactual did not produce exactly one valid scene change");
  }
  const physicalOutcome = determineOutcome(updated.scene, spec.scene);
  if (
    !counterfactual.prediction.choices.some(
      (choice) => choice.outcomeKey === physicalOutcome,
    )
  ) {
    throw new RangeError(
      `counterfactual choices do not represent physical outcome: ${physicalOutcome}`,
    );
  }

  const result: ExperimentSpec = {
    ...updated,
    controls: updated.controls.map((control) =>
      control.targetPath === targetPath
        ? { ...control, value }
        : control,
    ),
    prediction: {
      ...counterfactual.prediction,
      correctOutcomeKey: physicalOutcome,
    },
  };
  return attachComparison(result, getComparison(updated));
}
