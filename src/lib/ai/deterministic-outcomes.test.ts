import { describe, expect, it } from "vitest";
import type {
  DropScene,
  PendulumScene,
  ProjectileScene,
} from "@/lib/contracts/experiment";
import {
  dropFallTime,
  dropOutcome,
  expectedOutcomeKey,
  finalizeCorrectness,
  pendulumComparisonOutcome,
  projectileFlight,
  projectileHitTolerance,
  projectileOutcome,
  sceneDuration,
} from "./deterministic-outcomes";
import {
  dropDemo as dropFixture,
  pendulumDemo as pendulumFixture,
} from "@/components/lab/demo-experiments";
import { determineOutcome } from "@/lib/physics/evidence";

const body = (overrides: Partial<DropScene["objects"][0]> = {}) => ({
  id: "a",
  mass: 1,
  radius: 0.4,
  dragCoefficient: 0.47,
  color: "#ff8a3d",
  ...overrides,
});

function dropScene(overrides: Partial<DropScene> = {}): DropScene {
  return {
    family: "drop",
    gravity: 9.81,
    height: 8,
    airDensity: 0,
    objects: [body({ id: "a", mass: 8 }), body({ id: "b", mass: 1 })],
    ...overrides,
  };
}

function projectileScene(overrides: {
  speed?: number;
  angleDegrees?: number;
  height?: number;
  gravity?: number;
  dragCoefficient?: number;
  targetDistance?: number;
} = {}): ProjectileScene {
  return {
    family: "projectile",
    gravity: overrides.gravity ?? 9.81,
    launch: {
      speed: overrides.speed ?? 15,
      angleDegrees: overrides.angleDegrees ?? 45,
      height: overrides.height ?? 1,
    },
    object: {
      id: "ball",
      mass: 1,
      radius: 0.32,
      dragCoefficient: overrides.dragCoefficient ?? 0,
      color: "#ff8a3d",
    },
    targetDistance: overrides.targetDistance ?? 18,
  };
}

function pendulumScene(overrides: Partial<PendulumScene> = {}): PendulumScene {
  return {
    family: "pendulum",
    gravity: 9.81,
    length: 1.8,
    releaseAngleDegrees: 35,
    damping: 0.08,
    bob: body({ id: "bob", mass: 2, radius: 0.42 }),
    ...overrides,
  };
}

describe("drop outcomes", () => {
  it("uses the renderer's exact outcome semantics", () => {
    for (const scene of [
      dropScene(),
      dropScene({ airDensity: 1.2 }),
      dropScene({
        airDensity: 1.2,
        objects: [body({ mass: 1 }), body({ mass: 8 })],
      }),
    ]) {
      expect(dropOutcome(scene)).toBe(determineOutcome(scene));
    }
  });
  it("vacuum fall time is the analytic sqrt(2h/g)", () => {
    expect(dropFallTime(8, 9.81, 0, body())).toBeCloseTo(
      Math.sqrt(16 / 9.81),
      10,
    );
  });

  it("no drag: different masses land together (tie)", () => {
    expect(dropOutcome(dropScene())).toBe("tie");
  });

  it("with drag: the heavier same-size object lands first", () => {
    expect(dropOutcome(dropScene({ airDensity: 1.2 }))).toBe("object_a_first");
  });

  it("with drag: swapping the masses flips the outcome", () => {
    expect(
      dropOutcome(
        dropScene({
          airDensity: 1.2,
          objects: [body({ id: "a", mass: 1 }), body({ id: "b", mass: 8 })],
        }),
      ),
    ).toBe("object_b_first");
  });

  it("with drag: a larger same-mass object lands later", () => {
    expect(
      dropOutcome(
        dropScene({
          airDensity: 1.2,
          objects: [
            body({ id: "a", mass: 2, radius: 1.2 }),
            body({ id: "b", mass: 2, radius: 0.2 }),
          ],
        }),
      ),
    ).toBe("object_b_first");
  });

  it("drag integration is deterministic across runs", () => {
    const scene = dropScene({ airDensity: 1.2 });
    const first = dropFallTime(scene.height, scene.gravity, scene.airDensity, scene.objects[1]);
    const second = dropFallTime(scene.height, scene.gravity, scene.airDensity, scene.objects[1]);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(Math.sqrt(16 / 9.81)); // drag slows the fall
  });
});

