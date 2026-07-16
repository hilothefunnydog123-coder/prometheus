import { describe, expect, it } from "vitest";
import { dropFixture } from "@/lib/fixtures/drop";
import { pendulumFixture } from "@/lib/fixtures/pendulum";
import { projectileFixture } from "@/lib/fixtures/projectile";
import {
  dropFallTime,
  pendulumPeriod,
  projectileMaxHeight,
  projectileRange,
} from "./outcomes";
import { sampleTrajectory } from "./trajectory";

describe("sampleTrajectory", () => {
  it("returns one point per timestep, inclusive of t = 0", () => {
    const { duration, timestep } = dropFixture.simulation;
    const points = sampleTrajectory(dropFixture, dropFixture.parameters);
    expect(points.length).toBe(Math.floor(duration / timestep) + 1);
    expect(points[0]!.t).toBe(0);
    const last = points[points.length - 1]!;
    expect(last.t).toBeLessThanOrEqual(duration);
  });

  it("drop: starts at the release height and never rises", () => {
    const points = sampleTrajectory(dropFixture, dropFixture.parameters);
    expect(points[0]!.y).toBeCloseTo(dropFixture.parameters.height!, 12);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!.y).toBeLessThanOrEqual(points[i - 1]!.y + 1e-12);
      expect(points[i]!.x).toBe(0);
    }
  });

  it("drop: rests on the ground after the analytic fall time", () => {
    const { gravity, height } = dropFixture.parameters;
    const fallTime = dropFallTime(height!, gravity!);
    const points = sampleTrajectory(dropFixture, dropFixture.parameters);
    for (const p of points) {
      if (p.t > fallTime) expect(p.y).toBe(0);
      else expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("projectile: launches from the origin and lands at the analytic range", () => {
    const { gravity, initialSpeed, angleDeg } = projectileFixture.parameters;
    const range = projectileRange(initialSpeed!, angleDeg!, gravity!);
    const points = sampleTrajectory(
      projectileFixture,
      projectileFixture.parameters,
    );
    expect(points[0]!.x).toBe(0);
    expect(points[0]!.y).toBe(0);
    const last = points[points.length - 1]!;
    expect(last.x).toBeCloseTo(range, 10);
    expect(last.y).toBe(0);
  });

  it("projectile: peak sampled height matches the analytic max height", () => {
    const { gravity, initialSpeed, angleDeg } = projectileFixture.parameters;
    const maxHeight = projectileMaxHeight(initialSpeed!, angleDeg!, gravity!);
    const points = sampleTrajectory(
      projectileFixture,
      projectileFixture.parameters,
    );
    const peak = Math.max(...points.map((p) => p.y));
    // The true apex can fall between samples; one timestep of slack.
    expect(peak).toBeLessThanOrEqual(maxHeight + 1e-9);
    expect(maxHeight - peak).toBeLessThan(0.05);
  });

  it("pendulum: the bob stays on the string (|p| = L) at every sample", () => {
    const L = pendulumFixture.parameters.length!;
    const points = sampleTrajectory(
      pendulumFixture,
      pendulumFixture.parameters,
    );
    for (const p of points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(L, 12);
    }
  });

  it("pendulum: returns to the release point after one exact period", () => {
    const { gravity, length, releaseAngleDeg } = pendulumFixture.parameters;
    const period = pendulumPeriod(length!, gravity!, releaseAngleDeg!);
    const points = sampleTrajectory(
      pendulumFixture,
      pendulumFixture.parameters,
    );
    const nearPeriod = points.reduce((best, p) =>
      Math.abs(p.t - period) < Math.abs(best.t - period) ? p : best,
    );
    // Within a timestep of the period the bob should be within ~1% of L of
    // its starting position — this checks RK4 against the AGM period.
    expect(Math.hypot(nearPeriod.x - points[0]!.x, nearPeriod.y - points[0]!.y)).toBeLessThan(
      0.01 * length!,
    );
  });

  it("pendulum: conserves energy across the whole window", () => {
    const { gravity } = pendulumFixture.parameters;
    const points = sampleTrajectory(
      pendulumFixture,
      pendulumFixture.parameters,
    );
    // Potential energy per unit mass at each sample, measured from the
    // pivot: g·y. Velocity is not sampled, so check the swing never rises
    // above its release height (which integration error would cause).
    const releaseY = points[0]!.y;
    for (const p of points) {
      expect(gravity! * p.y).toBeLessThanOrEqual(gravity! * releaseY + 1e-9);
    }
  });

  it("throws a descriptive error on missing parameters", () => {
    expect(() =>
      sampleTrajectory(dropFixture, { gravity: 9.81 }),
    ).toThrow(/height/);
    expect(() =>
      sampleTrajectory(pendulumFixture, { gravity: 9.81, length: 2 }),
    ).toThrow(/releaseAngleDeg/);
  });
});
