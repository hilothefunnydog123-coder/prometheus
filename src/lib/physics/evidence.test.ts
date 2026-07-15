import { describe, expect, it } from "vitest";
import type {
  CounterfactualSpec,
  DropScene,
  ExperimentSpec,
  PendulumScene,
  ProjectileScene,
  SceneSpec,
} from "@/lib/contracts/experiment";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import {
  DROP_TIE_TOLERANCE_SECONDS,
  PENDULUM_PERIOD_RELATIVE_TOLERANCE,
  PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER,
  PROJECTILE_TARGET_RADIUS_METERS,
  applyCounterfactual,
  buildEvidence,
  classifyDropImpactTimes,
  classifyPendulumPeriods,
  classifyProjectileRange,
  determineOutcome,
  pendulumPeriod,
  projectileMetrics,
  quadraticDragDropTime,
  undampedPendulumPeriod,
  updateScenePath,
  vacuumDropTime,
} from "./evidence";

function dropScene(): DropScene {
  if (dropDemo.scene.family !== "drop") {
    throw new Error("drop fixture must use the drop scene");
  }
  return structuredClone(dropDemo.scene);
}

function projectileScene(): ProjectileScene {
  if (projectileDemo.scene.family !== "projectile") {
    throw new Error("projectile fixture must use the projectile scene");
  }
  return structuredClone(projectileDemo.scene);
}

function pendulumScene(): PendulumScene {
  if (pendulumDemo.scene.family !== "pendulum") {
    throw new Error("pendulum fixture must use the pendulum scene");
  }
  return structuredClone(pendulumDemo.scene);
}

function relativeError(actual: number, expected: number) {
  return Math.abs(actual - expected) / Math.abs(expected);
}

function expectWithinTwoPercent(actual: number, expected: number) {
  expect(relativeError(actual, expected)).toBeLessThanOrEqual(0.02);
}

function expectFiniteEvidence(spec: ExperimentSpec) {
  const evidence = buildEvidence(spec);
  expect(Number.isFinite(evidence.duration)).toBe(true);
  expect(evidence.duration).toBeGreaterThan(0);
  expect(evidence.points.length).toBeGreaterThan(1);
  for (const point of evidence.points) {
    expect(Number.isFinite(point.time)).toBe(true);
    expect(Number.isFinite(point.primary)).toBe(true);
    if (point.secondary !== undefined) {
      expect(Number.isFinite(point.secondary)).toBe(true);
    }
    if (point.tertiary !== undefined) {
      expect(Number.isFinite(point.tertiary)).toBe(true);
    }
  }
  return evidence;
}

function changedLeafPaths(
  left: unknown,
  right: unknown,
  prefix = "scene",
): string[] {
  if (Object.is(left, right)) return [];
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return [prefix];
  }
  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>),
  ]);
  return [...keys].flatMap((key) =>
    changedLeafPaths(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
      `${prefix}.${key}`,
    ),
  );
}

describe("falling objects", () => {
  it("matches sqrt(2h/g) exactly when quadratic drag is absent", () => {
    const scene = dropScene();
    scene.airDensity = 0;
    const expected = Math.sqrt((2 * scene.height) / scene.gravity);
    expectWithinTwoPercent(vacuumDropTime(scene.height, scene.gravity), expected);
    expectWithinTwoPercent(
      quadraticDragDropTime(
        scene.height,
        scene.gravity,
        scene.airDensity,
        scene.objects[0].mass,
        scene.objects[0].radius,
        scene.objects[0].dragCoefficient,
      ),
      expected,
    );
    const evidence = buildEvidence({ ...dropDemo, scene });
    expectWithinTwoPercent(evidence.duration, expected);
    expect(evidence.outcomeKey).toBe("tie");
    expect(evidence.points.at(-1)).toMatchObject({ primary: 0, secondary: 0 });
  });

  it("uses quadratic drag and makes the lower area-to-mass ratio arrive first", () => {
    const scene = dropScene();
    scene.airDensity = 1.2;
    const [heavy, light] = scene.objects;
    const heavyTime = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      heavy.mass,
      heavy.radius,
      heavy.dragCoefficient,
    );
    const lightTime = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      light.mass,
      light.radius,
      light.dragCoefficient,
    );
    expect(heavyTime).toBeLessThan(lightTime);
    expect(heavyTime).toBeGreaterThan(vacuumDropTime(scene.height, scene.gravity));
    expect(determineOutcome(scene)).toBe("object_a_first");
  });

  it("is continuous as drag approaches zero", () => {
    const scene = dropScene();
    const vacuum = vacuumDropTime(scene.height, scene.gravity);
    const nearlyVacuum = quadraticDragDropTime(
      scene.height,
      scene.gravity,
      Number.MIN_VALUE,
      scene.objects[0].mass,
      scene.objects[0].radius,
      scene.objects[0].dragCoefficient,
    );
    expect(nearlyVacuum).toBe(vacuum);
  });

  it("uses an inclusive one-frame tie threshold", () => {
    expect(
      classifyDropImpactTimes(1, 1 + DROP_TIE_TOLERANCE_SECONDS),
    ).toBe("tie");
    expect(
      classifyDropImpactTimes(
        1,
        1 + DROP_TIE_TOLERANCE_SECONDS + 1e-9,
      ),
    ).toBe("object_a_first");
    expect(
      classifyDropImpactTimes(
        1 + DROP_TIE_TOLERANCE_SECONDS + 1e-9,
        1,
      ),
    ).toBe("object_b_first");
  });
});

