import type {
  ExperimentFamily,
  ExperimentParameters,
  ExperimentSpec,
} from "@/lib/ai/contracts/experiment-spec";
import { projectileFlightTime, projectileRange } from "./outcomes";

/**
 * Deterministic trajectory sampling at the spec's fixed timestep, for the 3D
 * renderer. Positions are 2D in the experiment's vertical plane; the
 * renderer maps them into the scene.
 *
 * Coordinate frames (metres):
 * - drop:       origin on the ground below the object; y is height, x = 0.
 * - projectile: origin at the launch point's ground projection; the object
 *               launches from (0, launchHeight) toward +x.
 * - pendulum:   origin at the pivot; y points up, so the bob rests near
 *               (0, -length). The bob starts at the release angle.
 *
 * Drop and projectile use exact kinematics per sample (no integration
 * error); after landing the object stays at its rest position so renderers
 * can play the full window without special-casing the end of motion. The
 * pendulum integrates θ'' = -(g/L)·sin θ with fixed-step RK4 — the schema
 * caps duration/timestep at 20 000 steps, so sampling is always bounded.
 */

export interface TrajectoryPoint {
  /** Simulated time in seconds. */
  t: number;
  x: number;
  y: number;
}

/** Schema invariant (duration/timestep ≤ 20 000) restated as a hard cap. */
const MAX_STEPS = 20_000;

const DEG_TO_RAD = Math.PI / 180;

function timeSamples(duration: number, timestep: number): number[] {
  const steps = Math.min(Math.floor(duration / timestep), MAX_STEPS);
  const times: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    times.push(i * timestep);
  }
  return times;
}

function requirePositiveParameter(
  parameters: ExperimentParameters,
  name: keyof ExperimentParameters,
  family: ExperimentFamily,
): number {
  const value = parameters[name];
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `simulation: parameter "${name}" is required and must be positive for family "${family}"`,
    );
  }
  return value;
}

function dropTrajectory(
  parameters: ExperimentParameters,
  times: number[],
): TrajectoryPoint[] {
  const g = requirePositiveParameter(parameters, "gravity", "drop");
  const h = requirePositiveParameter(parameters, "height", "drop");
  return times.map((t) => ({
    t,
    x: 0,
    y: Math.max(0, h - 0.5 * g * t * t),
  }));
}

function projectileTrajectory(
  parameters: ExperimentParameters,
  times: number[],
): TrajectoryPoint[] {
  const g = requirePositiveParameter(parameters, "gravity", "projectile");
  const speed = requirePositiveParameter(parameters, "initialSpeed", "projectile");
  const angle = parameters.angleDeg;
  if (angle === undefined || !Number.isFinite(angle)) {
    throw new Error(
      'simulation: parameter "angleDeg" is required for family "projectile"',
    );
  }
  const launchHeight = parameters.height ?? 0;
  const vx = speed * Math.cos(angle * DEG_TO_RAD);
  const vy = speed * Math.sin(angle * DEG_TO_RAD);
  const landingTime = projectileFlightTime(speed, angle, g, launchHeight);
  const range = projectileRange(speed, angle, g, launchHeight);
  return times.map((t) => {
    if (t >= landingTime) {
      return { t, x: range, y: 0 };
    }
    return {
      t,
      x: vx * t,
      y: launchHeight + vy * t - 0.5 * g * t * t,
    };
  });
}

function pendulumTrajectory(
  parameters: ExperimentParameters,
  times: number[],
  timestep: number,
): TrajectoryPoint[] {
  const g = requirePositiveParameter(parameters, "gravity", "pendulum");
  const length = requirePositiveParameter(parameters, "length", "pendulum");
  const amplitude = requirePositiveParameter(parameters, "releaseAngleDeg", "pendulum");

  // State: angle from vertical (rad), angular velocity (rad/s).
  let theta = amplitude * DEG_TO_RAD;
  let omega = 0;
  const accel = (angle: number): number => (-g / length) * Math.sin(angle);

  const points: TrajectoryPoint[] = [];
  for (const t of times) {
    points.push({
      t,
      x: length * Math.sin(theta),
      y: -length * Math.cos(theta),
    });
    // Classic RK4 step on (θ, ω).
    const k1t = omega;
    const k1w = accel(theta);
    const k2t = omega + (timestep / 2) * k1w;
    const k2w = accel(theta + (timestep / 2) * k1t);
    const k3t = omega + (timestep / 2) * k2w;
    const k3w = accel(theta + (timestep / 2) * k2t);
    const k4t = omega + timestep * k3w;
    const k4w = accel(theta + timestep * k3t);
    theta += (timestep / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
    omega += (timestep / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
  }
  return points;
}

/**
 * Sample the motion described by a validated spec (optionally with patched
 * parameters, e.g. a counterfactual world). Returns one point per timestep
 * from t = 0 through the simulation duration, inclusive.
 */
export function sampleTrajectory(
  spec: Pick<ExperimentSpec, "family" | "simulation">,
  parameters: ExperimentParameters,
): TrajectoryPoint[] {
  const { duration, timestep } = spec.simulation;
  const times = timeSamples(duration, timestep);
  switch (spec.family) {
    case "drop":
      return dropTrajectory(parameters, times);
    case "projectile":
      return projectileTrajectory(parameters, times);
    case "pendulum":
      return pendulumTrajectory(parameters, times, timestep);
  }
}
