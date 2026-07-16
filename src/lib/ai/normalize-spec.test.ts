import { describe, expect, it } from "vitest";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import { normalizeGeneratedSpec } from "./normalize-spec";
import { validateRendererExperimentSpec } from "./validation";

function asSpec(input: unknown): ExperimentSpec {
  return input as ExperimentSpec;
}

describe("normalizeGeneratedSpec", () => {
  it("leaves already-valid specs semantically unchanged", () => {
    for (const demo of [dropDemo, projectileDemo, pendulumDemo]) {
      const normalized = normalizeGeneratedSpec(structuredClone(demo));
      const result = validateRendererExperimentSpec(normalized);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      // Scene physics and learner-facing text are never altered.
      expect(asSpec(normalized).scene).toEqual(demo.scene);
      expect(asSpec(normalized).title).toBe(demo.title);
      expect(asSpec(normalized).prediction.choices).toEqual(
        demo.prediction.choices,
      );
    }
  });

  it("passes non-spec input through untouched for the repair loop", () => {
    expect(normalizeGeneratedSpec(null)).toBeNull();
    expect(normalizeGeneratedSpec("garbage")).toBe("garbage");
    const missingScene = { version: "1.0", id: "x" };
    expect(normalizeGeneratedSpec(missingScene)).toBe(missingScene);
  });

  it("strips a base testChange from drop and projectile predictions", () => {
    const spec = structuredClone(dropDemo);
    spec.prediction.testChange = {
      targetPath: "scene.objects.0.mass",
      value: 16,
    };
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    expect(normalized.prediction.testChange).toBeUndefined();
    expect(validateRendererExperimentSpec(normalized).ok).toBe(true);
  });

  it("keeps the required base testChange on pendulum predictions", () => {
    const spec = structuredClone(pendulumDemo);
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    expect(normalized.prediction.testChange).toEqual(
      pendulumDemo.prediction.testChange,
    );
  });

  it("rewrites counterfactual testChange to match the counterfactual change", () => {
    const spec = structuredClone(projectileDemo);
    spec.counterfactuals[0]!.prediction.testChange = {
      targetPath: "scene.launch.speed", // model mismatched the tested change
      value: 9,
    };
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    expect(normalized.counterfactuals[0]!.prediction.testChange).toEqual(
      spec.counterfactuals[0]!.change,
    );
    expect(validateRendererExperimentSpec(normalized).ok).toBe(true);
  });

  it("fills in a missing counterfactual testChange", () => {
    const spec = structuredClone(dropDemo);
    delete spec.counterfactuals[0]!.prediction.testChange;
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    expect(normalized.counterfactuals[0]!.prediction.testChange).toEqual(
      spec.counterfactuals[0]!.change,
    );
  });

  it("snaps control values to the scene and keeps ranges in bounds", () => {
    const spec = structuredClone(dropDemo);
    // Model drifted: value disagrees with the scene, range exceeds bounds,
    // and the scene value is not on the step grid from min.
    spec.controls[0] = {
      ...spec.controls[0]!,
      min: 0.01,
      max: 500, // contract bound for mass is 100
      step: 3,
      value: 5, // scene.objects.0.mass is 8
    };
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    const control = normalized.controls[0]!;
    expect(control.value).toBe(8);
    expect(control.max).toBeLessThanOrEqual(100);
    expect(control.min).toBeLessThanOrEqual(8);
    const stepsFromMin = (control.value - control.min) / control.step;
    expect(Math.abs(stepsFromMin - Math.round(stepsFromMin))).toBeLessThan(
      1e-6,
    );
    expect(validateRendererExperimentSpec(normalized).ok).toBe(true);
  });

  it("repairs a degenerate control range around the scene value", () => {
    const spec = structuredClone(pendulumDemo);
    spec.controls[0] = {
      ...spec.controls[0]!,
      min: 1.8,
      max: 1.8, // zero-width range at the scene value
      step: 0.1,
      value: 1.8,
    };
    const normalized = asSpec(normalizeGeneratedSpec(spec));
    const control = normalized.controls[0]!;
    expect(control.min).toBeLessThan(control.max);
    expect(control.value).toBe(1.8);
    expect(validateRendererExperimentSpec(normalized).ok).toBe(true);
  });
});