describe("projectile motion", () => {
  it("matches analytic flight time, range, and apex without drag", () => {
    const scene = projectileScene();
    scene.object.dragCoefficient = 0;
    const angle = (scene.launch.angleDegrees * Math.PI) / 180;
    const vx = scene.launch.speed * Math.cos(angle);
    const vy = scene.launch.speed * Math.sin(angle);
    const expectedFlightTime =
      (vy + Math.sqrt(vy * vy + 2 * scene.gravity * scene.launch.height)) /
      scene.gravity;
    const expectedRange = vx * expectedFlightTime;
    const expectedApex =
      scene.launch.height + (vy * vy) / (2 * scene.gravity);
    const metrics = projectileMetrics(scene);
    expectWithinTwoPercent(metrics.flightTime, expectedFlightTime);
    expectWithinTwoPercent(metrics.range, expectedRange);
    expectWithinTwoPercent(metrics.apex, expectedApex);
  });

  it("keeps drag-free motion independent of projectile mass and radius", () => {
    const light = projectileScene();
    light.object = {
      ...light.object,
      mass: 0.05,
      radius: 0.05,
      dragCoefficient: 0,
    };
    const heavy = structuredClone(light);
    heavy.object.mass = 100;
    heavy.object.radius = 2;
    expect(projectileMetrics(light)).toEqual(projectileMetrics(heavy));
  });

  it("integrates quadratic drag in standard-density air", () => {
    const vacuum = projectileScene();
    vacuum.object.dragCoefficient = 0;
    const dragged = structuredClone(vacuum);
    dragged.object.dragCoefficient = 0.47;
    const vacuumMetrics = projectileMetrics(vacuum);
    const draggedMetrics = projectileMetrics(dragged);
    expect(PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER).toBe(1.225);
    expect(draggedMetrics.range).toBeLessThan(vacuumMetrics.range);
    expect(draggedMetrics.apex).toBeLessThan(vacuumMetrics.apex);
    expect(draggedMetrics.impactSpeed).toBeLessThan(vacuumMetrics.impactSpeed);
  });

  it("classifies the fixed-radius target at both inclusive boundaries", () => {
    const target = 10;
    expect(
      classifyProjectileRange(
        target - PROJECTILE_TARGET_RADIUS_METERS,
        target,
      ),
    ).toBe("hit");
    expect(
      classifyProjectileRange(
        target + PROJECTILE_TARGET_RADIUS_METERS,
        target,
      ),
    ).toBe("hit");
    expect(
      classifyProjectileRange(
        target - PROJECTILE_TARGET_RADIUS_METERS - 1e-9,
        target,
      ),
    ).toBe("undershoot");
    expect(
      classifyProjectileRange(
        target + PROJECTILE_TARGET_RADIUS_METERS + 1e-9,
        target,
      ),
    ).toBe("overshoot");
  });

  it("keeps the bundled target outcomes physically consistent", () => {
    expect(determineOutcome(projectileDemo.scene)).toBe("overshoot");
    const changed = applyCounterfactual(
      projectileDemo,
      projectileDemo.counterfactuals[0]!,
    );
    expect(determineOutcome(changed.scene)).toBe("hit");
    expect(buildEvidence(changed).outcomeKey).toBe("hit");
  });
});

