import {
  sandboxSceneSchema,
  type SandboxMetric,
  type SandboxScene,
} from "@/lib/contracts/experiment";
import type { EvidencePoint, SimulationEvidence } from "./evidence";

/**
 * Deterministic engine for the generic `sandbox` mechanics family.
 *
 * This module is the single source of truth for every sandbox experiment:
 * the 3D renderer plays back the trajectory it produces, the evidence chart
 * plots the samples it records, and the graded outcome is computed from the
 * same numbers. Because one function owns all three, the animation the learner
 * watches, the measurements they read, and the answer they are graded against
 * can never disagree. The language model authors the scene and the outcome
 * *rule*; it never decides the outcome.
 *
 * Integration is fixed-step semi-implicit (symplectic) Euler, which is stable
 * for the bounded oscillators and orbits the contract allows and conserves
 * energy well enough over the <= 20 s horizon. Runs are pure functions of the
 * scene, so the server and browser reach byte-identical trajectories.
 */

/** Physics sub-step. Small enough that k/m up to the contract maxima is stable. */
const SUBSTEP_SECONDS = 1 / 480;
/** Output sampling rate for rendering, evidence, and metric extraction. */
const SAMPLE_HZ = 60;
const EPSILON = 1e-9;

export interface BodyFrame {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SandboxFrame {
  time: number;
  bodies: BodyFrame[];
}

/**
 * Per-body scalars accumulated at the fine integration step, not from the
 * 60 fps samples. A body can touch the floor and rebound, or pass a peak,
 * entirely between two samples; those events must be measured at sub-step
 * resolution or the graded outcome would disagree with the physics.
 */
export interface SandboxMetrics {
  /** First time the body's lowest point touched the floor, or Infinity. */
  firstFloorTime: number[];
  maxHeight: number[];
  maxSpeed: number[];
  pathLength: number[];
}

export interface SandboxTrajectory {
  duration: number;
  /** Body order matches scene.bodies. */
  ids: string[];
  frames: SandboxFrame[];
  metrics: SandboxMetrics;
}

interface BodyState {
  id: string;
  mass: number;
  radius: number;
  dragCoefficient: number;
  fixed: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SpringLink {
  aIndex: number;
  bIndex: number | null;
  anchorX: number;
  anchorY: number;
  stiffness: number;
  restLength: number;
  damping: number;
}

function assertValidSandbox(scene: SandboxScene): void {
  const parsed = sandboxSceneSchema.safeParse(scene);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RangeError(
      `Invalid sandbox ${issue?.path.join(".") ?? "scene"}: ${issue?.message ?? "unknown error"}`,
    );
  }
}

function initialStates(scene: SandboxScene): BodyState[] {
  return scene.bodies.map((body) => ({
    id: body.id,
    mass: body.mass,
    radius: body.radius,
    dragCoefficient: body.dragCoefficient,
    fixed: body.fixed,
    x: body.position.x,
    y: body.position.y,
    vx: body.velocity.x,
    vy: body.velocity.y,
  }));
}

function resolveSprings(scene: SandboxScene): SpringLink[] {
  const indexOf = new Map(scene.bodies.map((body, index) => [body.id, index]));
  const links: SpringLink[] = [];
  for (const spring of scene.springs) {
    const aIndex = indexOf.get(spring.bodyA);
    if (aIndex === undefined) continue; // unknown endpoints are dropped safely
    const bIndex =
      spring.bodyB === null ? null : indexOf.get(spring.bodyB) ?? undefined;
    if (bIndex === undefined) continue;
    links.push({
      aIndex,
      bIndex,
      anchorX: spring.anchor.x,
      anchorY: spring.anchor.y,
      stiffness: spring.stiffness,
      restLength: spring.restLength,
      damping: spring.damping,
    });
  }
  return links;
}

function accumulateForces(
  states: BodyState[],
  springs: SpringLink[],
  scene: SandboxScene,
  fx: number[],
  fy: number[],
): void {
  for (let i = 0; i < states.length; i += 1) {
    fx[i] = 0;
    fy[i] = 0;
  }

  for (let i = 0; i < states.length; i += 1) {
    const body = states[i]!;
    if (body.fixed) continue;

    // Uniform gravity.
    fy[i]! -= scene.gravity * body.mass;

    // Inverse-square central attractor at the origin (orbits). a = -mu * r / |r|^3.
    if (scene.centralGravity > 0) {
      const distanceSquared = body.x * body.x + body.y * body.y;
      const distance = Math.sqrt(distanceSquared);
      if (distance > EPSILON) {
        const factor =
          (scene.centralGravity * body.mass) / (distanceSquared * distance);
        fx[i]! -= factor * body.x;
        fy[i]! -= factor * body.y;
      }
    }

    // Quadratic drag opposing the instantaneous velocity.
    if (scene.airDensity > 0 && body.dragCoefficient > 0) {
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > EPSILON) {
        const area = Math.PI * body.radius * body.radius;
        const magnitude =
          0.5 * scene.airDensity * body.dragCoefficient * area * speed;
        fx[i]! -= magnitude * body.vx;
        fy[i]! -= magnitude * body.vy;
      }
    }
  }

