import { describe, expect, it } from "vitest";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import {
  applyCounterfactual,
  buildEvidence,
  determineOutcome,
} from "./evidence";

describe("client evidence model", () => {
  it("matches the analytic vacuum drop time within two percent", () => {
    expect(dropDemo.scene.family).toBe("drop");
    if (dropDemo.scene.family !== "drop") {
      throw new Error("drop fixture must use the drop scene");
    }
    const evidence = buildEvidence(dropDemo);
    const expected = Math.sqrt(
      (2 * dropDemo.scene.height) / dropDemo.scene.gravity,
    );
    expect(evidence.duration).toBeCloseTo(expected, 2);
    expect(evidence.outcomeKey).toBe("tie");
  });

  it("makes the heavier equal-shape object arrive first when drag is added", () => {
    const changed = applyCounterfactual(dropDemo, dropDemo.counterfactuals[0]!);
    expect(determineOutcome(changed.scene)).toBe("object_a_first");
  });

  it("classifies projectile range against the target", () => {
    expect(determineOutcome(projectileDemo.scene)).toBe("overshoot");
    const changed = applyCounterfactual(
      projectileDemo,
      projectileDemo.counterfactuals[0]!,
    );
    expect(determineOutcome(changed.scene)).toBe("hit");
  });

  it("classifies the bundled pendulum comparison and transfer challenge", () => {
    expect(determineOutcome(pendulumDemo.scene)).toBe("period_unchanged");
    const changed = applyCounterfactual(
      pendulumDemo,
      pendulumDemo.counterfactuals[0]!,
    );
    expect(determineOutcome(changed.scene)).toBe("period_increases");
  });

  it("applies a counterfactual without mutating the original spec", () => {
    expect(pendulumDemo.scene.family).toBe("pendulum");
    if (pendulumDemo.scene.family !== "pendulum") {
      throw new Error("pendulum fixture must use the pendulum scene");
    }
    const originalLength = pendulumDemo.scene.length;
    const changed = applyCounterfactual(
      pendulumDemo,
      pendulumDemo.counterfactuals[0]!,
    );
    expect(pendulumDemo.scene.length).toBe(originalLength);
    expect(changed.scene.family).toBe("pendulum");
    if (changed.scene.family === "pendulum") {
      expect(changed.scene.length).not.toBe(originalLength);
    }
  });
});