describe("pendulum motion", () => {
  it("matches 2πsqrt(L/g) within two percent in the small-angle regime", () => {
    const scene = pendulumScene();
    scene.releaseAngleDegrees = 1;
    scene.damping = 0;
    const expected = 2 * Math.PI * Math.sqrt(scene.length / scene.gravity);
    const actual = pendulumPeriod(scene);
    expect(actual).not.toBeNull();
    expectWithinTwoPercent(actual!, expected);
    expectWithinTwoPercent(
      undampedPendulumPeriod(
        scene.length,
        scene.gravity,
        scene.releaseAngleDegrees,
      ),
      expected,
    );
  });

  it("accounts for the finite-amplitude period increase", () => {
    const small = pendulumScene();
    small.releaseAngleDegrees = 1;
    small.damping = 0;
    const large = structuredClone(small);
    large.releaseAngleDegrees = 80;
    expect(pendulumPeriod(large)!).toBeGreaterThan(pendulumPeriod(small)!);
  });

  it("keeps period, angle, and speed mass-independent while energy scales with mass", () => {
    const light = pendulumScene();
    light.bob.mass = 0.05;
    const heavy = structuredClone(light);
    heavy.bob.mass = 100;
    expect(pendulumPeriod(light)).toBe(pendulumPeriod(heavy));

    const lightEvidence = buildEvidence({ ...pendulumDemo, scene: light });
    const heavyEvidence = buildEvidence({ ...pendulumDemo, scene: heavy });
    lightEvidence.points.forEach((point, index) => {
      const heavyPoint = heavyEvidence.points[index]!;
      expect(heavyPoint.primary).toBeCloseTo(point.primary, 12);
      expect(heavyPoint.secondary).toBeCloseTo(point.secondary!, 12);
      expect(heavyPoint.tertiary! / point.tertiary!).toBeCloseTo(2_000, 8);
    });
  });

  it("conserves energy without damping and dissipates it monotonically with damping", () => {
    const undamped = pendulumScene();
    undamped.damping = 0;
    const conserved = buildEvidence({ ...pendulumDemo, scene: undamped });
    const energies = conserved.points.map((point) => point.tertiary!);
    expect(
      (Math.max(...energies) - Math.min(...energies)) / energies[0]!,
    ).toBeLessThan(1e-8);

    const damped = pendulumScene();
    damped.damping = 0.4;
    const dissipated = buildEvidence({ ...pendulumDemo, scene: damped });
    const dampedEnergies = dissipated.points.map((point) => point.tertiary!);
    expect(dampedEnergies.at(-1)).toBeLessThan(dampedEnergies[0]!);
    dampedEnergies.forEach((energy, index) => {
      if (index > 0) {
        expect(energy).toBeLessThanOrEqual(dampedEnergies[index - 1]! + 1e-10);
      }
    });
  });

  it("reports no repeating period at and above critical damping", () => {
    const scene = pendulumScene();
    scene.gravity = 0.5;
    scene.length = 10;
    scene.damping = 2;
    expect(pendulumPeriod(scene)).toBeNull();
    const evidence = buildEvidence({ ...pendulumDemo, scene });
    expect(evidence.metricA.value).toBe("No oscillation");
    expect(evidence.summary).toContain("critical");
  });

  it("maps outcomes from explicit reference and evaluated worlds", () => {
    const reference = pendulumScene();
    const massChange = structuredClone(reference);
    massChange.bob.mass = 12;
    const lengthChange = structuredClone(reference);
    lengthChange.length = 3.2;
    const gravityChange = structuredClone(reference);
    gravityChange.gravity = 20;
    expect(determineOutcome(massChange, reference)).toBe("period_unchanged");
    expect(determineOutcome(lengthChange, reference)).toBe("period_increases");
    expect(determineOutcome(gravityChange, reference)).toBe("period_decreases");
  });

  it("uses an inclusive one-percent semantic period threshold", () => {
    expect(PENDULUM_PERIOD_RELATIVE_TOLERANCE).toBe(0.01);
    expect(classifyPendulumPeriods(100, 101)).toBe("period_unchanged");
    expect(classifyPendulumPeriods(100, 101.02)).toBe("period_increases");
    expect(classifyPendulumPeriods(101.02, 100)).toBe("period_decreases");
    expect(classifyPendulumPeriods(null, null)).toBe("period_unchanged");
    expect(classifyPendulumPeriods(2, null)).toBe("period_increases");
    expect(classifyPendulumPeriods(null, 2)).toBe("period_decreases");
  });
});

