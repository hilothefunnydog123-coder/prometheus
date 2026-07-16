import { describe, expect, it } from "vitest";
import type { ExperimentSpec } from "./contracts/experiment-spec";
import { dropFixture } from "@/lib/fixtures/drop";
import { pendulumFixture } from "@/lib/fixtures/pendulum";
import { characteristicTime, validateExperimentSpec } from "./validation";

/** Deep-clone the golden drop fixture so tests can mutate freely. */
function specWith(mutate: (spec: ExperimentSpec) => void): ExperimentSpec {
  const clone = JSON.parse(JSON.stringify(dropFixture)) as ExperimentSpec;
  mutate(clone);
  return clone;
}

function expectErrors(input: unknown, fragment: string): void {
  const result = validateExperimentSpec(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(
      result.errors.some((e) => e.includes(fragment)),
      `expected an error containing "${fragment}", got:\n${result.errors.join("\n")}`,
    ).toBe(true);
  }
}

describe("validateExperimentSpec", () => {
  it("accepts a golden fixture", () => {
    const result = validateExperimentSpec(dropFixture);
    expect(result.ok).toBe(true);
  });

  it("rejects non-object input with schema errors", () => {
    expect(validateExperimentSpec(null).ok).toBe(false);
    expect(validateExperimentSpec("spec").ok).toBe(false);
    expect(validateExperimentSpec([]).ok).toBe(false);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const spec = specWith(() => undefined) as ExperimentSpec &
      Record<string, unknown>;
    spec.script = "alert(1)";
    expectErrors(spec, "Unrecognized key");
  });

  it("rejects out-of-bounds parameters", () => {
    expectErrors(
      specWith((s) => {
        s.parameters.gravity = 1000;
      }),
      "outside [0.5, 30]",
    );
    expectErrors(
      specWith((s) => {
        s.parameters.height = 0;
      }),
      "outside [0.1, 100]",
    );
  });

  it("rejects parameters that do not belong to the family", () => {
    expectErrors(
      specWith((s) => {
        s.parameters.length = 2;
      }),
      'not applicable to family "drop"',
    );
  });

  it("rejects specs missing required family parameters", () => {
    expectErrors(
      specWith((s) => {
        delete s.parameters.height;
      }),
      "required for family",
    );
  });

  it("rejects infeasible simulations (event longer than duration)", () => {
    expectErrors(
      specWith((s) => {
        s.parameters.height = 80;
        s.parameters.gravity = 0.5;
        // fall time = sqrt(2*80/0.5) ≈ 17.9s > 6s duration
      }),
      "simulation.duration",
    );
  });

  it("rejects a wide pendulum swing that only fits the small-angle period", () => {
    // At 60° the exact period (≈ 3.05 s for L = 2 m) exceeds the small-angle
    // value (≈ 2.84 s); a 2.9 s window used to pass feasibility incorrectly.
    const spec = JSON.parse(
      JSON.stringify(pendulumFixture),
    ) as ExperimentSpec;
    spec.parameters.releaseAngleDeg = 60;
    spec.simulation.duration = 2.9;
    spec.counterfactuals = [
      {
        id: "double-mass",
        label: "Double the mass of the bob",
        patch: { parameter: "mass", value: 2 },
      },
    ];
    expectErrors(spec, "simulation.duration");
  });

  it("rejects duplicate prediction outcome ids", () => {
    expectErrors(
      specWith((s) => {
        const first = s.prediction.outcomes[0]!;
        s.prediction.outcomes[1]!.id = first.id;
      }),
      "ids must be unique",
    );
  });

  it("rejects a correctOutcomeId that matches no outcome", () => {
    expectErrors(
      specWith((s) => {
        s.prediction.correctOutcomeId = "nonexistent";
      }),
      "does not match any outcome id",
    );
  });

  it("rejects counterfactual patches outside the family allowlist", () => {
    expectErrors(
      specWith((s) => {
        s.counterfactuals[0]!.patch = { parameter: "angleDeg", value: 45 };
      }),
      "not allowed for family",
    );
  });

  it("rejects counterfactual patch values outside parameter bounds", () => {
    expectErrors(
      specWith((s) => {
        s.counterfactuals[0]!.patch = { parameter: "mass", value: 100000 };
      }),
      "outside [0.01, 1000]",
    );
  });

  it("rejects counterfactuals equal to the base value", () => {
    expectErrors(
      specWith((s) => {
        s.counterfactuals[0]!.patch = { parameter: "mass", value: 1 };
      }),
      "must differ from the base value",
    );
  });

  it("rejects counterfactuals that make the simulation infeasible", () => {
    expectErrors(
      specWith((s) => {
        // Moon gravity from 100m: sqrt(2*100/1.62) ≈ 11.1s > 6s duration
        s.counterfactuals[1]!.patch = { parameter: "height", value: 100 };
        s.parameters.gravity = 1.62;
        s.parameters.height = 5; // base stays feasible: sqrt(2*5/1.62) ≈ 2.5s
      }),
      "patched experiment",
    );
  });

  it("rejects angle brackets in text fields", () => {
    expectErrors(
      specWith((s) => {
        s.title = "<script>alert(1)</script>";
      }),
      "angle brackets",
    );
  });

  it("rejects control characters in text fields", () => {
    expectErrors(
      specWith((s) => {
        s.description = "line one \u0007 bell character in description";
      }),
      "control characters",
    );
  });
});

describe("characteristicTime", () => {
  it("computes drop fall time sqrt(2h/g)", () => {
    expect(
      characteristicTime("drop", { gravity: 9.81, height: 20 }),
    ).toBeCloseTo(Math.sqrt(40 / 9.81), 5);
  });

  it("computes projectile flight time from launch height 0", () => {
    const t = characteristicTime("projectile", {
      gravity: 9.81,
      initialSpeed: 20,
      angleDeg: 45,
    });
    expect(t).toBeCloseTo((2 * 20 * Math.sin(Math.PI / 4)) / 9.81, 5);
  });

  it("computes one pendulum period", () => {
    expect(
      characteristicTime("pendulum", { gravity: 9.81, length: 2 }),
    ).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / 9.81), 5);
  });

  it("applies the large-amplitude correction to the pendulum period", () => {
    const smallAngle = 2 * Math.PI * Math.sqrt(2 / 9.81);
    const corrected = characteristicTime("pendulum", {
      gravity: 9.81,
      length: 2,
      releaseAngleDeg: 60,
    })!;
    // ~7.3% longer than the small-angle value at the 60° amplitude bound.
    expect(corrected / smallAngle).toBeGreaterThan(1.07);
    expect(corrected / smallAngle).toBeLessThan(1.08);
  });

  it("returns null when parameters are missing", () => {
    expect(characteristicTime("drop", { gravity: 9.81 })).toBeNull();
    expect(characteristicTime("pendulum", { length: 2 })).toBeNull();
  });
});
