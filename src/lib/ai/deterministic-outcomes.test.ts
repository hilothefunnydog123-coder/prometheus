import { describe, expect, it } from "vitest";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import {
  MAX_SIMULATED_SECONDS,
  finalizeCorrectness,
  pendulumComparisonOutcome,
  projectileHitTolerance,
  sceneDuration,
} from "./deterministic-outcomes";
import { PROJECTILE_TARGET_RADIUS_METERS } from "@/lib/physics/evidence";

describe("AI deterministic physics boundary", () => {
  it("uses the renderer's fixed target radius for projectile hits", () => {
    expect(projectileHitTolerance(1)).toBe(PROJECTILE_TARGET_RADIUS_METERS);
    expect(projectileHitTolerance(100)).toBe(PROJECTILE_TARGET_RADIUS_METERS);
  });

  it("uses nonlinear and damped renderer semantics for pendulums", () => {
    if (pendulumDemo.scene.family !== "pendulum") {
      throw new Error("invalid pendulum fixture");
    }
    const before = structuredClone(pendulumDemo.scene);
    before.releaseAngleDegrees = 1;
    before.damping = 0;
    const after = structuredClone(before);
    after.releaseAngleDegrees = 80;
    after.damping = 2;

    expect(pendulumComparisonOutcome(before, after)).not.toBe(
      "period_unchanged",
    );
  });

  it("supports contract-valid scenes up to the solver safeguard", () => {
    for (const fixture of [dropDemo, projectileDemo, pendulumDemo]) {
      const duration = sceneDuration(fixture.scene);
      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(MAX_SIMULATED_SECONDS);
    }
    expect(MAX_SIMULATED_SECONDS).toBe(3_600);
  });

  it("overwrites model-declared correctness from canonical physics", () => {
    const tampered = structuredClone(dropDemo);
    tampered.prediction.correctOutcomeKey = "object_a_first";
    tampered.counterfactuals[0]!.prediction.correctOutcomeKey = "tie";

    const finalized = finalizeCorrectness(tampered);
    expect(finalized.prediction.correctOutcomeKey).toBe("tie");
    expect(finalized.counterfactuals[0]!.prediction.correctOutcomeKey).toBe(
      "object_a_first",
    );
  });
});