describe("counterfactual and repeat determinism", () => {
  it("changes exactly one physical leaf, synchronizes its control, and corrects the declared outcome", () => {
    const counterfactual = structuredClone(
      pendulumDemo.counterfactuals[0]!,
    );
    counterfactual.prediction.correctOutcomeKey = "period_decreases";
    const changed = applyCounterfactual(pendulumDemo, counterfactual);
    expect(changedLeafPaths(pendulumDemo.scene, changed.scene)).toEqual([
      "scene.length",
    ]);
    expect(changed.prediction.correctOutcomeKey).toBe("period_increases");
    expect(
      changed.controls.find((control) => control.targetPath === "scene.length")
        ?.value,
    ).toBe(3.2);
    expect(pendulumScene().length).toBe(1.8);
  });

  it("rejects zero-change and two-change counterfactual declarations", () => {
    const noChange = structuredClone(
      pendulumDemo.counterfactuals[0]!,
    );
    noChange.change.value = 1.8;
    noChange.prediction.testChange!.value = 1.8;
    expect(() => applyCounterfactual(pendulumDemo, noChange)).toThrow(
      "exactly one",
    );

    const twoChanges = structuredClone(
      pendulumDemo.counterfactuals[0]!,
    );
    twoChanges.prediction.testChange = {
      targetPath: "scene.gravity",
      value: 5,
    };
    expect(() => applyCounterfactual(pendulumDemo, twoChanges)).toThrow(
      "same single physical change",
    );
  });

  it("produces identical evidence on reset/repeat and preserves comparison semantics", () => {
    const firstRun = updateScenePath(
      pendulumDemo,
      pendulumDemo.prediction.testChange!.targetPath,
      pendulumDemo.prediction.testChange!.value,
    );
    const firstEvidence = buildEvidence(firstRun);
    expect(firstEvidence.outcomeKey).toBe("period_unchanged");
    expect(buildEvidence(firstRun)).toEqual(firstEvidence);

    const transfer = applyCounterfactual(
      firstRun,
      pendulumDemo.counterfactuals[0]!,
    );
    const transferEvidence = buildEvidence(transfer);
    expect(transferEvidence.outcomeKey).toBe("period_increases");
    const repeatedTransfer = updateScenePath(
      transfer,
      transfer.prediction.testChange!.targetPath,
      transfer.prediction.testChange!.value,
    );
    expect(buildEvidence(repeatedTransfer)).toEqual(transferEvidence);

    expect(
      applyCounterfactual(firstRun, pendulumDemo.counterfactuals[0]!),
    ).toEqual(transfer);
  });

  it("rejects invalid, non-numeric, unsafe, non-finite, and out-of-contract updates", () => {
    expect(updateScenePath(dropDemo, "scene.missing", 1)).toBe(dropDemo);
    expect(updateScenePath(dropDemo, "scene.family", 1)).toBe(dropDemo);
    expect(updateScenePath(dropDemo, "scene.__proto__.mass", 1)).toBe(
      dropDemo,
    );
    expect(updateScenePath(dropDemo, "scene.gravity", Number.NaN)).toBe(
      dropDemo,
    );
    expect(updateScenePath(dropDemo, "scene.gravity", Number.POSITIVE_INFINITY)).toBe(
      dropDemo,
    );
    expect(updateScenePath(dropDemo, "scene.gravity", 0)).toBe(dropDemo);
  });
});

