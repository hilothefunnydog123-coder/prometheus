import { describe, expect, it } from "vitest";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import type {
  DropScene,
  PendulumScene,
} from "@/lib/contracts/experiment";
import {
  PROJECTILE_TARGET_RADIUS_METERS,
  determineOutcome,
  projectileMetrics,
  quadraticDragDropTime,
} from "./evidence";
import {
  MAX_SIMULATED_SECONDS,
  applySceneChange,
  dropFallTime,
  expectedOutcomeKey,
  finalizeCorrectness,
  pendulumComparisonOutcome,
  projectileFlight,
  projectileHitTolerance,
  sceneDuration,
} from "./deterministic-outcomes";

function dropScene() {
  if (dropDemo.scene.family !== "drop") throw new Error("drop fixture");
  return structuredClone(dropDemo.scene);
}

function projectileScene() {
  if (projectileDemo.scene.family !== "projectile") {
    throw new Error("projectile fixture");
  }
  return structuredClone(projectileDemo.scene);
}

function pendulumScene() {
  if (pendulumDemo.scene.family !== "pendulum") {
    throw new Error("pendulum fixture");
  }
  return structuredClone(pendulumDemo.scene);
}

describe("AI-to-physics deterministic boundary", () => {
  it("delegates drop and projectile calculations to renderer physics", () => {
    const drop = dropScene();
    const body = drop.objects[0];
    expect(
      dropFallTime(drop.height, drop.gravity, drop.airDensity, body),
    ).toBe(
      quadraticDragDropTime(
        drop.height,
        drop.gravity,
        drop.airDensity,
        body.mass,
        body.radius,
        body.dragCoefficient,
      ),
    );

    const projectile = projectileScene();
    const flight = projectileFlight(projectile);
    const metrics = projectileMetrics(projectile);
    expect(flight).toEqual({
      range: metrics.range,
      flightTime: metrics.flightTime,
    });
  });

  it("uses the rendered target radius instead of a distance-scaled guess", () => {
    expect(projectileHitTolerance(1)).toBe(
      PROJECTILE_TARGET_RADIUS_METERS,
    );
    expect(projectileHitTolerance(100)).toBe(
      PROJECTILE_TARGET_RADIUS_METERS,
    );
    expect(() => projectileHitTolerance(Number.NaN)).toThrow("finite");
    expect(() => projectileHitTolerance(Number.POSITIVE_INFINITY)).toThrow(
      "finite",
    );
  });

  it("uses nonlinear renderer periods for amplitude comparisons", () => {
    const before = pendulumScene();
    before.releaseAngleDegrees = 1;
    before.damping = 0;
    const after = structuredClone(before);
    after.releaseAngleDegrees = 80;
    expect(pendulumComparisonOutcome(before, after)).toBe("period_increases");
    expect(pendulumComparisonOutcome(before, after)).toBe(
      determineOutcome(after, before),
    );
  });

  it("overwrites every model-declared answer without mutating its input", () => {
    const declared = structuredClone(pendulumDemo);
    declared.prediction.correctOutcomeKey = "period_decreases";
    declared.counterfactuals[0]!.prediction.correctOutcomeKey =
      "period_decreases";
    const finalized = finalizeCorrectness(declared);

    expect(finalized.prediction.correctOutcomeKey).toBe("period_unchanged");
    expect(finalized.counterfactuals[0]!.prediction.correctOutcomeKey).toBe(
      "period_increases",
    );
    expect(declared.prediction.correctOutcomeKey).toBe("period_decreases");
  });

  it("makes the rendered counterfactual change authoritative", () => {
    const declared = structuredClone(pendulumDemo);
    declared.counterfactuals[0]!.prediction.testChange = {
      targetPath: "scene.bob.mass",
      value: 12,
    };
    declared.counterfactuals[0]!.prediction.correctOutcomeKey =
      "period_unchanged";

    expect(
      finalizeCorrectness(declared).counterfactuals[0]!.prediction
        .correctOutcomeKey,
    ).toBe("period_increases");
  });

  it("computes outcomes from numeric changes rather than prompt wording", () => {
    const scene = pendulumScene();
    expect(
      expectedOutcomeKey(scene, {
        targetPath: "scene.bob.mass",
        value: 12,
      }),
    ).toBe("period_unchanged");
    expect(
      expectedOutcomeKey(scene, {
        targetPath: "scene.length",
        value: 3.2,
      }),
    ).toBe("period_increases");

    const noTarget = projectileScene();
    delete noTarget.targetDistance;
    expect(expectedOutcomeKey(noTarget)).toBeNull();
  });

  it("applies one finite, in-contract numeric scene change", () => {
    const scene = pendulumScene();
    const changed = applySceneChange(scene, "scene.length", 3.2);
    expect(changed).not.toBe(scene);
    expect((changed as PendulumScene).length).toBe(3.2);
    expect(scene.length).toBe(1.8);

    expect(() =>
      applySceneChange(scene, "scene.length", scene.length),
    ).toThrow("exactly one");
    expect(() =>
      applySceneChange(scene, "scene.length", Number.NaN),
    ).toThrow("finite");
    expect(() =>
      applySceneChange(scene, "scene.length", Number.POSITIVE_INFINITY),
    ).toThrow("finite");
    expect(() => applySceneChange(scene, "scene.length", 0)).toThrow(
      "contract bounds",
    );
    expect(() =>
      applySceneChange(scene, "scene.__proto__.length", 2),
    ).toThrow("invalid");
    expect(() => applySceneChange(scene, "scene.family", 2)).toThrow(
      "numeric",
    );
  });

  it("supports all maximum contract values within solver safeguards", () => {
    const drop = dropScene();
    drop.gravity = 0.5;
    drop.height = 20;
    drop.airDensity = 2;
    drop.objects = drop.objects.map((body) => ({
      ...body,
      mass: 0.05,
      radius: 2,
      dragCoefficient: 2.5,
    })) as DropScene["objects"];

    const projectile = projectileScene();
    projectile.gravity = 0.5;
    projectile.launch = { speed: 40, angleDegrees: 80, height: 20 };
    projectile.object = {
      ...projectile.object,
      mass: 0.05,
      radius: 2,
      dragCoefficient: 2.5,
    };
    projectile.targetDistance = 100;

    const pendulum = pendulumScene();
    pendulum.gravity = 0.5;
    pendulum.length = 10;
    pendulum.releaseAngleDegrees = 80;
    pendulum.damping = 2;
    pendulum.bob = {
      ...pendulum.bob,
      mass: 100,
      radius: 2,
      dragCoefficient: 2.5,
    };

    for (const scene of [drop, projectile, pendulum] as const) {
      const duration = sceneDuration(scene);
      expect(duration).not.toBeNull();
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(MAX_SIMULATED_SECONDS);
    }
  });

  it("preserves the canonical scene types after a valid update", () => {
    expect(
      applySceneChange(
        dropScene(),
        "scene.objects.0.mass",
        99,
      ).family,
    ).toBe("drop");
    expect(
      applySceneChange(
        projectileScene(),
        "scene.launch.speed",
        39,
      ).family,
    ).toBe("projectile");
    expect(
      applySceneChange(pendulumScene(), "scene.gravity", 24).family,
    ).toBe("pendulum");
  });
});
