import { describe, expect, it } from "vitest";
import { dropFixture } from "@/lib/fixtures/drop";
import { pendulumFixture } from "@/lib/fixtures/pendulum";
import { projectileFixture } from "@/lib/fixtures/projectile";
import {
  computeOutcomes,
  dropFallTime,
  dropImpactSpeed,
  pendulumMaxSpeed,
  pendulumPeriod,
  pendulumSmallAnglePeriod,
  projectileFlightTime,
  projectileMaxHeight,
  projectileRange,
} from "./outcomes";

const G = 9.81;

describe("drop outcomes", () => {
  it("matches sqrt(2h/g) for the fall time", () => {
    expect(dropFallTime(20, G)).toBeCloseTo(Math.sqrt(40 / G), 12);
  });

  it("impact speed equals g times the fall time", () => {
    const t = dropFallTime(20, G);
    expect(dropImpactSpeed(20, G)).toBeCloseTo(G * t, 12);
  });

  it("doubling the height multiplies fall time by sqrt(2)", () => {
    expect(dropFallTime(40, G) / dropFallTime(20, G)).toBeCloseTo(
      Math.SQRT2,
      12,
    );
  });

  it("is independent of mass by construction", () => {
    const light = computeOutcomes("drop", { gravity: G, height: 20, mass: 1 });
    const heavy = computeOutcomes("drop", {
      gravity: G,
      height: 20,
      mass: 1000,
    });
    expect(light.metrics).toEqual(heavy.metrics);
  });
});

describe("projectile outcomes", () => {
  it("matches 2·v·sin(θ)/g for ground-level flight time", () => {
    expect(projectileFlightTime(20, 45, G)).toBeCloseTo(
      (2 * 20 * Math.sin(Math.PI / 4)) / G,
      12,
    );
  });

  it("matches v²·sin(2θ)/g for ground-level range", () => {
    expect(projectileRange(20, 30, G)).toBeCloseTo(
      (400 * Math.sin(Math.PI / 3)) / G,
      10,
    );
  });

  it("gives complementary angles the same range", () => {
    expect(projectileRange(20, 30, G)).toBeCloseTo(
      projectileRange(20, 60, G),
      10,
    );
  });

  it("maximizes range at 45 degrees", () => {
    const r45 = projectileRange(20, 45, G);
    expect(r45).toBeGreaterThan(projectileRange(20, 30, G));
    expect(r45).toBeGreaterThan(projectileRange(20, 60, G));
  });

  it("launching from a height increases flight time and range", () => {
    expect(projectileFlightTime(20, 45, G, 10)).toBeGreaterThan(
      projectileFlightTime(20, 45, G),
    );
    expect(projectileRange(20, 45, G, 10)).toBeGreaterThan(
      projectileRange(20, 45, G),
    );
  });

  it("peak height is launch height plus vy²/2g", () => {
    const vy = 20 * Math.sin(Math.PI / 3);
    expect(projectileMaxHeight(20, 60, G, 5)).toBeCloseTo(
      5 + (vy * vy) / (2 * G),
      12,
    );
  });
});

describe("pendulum outcomes", () => {
  it("reduces to 2π·sqrt(L/g) at tiny amplitudes", () => {
    const exact = pendulumPeriod(2, G, 0.5);
    const smallAngle = pendulumSmallAnglePeriod(2, G);
    expect(Math.abs(exact - smallAngle) / smallAngle).toBeLessThan(1e-4);
  });

  it("runs ~7% slower than the small-angle formula at 60 degrees", () => {
    const ratio = pendulumPeriod(1, G, 60) / pendulumSmallAnglePeriod(1, G);
    // Known value of K(sin 30°)·2/π ≈ 1.0732.
    expect(ratio).toBeGreaterThan(1.07);
    expect(ratio).toBeLessThan(1.08);
  });

  it("scales with sqrt(L) and 1/sqrt(g)", () => {
    expect(pendulumPeriod(4, G, 10) / pendulumPeriod(1, G, 10)).toBeCloseTo(
      2,
      10,
    );
    expect(
      pendulumPeriod(1, G / 4, 10) / pendulumPeriod(1, G, 10),
    ).toBeCloseTo(2, 10);
  });

  it("max speed follows energy conservation", () => {
    const theta = (15 * Math.PI) / 180;
    expect(pendulumMaxSpeed(2, G, 15)).toBeCloseTo(
      Math.sqrt(2 * G * 2 * (1 - Math.cos(theta))),
      12,
    );
  });

  it("is independent of mass by construction", () => {
    const light = computeOutcomes("pendulum", {
      gravity: G,
      length: 2,
      releaseAngleDeg: 15,
      mass: 1,
    });
    const heavy = computeOutcomes("pendulum", {
      gravity: G,
      length: 2,
      releaseAngleDeg: 15,
      mass: 500,
    });
    expect(light.metrics).toEqual(heavy.metrics);
  });
});

describe("computeOutcomes", () => {
  it("produces finite positive metrics for every golden fixture", () => {
    for (const fixture of [dropFixture, projectileFixture, pendulumFixture]) {
      const outcome = computeOutcomes(fixture.family, fixture.parameters);
      expect(outcome.family).toBe(fixture.family);
      expect(outcome.metrics.length).toBeGreaterThanOrEqual(2);
      for (const metric of outcome.metrics) {
        expect(Number.isFinite(metric.value)).toBe(true);
        expect(metric.value).toBeGreaterThan(0);
        expect(metric.unit.length).toBeGreaterThan(0);
      }
    }
  });

  it("throws a descriptive error on a missing required parameter", () => {
    expect(() => computeOutcomes("drop", { gravity: G })).toThrow(/height/);
    expect(() =>
      computeOutcomes("projectile", { gravity: G, angleDeg: 45 }),
    ).toThrow(/initialSpeed/);
    expect(() =>
      computeOutcomes("pendulum", { gravity: G, length: 2 }),
    ).toThrow(/releaseAngleDeg/);
  });

  it("throws on non-positive gravity instead of returning NaN", () => {
    expect(() =>
      computeOutcomes("drop", { gravity: 0, height: 20 }),
    ).toThrow(/gravity/);
  });
});