  // Hooke springs with velocity damping, applied equal-and-opposite.
  for (const spring of springs) {
    const a = states[spring.aIndex]!;
    const bx = spring.bIndex === null ? spring.anchorX : states[spring.bIndex]!.x;
    const by = spring.bIndex === null ? spring.anchorY : states[spring.bIndex]!.y;
    const bvx = spring.bIndex === null ? 0 : states[spring.bIndex]!.vx;
    const bvy = spring.bIndex === null ? 0 : states[spring.bIndex]!.vy;

    let dx = a.x - bx;
    let dy = a.y - by;
    const distance = Math.hypot(dx, dy);
    if (distance <= EPSILON) continue;
    dx /= distance;
    dy /= distance;

    const stretch = distance - spring.restLength;
    const relativeVelocity = (a.vx - bvx) * dx + (a.vy - bvy) * dy;
    const scalar = spring.stiffness * stretch + spring.damping * relativeVelocity;

    // Force on A points from A toward B when the spring is stretched.
    fx[spring.aIndex]! -= scalar * dx;
    fy[spring.aIndex]! -= scalar * dy;
    if (spring.bIndex !== null) {
      fx[spring.bIndex]! += scalar * dx;
      fy[spring.bIndex]! += scalar * dy;
    }
  }
}

function resolveFloor(body: BodyState, scene: SandboxScene): void {
  if (!scene.hasFloor) return;
  const lowest = body.y - body.radius;
  if (lowest < 0) {
    body.y = body.radius;
    if (body.vy < 0) body.vy = -body.vy * scene.restitution;
  }
}

function resolveCollisions(states: BodyState[], scene: SandboxScene): void {
  if (!scene.collisions) return;
  for (let i = 0; i < states.length; i += 1) {
    for (let j = i + 1; j < states.length; j += 1) {
      const a = states[i]!;
      const b = states[j]!;
      if (a.fixed && b.fixed) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const minimum = a.radius + b.radius;
      if (distance >= minimum || distance <= EPSILON) continue;
      dx /= distance;
      dy /= distance;

      const invA = a.fixed ? 0 : 1 / a.mass;
      const invB = b.fixed ? 0 : 1 / b.mass;
      const invSum = invA + invB;
      if (invSum <= EPSILON) continue;

      // Positional correction removes the overlap along the contact normal.
      const overlap = minimum - distance;
      a.x -= dx * overlap * (invA / invSum);
      a.y -= dy * overlap * (invA / invSum);
      b.x += dx * overlap * (invB / invSum);
      b.y += dy * overlap * (invB / invSum);

      // Impulse resolves the approaching velocity with restitution.
      const relativeNormal = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
      if (relativeNormal >= 0) continue;
      const impulse = (-(1 + scene.restitution) * relativeNormal) / invSum;
      a.vx -= impulse * invA * dx;
      a.vy -= impulse * invA * dy;
      b.vx += impulse * invB * dx;
      b.vy += impulse * invB * dy;
    }
  }
}

