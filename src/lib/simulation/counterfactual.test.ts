import { describe, expect, it } from "vitest";
import type { ExperimentSpec } from "@/lib/ai/contracts/experiment-spec";
import { dropFixture } from "@/lib/fixtures/drop";
import { pendulumFixture } from "@/lib/fixtures/pendulum";
import { projectileFixture } from "@/lib/fixtures/projectile";
import {
  compareAllCounterfactuals,
  compareCounterfactual,
} from "./counterfactual";

function counterfactualOf(spec: ExperimentSpec, id: string) {
  const cf = spec.counterfactuals.find((c) => c.id === id);
  if (!cf) throw new Error(`fixture is missing counterfactual "${id}"`);
  return cf;
}

describe("compareCounterfactual", () => {
  it("drop: a 10x heavier ball changes nothing", () => {
    const comparison = compareCounterfactual(
      dropFixture,
      counterfactualOf(dropFixture, "ten-times-heavier"),
    );
    expect(comparison.parameter).toBe("mass");
    expect(comparison.metrics.length).toBeGreaterThan(0);
    for (const metric of comparison.metrics) {
      expect(metric.changed).toBe(false);
      expect(metric.baseValue).toBeCloseTo(metric.patchedValue, 12);
    }
  });

  it("drop: Moon gravity lengthens the fall and softens the impact", () => {
    const comparison = compareCounterfactual(
      dropFixture,
      counterfactualOf(dropFixture, "moon-gravity"),
    );
    const fallTime = comparison.metrics.find((m) => m.id === "fall-time")!;
    const impact = comparison.metrics.find((m) => m.id === "impact-speed")!;
    expect(fallTime.changed).toBe(true);
    expect(fallTime.patchedValue).toBeGreaterThan(fallTime.baseValue);
    // sqrt(9.81 / 1.62) ≈ 2.46x longer.
    expect(fallTime.relativeChange).toBeCloseTo(Math.sqrt(9.81 / 1.62) - 1, 6);
    expect(impact.changed).toBe(true);
    expect(impact.patchedValue).toBeLessThan(impact.baseValue);
  });

  it("pendulum: doubling the bob's mass leaves every metric unchanged", () => {
    const comparison = compareCounterfactual(
      pendulumFixture,
      counterfactualOf(pendulumFixture, "double-mass"),
    );
    for (const metric of comparison.metrics) {
      expect(metric.changed).toBe(false);
    }
  });

  it("pendulum: a shorter string swings faster", () => {
    const comparison = compareCounterfactual(
      pendulumFixture,
      counterfactualOf(pendulumFixture, "quarter-length"),
    );
    const period = comparison.metrics.find((m) => m.id === "period")!;
    expect(period.changed).toBe(true);
    expect(period.patchedValue).toBeLessThan(period.baseValue);
    // Period scales with sqrt(L): 0.5 m vs 2 m → half the period.
    expect(period.patchedValue / period.baseValue).toBeCloseTo(0.5, 6);
  });

  it("projectile: lowering 45° to 30° shortens the range", () => {
    const comparison = compareCounterfactual(
      projectileFixture,
      counterfactualOf(projectileFixture, "angle-30"),
    );
    const range = comparison.metrics.find((m) => m.id === "range")!;
    expect(range.changed).toBe(true);
    expect(range.patchedValue).toBeLessThan(range.baseValue);
  });

  it("reports the base and patched parameter values", () => {
    const comparison = compareCounterfactual(
      dropFixture,
      counterfactualOf(dropFixture, "quarter-height"),
    );
    expect(comparison.baseParameterValue).toBe(20);
    expect(comparison.patchedParameterValue).toBe(5);
    expect(comparison.counterfactualId).toBe("quarter-height");
  });

  it("throws when the patched parameter is absent from the base spec", () => {
    const broken = JSON.parse(JSON.stringify(dropFixture)) as ExperimentSpec;
    delete broken.parameters.mass;
    expect(() =>
      compareCounterfactual(
        broken,
        counterfactualOf(dropFixture, "ten-times-heavier"),
      ),
    ).toThrow(/not set on the base experiment/);
  });
});

describe("compareAllCounterfactuals", () => {
  it("returns one comparison per counterfactual, in spec order", () => {
    for (const fixture of [dropFixture, projectileFixture, pendulumFixture]) {
      const comparisons = compareAllCounterfactuals(fixture);
      expect(comparisons.map((c) => c.counterfactualId)).toEqual(
        fixture.counterfactuals.map((c) => c.id),
      );
    }
  });
});
