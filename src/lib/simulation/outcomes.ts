import type {
  ExperimentFamily,
  ExperimentParameters,
} from "@/lib/ai/contracts/experiment-spec";

/**
 * Deterministic closed-form outcomes for every experiment family.
 *
 * Pure math, no I/O, safe for both server and client bundles. The renderer
 * (Contributor A) can use these to display "what actually happened" numbers
 * next to the 3D scene, and the counterfactual module diffs them to show the
 * learner which quantities a patch really moved.
 *
 * All formulas are the ideal-physics ground truth for the families we model
 * (no drag, rigid rod / inextensible string). The pendulum period uses the
 * exact large-amplitude correction — see {@link pendulumPeriod} — because the
 * schema allows release angles up to 60°, where the small-angle formula is
 * ~7% off.
 */

export interface OutcomeMetric {
  /** Stable slug, e.g. "fall-time"; safe to key UI elements on. */
  id: string;
  /** Human-readable label, plain text. */
  label: string;
  value: number;
  /** SI unit, e.g. "s", "m", "m/s". */
  unit: string;
}

export interface ExperimentOutcome {
  family: ExperimentFamily;
  metrics: OutcomeMetric[];
}

const DEG_TO_RAD = Math.PI / 180;

function requireParameter(
  parameters: ExperimentParameters,
  name: keyof ExperimentParameters,
  family: ExperimentFamily,
): number {
  const value = parameters[name];
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(
      `simulation: parameter "${name}" is required for family "${family}"`,
    );
  }
  return value;
}

function requirePositive(value: number, name: string): number {
  if (value <= 0) {
    throw new Error(`simulation: parameter "${name}" must be positive`);
  }
  return value;
}

/** Time for an object dropped from rest at height h to reach the ground. */
export function dropFallTime(height: number, gravity: number): number {
  return Math.sqrt((2 * height) / gravity);
}

/** Speed at ground impact for a drop from rest (independent of mass). */
export function dropImpactSpeed(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * height);
}

/**
 * Flight time of a projectile launched at `speed` and `angleDeg` from
 * `launchHeight` above the ground, until it returns to ground level.
 */
export function projectileFlightTime(
  speed: number,
  angleDeg: number,
  gravity: number,
  launchHeight = 0,
): number {
  const vy = speed * Math.sin(angleDeg * DEG_TO_RAD);
  return (vy + Math.sqrt(vy * vy + 2 * gravity * launchHeight)) / gravity;
}

/** Horizontal distance covered when the projectile lands. */
export function projectileRange(
  speed: number,
  angleDeg: number,
  gravity: number,
  launchHeight = 0,
): number {
  const vx = speed * Math.cos(angleDeg * DEG_TO_RAD);
  return vx * projectileFlightTime(speed, angleDeg, gravity, launchHeight);
}

/** Peak height above the ground reached along the trajectory. */
export function projectileMaxHeight(
  speed: number,
  angleDeg: number,
  gravity: number,
  launchHeight = 0,
): number {
  const vy = speed * Math.sin(angleDeg * DEG_TO_RAD);
  return launchHeight + (vy * vy) / (2 * gravity);
}

/**
 * Exact period of an ideal pendulum released from rest at `amplitudeDeg`.
 *
 * T = 2π·sqrt(L/g) / AGM(1, cos(θ₀/2)) — the arithmetic–geometric-mean form
 * of the complete elliptic integral K(sin(θ₀/2)). Converges quadratically;
 * a handful of iterations reaches double precision for any amplitude the
 * schema allows (≤ 60°). At small amplitudes AGM(1, cos(θ₀/2)) → 1 and this
 * reduces to the familiar 2π·sqrt(L/g).
 */
export function pendulumPeriod(
  length: number,
  gravity: number,
  amplitudeDeg: number,
): number {
  let a = 1;
  let b = Math.cos((amplitudeDeg * DEG_TO_RAD) / 2);
  while (Math.abs(a - b) > 1e-15) {
    const nextA = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = nextA;
  }
  return (2 * Math.PI * Math.sqrt(length / gravity)) / a;
}

/** Small-angle approximation 2π·sqrt(L/g); kept for teaching comparisons. */
export function pendulumSmallAnglePeriod(
  length: number,
  gravity: number,
): number {
  return 2 * Math.PI * Math.sqrt(length / gravity);
}

/** Bob speed at the lowest point, from energy conservation. */
export function pendulumMaxSpeed(
  length: number,
  gravity: number,
  amplitudeDeg: number,
): number {
  return Math.sqrt(
    2 * gravity * length * (1 - Math.cos(amplitudeDeg * DEG_TO_RAD)),
  );
}

/**
 * All headline metrics for one experiment configuration.
 *
 * Expects parameters that already passed validateExperimentSpec (or a
 * fixture); throws a descriptive Error on missing/non-positive required
 * parameters rather than producing NaNs.
 */
export function computeOutcomes(
  family: ExperimentFamily,
  parameters: ExperimentParameters,
): ExperimentOutcome {
  switch (family) {
    case "drop": {
      const g = requirePositive(
        requireParameter(parameters, "gravity", family),
        "gravity",
      );
      const h = requirePositive(
        requireParameter(parameters, "height", family),
        "height",
      );
      return {
        family,
        metrics: [
          {
            id: "fall-time",
            label: "Time to hit the ground",
            value: dropFallTime(h, g),
            unit: "s",
          },
          {
            id: "impact-speed",
            label: "Speed at impact",
            value: dropImpactSpeed(h, g),
            unit: "m/s",
          },
        ],
      };
    }
    case "projectile": {
      const g = requirePositive(
        requireParameter(parameters, "gravity", family),
        "gravity",
      );
      const speed = requirePositive(
        requireParameter(parameters, "initialSpeed", family),
        "initialSpeed",
      );
      const angle = requireParameter(parameters, "angleDeg", family);
      const launchHeight = parameters.height ?? 0;
      if (launchHeight < 0) {
        throw new Error(`simulation: parameter "height" must not be negative`);
      }
      return {
        family,
        metrics: [
          {
            id: "flight-time",
            label: "Time in the air",
            value: projectileFlightTime(speed, angle, g, launchHeight),
            unit: "s",
          },
          {
            id: "range",
            label: "Horizontal distance",
            value: projectileRange(speed, angle, g, launchHeight),
            unit: "m",
          },
          {
            id: "max-height",
            label: "Peak height",
            value: projectileMaxHeight(speed, angle, g, launchHeight),
            unit: "m",
          },
        ],
      };
    }
    case "pendulum": {
      const g = requirePositive(
        requireParameter(parameters, "gravity", family),
        "gravity",
      );
      const length = requirePositive(
        requireParameter(parameters, "length", family),
        "length",
      );
      const amplitude = requirePositive(
        requireParameter(parameters, "releaseAngleDeg", family),
        "releaseAngleDeg",
      );
      return {
        family,
        metrics: [
          {
            id: "period",
            label: "Time of one full swing",
            value: pendulumPeriod(length, g, amplitude),
            unit: "s",
          },
          {
            id: "max-speed",
            label: "Speed at the lowest point",
            value: pendulumMaxSpeed(length, g, amplitude),
            unit: "m/s",
          },
        ],
      };
    }
  }
}