function step(
  states: BodyState[],
  springs: SpringLink[],
  scene: SandboxScene,
  dt: number,
  fx: number[],
  fy: number[],
): void {
  accumulateForces(states, springs, scene, fx, fy);
  for (let i = 0; i < states.length; i += 1) {
    const body = states[i]!;
    if (body.fixed) continue;
    body.vx += (fx[i]! / body.mass) * dt;
    body.vy += (fy[i]! / body.mass) * dt;
    if (!Number.isFinite(body.vx) || !Number.isFinite(body.vy)) {
      throw new RangeError("sandbox integration diverged");
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }
  for (const body of states) {
    if (!body.fixed) resolveFloor(body, scene);
  }
  resolveCollisions(states, scene);
}

function snapshot(states: BodyState[], time: number): SandboxFrame {
  return {
    time,
    bodies: states.map((body) => ({
      x: body.x,
      y: body.y,
      vx: body.vx,
      vy: body.vy,
    })),
  };
}

/**
 * Integrate a sandbox scene into a sampled trajectory. Sub-stepped at
 * SUBSTEP_SECONDS for stability, sampled at SAMPLE_HZ for output.
 */
export function simulateSandbox(scene: SandboxScene): SandboxTrajectory {
  assertValidSandbox(scene);
  const states = initialStates(scene);
  const springs = resolveSprings(scene);
  const fx = new Array<number>(states.length).fill(0);
  const fy = new Array<number>(states.length).fill(0);

  const metrics: SandboxMetrics = {
    firstFloorTime: states.map(() => Infinity),
    maxHeight: states.map((body) => body.y),
    maxSpeed: states.map((body) => Math.hypot(body.vx, body.vy)),
    pathLength: states.map(() => 0),
  };
  const previousX = states.map((body) => body.x);
  const previousY = states.map((body) => body.y);

  const recordAfterStep = (time: number): void => {
    for (let i = 0; i < states.length; i += 1) {
      const body = states[i]!;
      if (body.y > metrics.maxHeight[i]!) metrics.maxHeight[i] = body.y;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > metrics.maxSpeed[i]!) metrics.maxSpeed[i] = speed;
      metrics.pathLength[i]! += Math.hypot(
        body.x - previousX[i]!,
        body.y - previousY[i]!,
      );
      previousX[i] = body.x;
      previousY[i] = body.y;
      if (
        scene.hasFloor &&
        metrics.firstFloorTime[i] === Infinity &&
        body.y - body.radius <= 1e-6
      ) {
        metrics.firstFloorTime[i] = time;
      }
    }
  };

  const duration = scene.duration;
  const sampleCount = Math.max(2, Math.round(duration * SAMPLE_HZ) + 1);
  const sampleInterval = duration / (sampleCount - 1);
  const frames: SandboxFrame[] = [snapshot(states, 0)];

  let time = 0;
  for (let sample = 1; sample < sampleCount; sample += 1) {
    const targetTime = sample * sampleInterval;
    let guard = 0;
    while (time < targetTime - EPSILON) {
      const dt = Math.min(SUBSTEP_SECONDS, targetTime - time);
      step(states, springs, scene, dt, fx, fy);
      time += dt;
      recordAfterStep(time);
      guard += 1;
      if (guard > 4_000_000) {
        throw new RangeError("sandbox integration exceeded step limit");
      }
    }
    frames.push(snapshot(states, targetTime));
  }

  return { duration, ids: scene.bodies.map((body) => body.id), frames, metrics };
}

function bodyIndex(scene: SandboxScene, id: string): number {
  const index = scene.bodies.findIndex((body) => body.id === id);
  if (index < 0) throw new RangeError(`sandbox body not found: ${id}`);
  return index;
}

/**
 * Oscillation period of the body along its dominant axis, measured between
 * successive maxima of that coordinate. Infinity when fewer than two maxima
 * are observed (i.e. the motion does not repeat within the run).
 */
function oscillationPeriod(
  trajectory: SandboxTrajectory,
  index: number,
): number {
  const frames = trajectory.frames;
  const xs = frames.map((frame) => frame.bodies[index]!.x);
  const ys = frames.map((frame) => frame.bodies[index]!.y);
  const amplitude = (values: number[]) =>
    Math.max(...values) - Math.min(...values);
  const signal = amplitude(xs) >= amplitude(ys) ? xs : ys;
  if (amplitude(signal) <= EPSILON) return Infinity;

  const peakTimes: number[] = [];
  for (let i = 1; i < signal.length - 1; i += 1) {
    if (signal[i]! > signal[i - 1]! && signal[i]! >= signal[i + 1]!) {
      peakTimes.push(frames[i]!.time);
    }
  }
  if (peakTimes.length < 2) return Infinity;
  let total = 0;
  for (let i = 1; i < peakTimes.length; i += 1) {
    total += peakTimes[i]! - peakTimes[i - 1]!;
  }
  return total / (peakTimes.length - 1);
}