describe("projectile outcomes", () => {
  it("uses the renderer's exact outcome semantics", () => {
    for (const scene of [
      projectileScene(),
      projectileScene({ angleDegrees: 22 }),
      projectileScene({ dragCoefficient: 0.47 }),
    ]) {
      expect(projectileOutcome(scene)).toBe(determineOutcome(scene));
    }
  });
  it("matches the analytic range without drag", () => {
    const flight = projectileFlight(projectileScene());
    const vy = 15 * Math.SQRT1_2;
    const t = (vy + Math.sqrt(vy * vy + 2 * 9.81 * 1)) / 9.81;
    expect(flight!.flightTime).toBeCloseTo(t, 10);
    expect(flight!.range).toBeCloseTo(15 * Math.SQRT1_2 * t, 10);
  });

  it("classifies overshoot / hit / undershoot around the tolerance", () => {
    // Analytic range for the base scene is ≈ 23.90 m.
    expect(projectileOutcome(projectileScene({ targetDistance: 18 }))).toBe(
      "overshoot",
    );
    expect(projectileOutcome(projectileScene({ targetDistance: 23.5 }))).toBe(
      "hit",
    );
    expect(projectileOutcome(projectileScene({ targetDistance: 30 }))).toBe(
      "undershoot",
    );
  });

  it("applies the max(0.8 m, 5.5%) hit tolerance at the boundary", () => {
    expect(projectileHitTolerance(10)).toBe(0.8);
    expect(projectileHitTolerance(100)).toBeCloseTo(5.5, 10);

    const range = projectileFlight(projectileScene())!.range;
    // Place the target just inside vs just outside the tolerance window.
    const insideTarget = range / 1.054; // |range - t| ≈ 0.0512·t < 0.055·t
    const outsideTarget = range / 1.06; // |range - t| = 0.06·t > tolerance
    expect(
      projectileOutcome(projectileScene({ targetDistance: insideTarget })),
    ).toBe("hit");
    expect(
      projectileOutcome(projectileScene({ targetDistance: outsideTarget })),
    ).toBe("overshoot");
  });

  it("the 22° counterfactual of the fixture hits the 18 m target", () => {
    expect(
      projectileOutcome(projectileScene({ angleDegrees: 22 })),
    ).toBe("hit");
  });

  it("drag shortens the range deterministically", () => {
    const noDrag = projectileFlight(projectileScene())!.range;
    const withDrag = projectileFlight(
      projectileScene({ dragCoefficient: 0.47 }),
    )!.range;
    const withDragAgain = projectileFlight(
      projectileScene({ dragCoefficient: 0.47 }),
    )!.range;
    expect(withDrag).toBeLessThan(noDrag);
    expect(withDrag).toBe(withDragAgain);
  });

  it("returns null without a targetDistance", () => {
    const scene = projectileScene();
    delete (scene as { targetDistance?: number }).targetDistance;
    expect(projectileOutcome(scene)).toBeNull();
  });
});

describe("pendulum outcomes", () => {
  it("mass changes leave the period unchanged", () => {
    const before = pendulumScene();
    const after = pendulumScene({ bob: { ...before.bob, mass: 12 } });
    expect(pendulumComparisonOutcome(before, after)).toBe("period_unchanged");
  });

  it("longer string increases the period; shorter decreases it", () => {
    const before = pendulumScene();
    expect(
      pendulumComparisonOutcome(before, pendulumScene({ length: 3.2 })),
    ).toBe("period_increases");
    expect(
      pendulumComparisonOutcome(before, pendulumScene({ length: 0.9 })),
    ).toBe("period_decreases");
  });

  it("weaker gravity increases the period; stronger decreases it", () => {
    const before = pendulumScene();
    expect(
      pendulumComparisonOutcome(before, pendulumScene({ gravity: 1.62 })),
    ).toBe("period_increases");
    expect(
      pendulumComparisonOutcome(before, pendulumScene({ gravity: 24 })),
    ).toBe("period_decreases");
  });

  it("damping and release angle do not change the (small-angle) period", () => {
    const before = pendulumScene();
    expect(
      pendulumComparisonOutcome(before, pendulumScene({ damping: 1.5 })),
    ).toBe("period_unchanged");
    expect(
      pendulumComparisonOutcome(
        before,
        pendulumScene({ releaseAngleDegrees: 10 }),
      ),
    ).toBe("period_unchanged");
  });
});

describe("expectedOutcomeKey", () => {
  it("evaluates drop/projectile on the observed world", () => {
    expect(expectedOutcomeKey(dropScene())).toBe("tie");
    expect(
      expectedOutcomeKey(dropScene(), {
        targetPath: "scene.airDensity",
        value: 1.2,
      }),
    ).toBe("object_a_first");
  });

  it("requires a declarative change for pendulum questions", () => {
    expect(expectedOutcomeKey(pendulumScene())).toBeNull();
    expect(
      expectedOutcomeKey(pendulumScene(), {
        targetPath: "scene.bob.mass",
        value: 12,
      }),
    ).toBe("period_unchanged");
  });
});

describe("sceneDuration", () => {
  it("stays under 20 s for all golden fixtures", () => {
    expect(sceneDuration(dropFixture.scene)).toBeLessThanOrEqual(20);
    expect(sceneDuration(pendulumFixture.scene)).toBeLessThanOrEqual(20);
  });

  it("returns null when extreme drag prevents landing within 20 s", () => {
    const floaty = dropScene({
      airDensity: 2,
      height: 20,
      objects: [
        body({ id: "a", mass: 0.05, radius: 2, dragCoefficient: 2.5 }),
        body({ id: "b", mass: 8 }),
      ],
    });
    expect(sceneDuration(floaty)).toBeNull();
  });
});

describe("finalizeCorrectness", () => {
  it("overwrites a wrong model-declared correctOutcomeKey", () => {
    const tampered = structuredClone(dropFixture);
    tampered.prediction.correctOutcomeKey = "object_a_first"; // wrong: it's a tie
    tampered.counterfactuals[0]!.prediction.correctOutcomeKey = "tie"; // wrong
    const finalized = finalizeCorrectness(tampered);
    expect(finalized.prediction.correctOutcomeKey).toBe("tie");
    expect(finalized.counterfactuals[0]!.prediction.correctOutcomeKey).toBe(
      "object_a_first",
    );
  });

  it("computes every fixture's declared keys exactly", () => {
    expect(finalizeCorrectness(dropFixture)).toEqual(dropFixture);
    expect(finalizeCorrectness(pendulumFixture)).toEqual(pendulumFixture);
  });
});
