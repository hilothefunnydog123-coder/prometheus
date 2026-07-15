import { describe, expect, it } from "vitest";
import { experimentSpecSchema } from "@/lib/contracts/experiment";
import { validateExperimentSpec } from "@/lib/ai/validation";
import type { LearningIntent } from "@/lib/ai/contracts/learning-intent";
import { closestFixture, dropFixture, FIXTURES, getFixtureByFamily } from ".";

function intent(overrides: Partial<LearningIntent>): LearningIntent {
  return {
    topic: "general physics",
    family: "unknown",
    concepts: [],
    difficulty: "standard",
    confidence: 0.1,
    usedImage: false,
    ...overrides,
  };
}

describe("golden fixtures", () => {
  it("covers exactly the drop, projectile, and pendulum families", () => {
    expect(FIXTURES.map((f) => f.spec.scene.family).sort()).toEqual([
      "drop",
      "pendulum",
      "projectile",
    ]);
  });

  it.each(FIXTURES.map((f) => [f.spec.id, f.spec] as const))(
    "%s parses against the renderer contract",
    (_id, spec) => {
      expect(() => experimentSpecSchema.parse(spec)).not.toThrow();
    },
  );

  it.each(FIXTURES.map((f) => [f.spec.id, f.spec] as const))(
    "%s passes full validation with declared correctness equal to computed",
    (_id, spec) => {
      const result = validateExperimentSpec(spec);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        // Deep equality proves the declared correctOutcomeKey values match
        // the server-computed ones for the base prediction and every
        // counterfactual.
        expect(result.spec).toEqual(spec);
      }
    },
  );

  it("getFixtureByFamily returns the matching fixture", () => {
    expect(getFixtureByFamily("pendulum").spec.scene.family).toBe("pendulum");
  });
});

describe("closestFixture", () => {
  it("uses the intent family when it is known", () => {
    expect(
      closestFixture(intent({ family: "projectile" })).spec.scene.family,
    ).toBe("projectile");
  });

  it("matches unknown intents by topic keywords", () => {
    const chosen = closestFixture(
      intent({ topic: "why does a clock pendulum swing so steadily" }),
    );
    expect(chosen.spec.scene.family).toBe("pendulum");
  });

  it("defaults to the drop fixture when nothing matches", () => {
    const chosen = closestFixture(
      intent({ topic: "help with my chemistry homework" }),
    );
    expect(chosen.spec.id).toBe(dropFixture.id);
  });

  it("is deterministic for identical inputs", () => {
    const a = closestFixture(intent({ topic: "balance chemical equations" }));
    const b = closestFixture(intent({ topic: "balance chemical equations" }));
    expect(a.spec.id).toBe(b.spec.id);
  });
});