/** Evaluate a metric for one body over a precomputed trajectory. */
export function sandboxMetricValue(
  scene: SandboxScene,
  trajectory: SandboxTrajectory,
  bodyId: string,
  metric: SandboxMetric,
): number {
  const index = bodyIndex(scene, bodyId);
  const frames = trajectory.frames;
  const first = frames[0]!.bodies[index]!;
  const last = frames[frames.length - 1]!.bodies[index]!;

  switch (metric) {
    case "time_to_floor":
      return trajectory.metrics.firstFloorTime[index]!;
    case "max_height":
      return trajectory.metrics.maxHeight[index]!;
    case "final_height":
      return last.y;
    case "max_speed":
      return trajectory.metrics.maxSpeed[index]!;
    case "final_speed":
      return Math.hypot(last.vx, last.vy);
    case "distance_traveled":
      return trajectory.metrics.pathLength[index]!;
    case "horizontal_range":
      return Math.abs(last.x - first.x);
    case "final_x":
      return last.x;
    case "period":
      return oscillationPeriod(trajectory, index);
    default: {
      const exhaustive: never = metric;
      throw new RangeError(`unknown sandbox metric: ${String(exhaustive)}`);
    }
  }
}

export type CompareBodiesOutcome = "a" | "b" | "tie";
export type CompareChangeOutcome = "increase" | "decrease" | "same";

export const SANDBOX_OUTCOME_KEYS = {
  compare_bodies: ["a", "b", "tie"] as const,
  compare_change: ["increase", "decrease", "same"] as const,
};

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(tolerance, EPSILON);
}

/** Deterministic outcome for a compare_bodies rule over one scene. */
export function sandboxCompareBodies(scene: SandboxScene): CompareBodiesOutcome {
  if (scene.outcomeRule.kind !== "compare_bodies") {
    throw new TypeError("scene outcome rule is not compare_bodies");
  }
  const { metric, bodyA, bodyB, comparator, tolerance } = scene.outcomeRule;
  const trajectory = simulateSandbox(scene);
  const valueA = sandboxMetricValue(scene, trajectory, bodyA, metric);
  const valueB = sandboxMetricValue(scene, trajectory, bodyB, metric);
  if (
    (valueA === Infinity && valueB === Infinity) ||
    withinTolerance(valueA, valueB, tolerance)
  ) {
    return "tie";
  }
  const aIsGreater = valueA > valueB;
  if (comparator === "greater") return aIsGreater ? "a" : "b";
  return aIsGreater ? "b" : "a";
}

/** Deterministic outcome for a compare_change rule between two scenes. */
export function sandboxCompareChange(
  before: SandboxScene,
  after: SandboxScene,
): CompareChangeOutcome {
  if (before.outcomeRule.kind !== "compare_change") {
    throw new TypeError("scene outcome rule is not compare_change");
  }
  const { metric, body, tolerance } = before.outcomeRule;
  const beforeValue = sandboxMetricValue(
    before,
    simulateSandbox(before),
    body,
    metric,
  );
  const afterValue = sandboxMetricValue(
    after,
    simulateSandbox(after),
    body,
    metric,
  );
  if (
    (beforeValue === Infinity && afterValue === Infinity) ||
    withinTolerance(beforeValue, afterValue, tolerance)
  ) {
    return "same";
  }
  return afterValue > beforeValue ? "increase" : "decrease";
}

const METRIC_LABEL: Record<SandboxMetric, string> = {
  time_to_floor: "Time to floor",
  max_height: "Peak height",
  final_height: "Final height",
  max_speed: "Peak speed",
  final_speed: "Final speed",
  distance_traveled: "Path length",
  horizontal_range: "Horizontal range",
  final_x: "Final position",
  period: "Oscillation period",
};

const METRIC_UNIT: Record<SandboxMetric, string> = {
  time_to_floor: "s",
  max_height: "m",
  final_height: "m",
  max_speed: "m/s",
  final_speed: "m/s",
  distance_traveled: "m",
  horizontal_range: "m",
  final_x: "m",
  period: "s",
};

function formatMetric(value: number, metric: SandboxMetric): string {
  if (!Number.isFinite(value)) {
    return metric === "time_to_floor"
      ? "never reaches floor"
      : metric === "period"
        ? "no repeat"
        : "—";
  }
  return `${value.toFixed(2)} ${METRIC_UNIT[metric]}`;
}

