import { describe, expect, it } from "vitest";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import { normalizeGeneratedSpec } from "./normalize-spec";
import { validateRendererExperimentSpec } from "./validation";
import { questionAlignmentErrors } from "./question-alignment";
import { sandboxDropSpec } from "./testing/sandbox-fixture";

/**
 * End-to-end check of the sandbox path through the real compiler pipeline:
 * normalize → structural + physics validation → server-side correctness
 * finalization. The model authors the scene and rule; the engine decides the
 * answer. Here a vacuum drop of two unequal masses must tie, and adding air
 * must make the denser body land first — computed, never asserted by the spec.
 */
const vacuumDropSandbox = (): unknown => sandboxDropSpec();

describe("sandbox spec validation and finalization", () => {
  it("validates and computes server-authoritative outcomes", () => {
    const result = validateRendererExperimentSpec(
      normalizeGeneratedSpec(vacuumDropSandbox()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Vacuum: equal acceleration → the two masses tie.
    expect(result.spec.prediction.correctOutcomeKey).toBe("tie");
    // Thick air: equal size but the denser ball decelerates less → lands first.
    expect(result.spec.counterfactuals[0]!.prediction.correctOutcomeKey).toBe("a");
  });

  it("passes question alignment when text reuses the learner's words", () => {
    const result = validateRendererExperimentSpec(
      normalizeGeneratedSpec(vacuumDropSandbox()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const errors = questionAlignmentErrors(
      result.spec,
      "Do heavier balls fall faster than lighter balls?",
    );
    expect(errors).toEqual([]);
  });

  it("rejects a base compare_bodies prediction that carries a stray testChange survivor", () => {
    const spec = vacuumDropSandbox() as ExperimentSpec;
    // compare_bodies base predictions describe the base scene; a testChange is
    // dropped by normalize, so inject it post-normalize to prove validation
    // still guards the invariant.
    const normalized = normalizeGeneratedSpec(spec) as ExperimentSpec;
    normalized.prediction.testChange = { targetPath: "scene.airDensity", value: 1.5 };
    const result = validateRendererExperimentSpec(normalized);
    expect(result.ok).toBe(false);
  });
});