describe("contract boundaries and invalid numbers", () => {
  it("stays finite at the most drag-stressed allowed drop values", () => {
    const scene = dropScene();
    scene.gravity = 0.5;
    scene.height = 20;
    scene.airDensity = 2;
    scene.objects = scene.objects.map((object) => ({
      ...object,
      mass: 0.05,
      radius: 2,
      dragCoefficient: 2.5,
    })) as DropScene["objects"];
    const evidence = expectFiniteEvidence({ ...dropDemo, scene });
    expect(evidence.outcomeKey).toBe("tie");
    expect(evidence.duration).toBeGreaterThan(700);
  });

  it("stays finite at the most drag-stressed allowed projectile values", () => {
    const scene = projectileScene();
    scene.gravity = 0.5;
    scene.launch = { speed: 40, angleDegrees: 80, height: 20 };
    scene.object = {
      ...scene.object,
      mass: 0.05,
      radius: 2,
      dragCoefficient: 2.5,
    };
    scene.targetDistance = 100;
    const evidence = expectFiniteEvidence({ ...projectileDemo, scene });
    expect(evidence.outcomeKey).toBe("undershoot");
    expect(evidence.duration).toBeGreaterThan(500);
  });

  it("stays finite when every pendulum scalar is at its allowed maximum", () => {
    const scene = pendulumScene();
    scene.gravity = 25;
    scene.length = 10;
    scene.releaseAngleDegrees = 80;
    scene.damping = 2;
    scene.bob = {
      ...scene.bob,
      mass: 100,
      radius: 2,
      dragCoefficient: 2.5,
    };
    expectFiniteEvidence({ ...pendulumDemo, scene });
  });

  it("supports the zero-valued contract boundaries", () => {
    const drop = dropScene();
    drop.airDensity = 0;
    drop.objects[0].dragCoefficient = 0;
    expectFiniteEvidence({ ...dropDemo, scene: drop });

    const projectile = projectileScene();
    projectile.launch.height = 0;
    projectile.object.dragCoefficient = 0;
    expectFiniteEvidence({ ...projectileDemo, scene: projectile });

    const pendulum = pendulumScene();
    pendulum.damping = 0;
    expectFiniteEvidence({ ...pendulumDemo, scene: pendulum });
  });

  it("rejects NaN and infinities instead of emitting non-finite evidence", () => {
    expect(() => vacuumDropTime(Number.NaN, 9.81)).toThrow("finite");
    expect(() => vacuumDropTime(10, Number.POSITIVE_INFINITY)).toThrow(
      "finite",
    );
    expect(() => classifyDropImpactTimes(1, Number.NEGATIVE_INFINITY)).toThrow(
      "finite",
    );
    expect(() => classifyProjectileRange(Number.NaN, 10)).toThrow("finite");
    expect(() => classifyPendulumPeriods(2, Number.POSITIVE_INFINITY)).toThrow(
      "finite",
    );

    const invalid = structuredClone(dropDemo) as ExperimentSpec;
    (invalid.scene as DropScene).gravity = Number.NaN;
    expect(() => buildEvidence(invalid)).toThrow("Invalid gravity");

    const invalidProjectile = projectileScene() as ProjectileScene & {
      gravity: number;
    };
    invalidProjectile.gravity = Number.POSITIVE_INFINITY;
    expect(() => projectileMetrics(invalidProjectile)).toThrow("Invalid gravity");
  });

  it("uses explicit SI units in every displayed metric", () => {
    const drop = buildEvidence(dropDemo);
    const projectile = buildEvidence(projectileDemo);
    const pendulum = buildEvidence(pendulumDemo);
    expect(drop.metricA.value).toMatch(/ s$/);
    expect(drop.metricB.value).toMatch(/ s$/);
    expect(projectile.metricA.value).toMatch(/ m$/);
    expect(projectile.metricB.value).toMatch(/ m$/);
    expect(pendulum.metricA.value).toMatch(/ s$/);
    expect(pendulum.metricB.value).toMatch(/ kg$/);
  });

  it("rejects a comparison between different experiment families", () => {
    expect(() =>
      determineOutcome(pendulumScene(), projectileScene() as SceneSpec),
    ).toThrow("pendulum reference");
  });

  it("rejects non-finite counterfactual values", () => {
    const counterfactual = structuredClone(
      dropDemo.counterfactuals[0]!,
    ) as CounterfactualSpec;
    counterfactual.change.value = Number.POSITIVE_INFINITY;
    expect(() => applyCounterfactual(dropDemo, counterfactual)).toThrow(
      "finite",
    );
  });
});