function evidencePoints(
  scene: SandboxScene,
  trajectory: SandboxTrajectory,
): EvidencePoint[] {
  const target = 48;
  const stride = Math.max(1, Math.floor(trajectory.frames.length / target));
  const hasSecond = scene.bodies.length > 1;
  const points: EvidencePoint[] = [];
  for (let i = 0; i < trajectory.frames.length; i += stride) {
    const frame = trajectory.frames[i]!;
    const first = frame.bodies[0]!;
    const second = hasSecond ? frame.bodies[1]! : undefined;
    points.push({
      time: frame.time,
      primary: first.y,
      secondary: second ? second.y : Math.hypot(first.vx, first.vy),
      primaryVelocity: Math.hypot(first.vx, first.vy),
      secondaryVelocity: second ? Math.hypot(second.vx, second.vy) : undefined,
    });
  }
  const lastFrame = trajectory.frames[trajectory.frames.length - 1]!;
  const lastFirst = lastFrame.bodies[0]!;
  const lastSecond = hasSecond ? lastFrame.bodies[1]! : undefined;
  points.push({
    time: lastFrame.time,
    primary: lastFirst.y,
    secondary: lastSecond
      ? lastSecond.y
      : Math.hypot(lastFirst.vx, lastFirst.vy),
    primaryVelocity: Math.hypot(lastFirst.vx, lastFirst.vy),
    secondaryVelocity: lastSecond
      ? Math.hypot(lastSecond.vx, lastSecond.vy)
      : undefined,
  });
  return points;
}

export interface SandboxEvidenceInput {
  /** Scene actually rendered (already patched for compare_change runs). */
  scene: SandboxScene;
  /** Reference scene for compare_change; undefined for compare_bodies. */
  referenceScene?: SandboxScene;
}

/**
 * Build the full evidence bundle (outcome, duration, summary, headline
 * metrics, chart samples) for a rendered sandbox scene.
 */
export function buildSandboxEvidence(
  input: SandboxEvidenceInput,
): SimulationEvidence {
  const { scene, referenceScene } = input;
  const trajectory = simulateSandbox(scene);
  const rule = scene.outcomeRule;

  if (rule.kind === "compare_bodies") {
    const valueA = sandboxMetricValue(scene, trajectory, rule.bodyA, rule.metric);
    const valueB = sandboxMetricValue(scene, trajectory, rule.bodyB, rule.metric);
    const outcomeKey = sandboxCompareBodies(scene);
    const labelA = scene.bodies.find((body) => body.id === rule.bodyA)?.label ?? rule.bodyA;
    const labelB = scene.bodies.find((body) => body.id === rule.bodyB)?.label ?? rule.bodyB;
    return {
      outcomeKey,
      duration: trajectory.duration,
      summary: `${METRIC_LABEL[rule.metric]} — ${labelA}: ${formatMetric(valueA, rule.metric)}; ${labelB}: ${formatMetric(valueB, rule.metric)}. The deterministic engine compared the measured values; the winning prediction follows from the numbers, not the wording.`,
      metricA: {
        label: `${labelA} · ${METRIC_LABEL[rule.metric]}`,
        value: formatMetric(valueA, rule.metric),
      },
      metricB: {
        label: `${labelB} · ${METRIC_LABEL[rule.metric]}`,
        value: formatMetric(valueB, rule.metric),
      },
      points: evidencePoints(scene, trajectory),
    };
  }

  const body = rule.body;
  const afterValue = sandboxMetricValue(scene, trajectory, body, rule.metric);
  const beforeValue = referenceScene
    ? sandboxMetricValue(
        referenceScene,
        simulateSandbox(referenceScene),
        body,
        rule.metric,
      )
    : afterValue;
  const outcomeKey: CompareChangeOutcome = referenceScene
    ? sandboxCompareChange(referenceScene, scene)
    : "same";
  const label = scene.bodies.find((entry) => entry.id === body)?.label ?? body;
  return {
    outcomeKey,
    duration: trajectory.duration,
    summary: `${METRIC_LABEL[rule.metric]} for ${label} moved from ${formatMetric(beforeValue, rule.metric)} to ${formatMetric(afterValue, rule.metric)} when the single declared variable changed. The engine measured both worlds directly.`,
    metricA: {
      label: `Before · ${METRIC_LABEL[rule.metric]}`,
      value: formatMetric(beforeValue, rule.metric),
    },
    metricB: {
      label: `After · ${METRIC_LABEL[rule.metric]}`,
      value: formatMetric(afterValue, rule.metric),
    },
    points: evidencePoints(scene, trajectory),
  };
}

export { METRIC_LABEL as SANDBOX_METRIC_LABEL, METRIC_UNIT as SANDBOX_METRIC_UNIT };
