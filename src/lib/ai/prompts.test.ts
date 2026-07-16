import { describe, expect, it } from "vitest";
import {
  EMIT_EXPERIMENT_SPEC_TOOL,
  REPORT_LEARNING_INTENT_TOOL,
  gradeExplanationTool,
} from "./prompts";

/**
 * Provider compatibility guard for tool parameter schemas.
 *
 * Gemini's OpenAI-compatibility layer converts function `parameters` into
 * its own schema subset and rejects structural keywords it does not support
 * with HTTP 400 ("provider-request-error" in the compile fallback taxonomy).
 * Every tool schema must therefore stay inside the least-common-denominator
 * subset. Zod + domain validation remain the real authority — these schemas
 * only guide the model — so restricting them loses nothing.
 */

const FORBIDDEN_KEYWORDS = [
  '"oneOf"',
  '"anyOf"',
  '"allOf"',
  '"not"',
  '"$ref"',
  '"$defs"',
  '"exclusiveMinimum"',
  '"exclusiveMaximum"',
  '"pattern"',
  '"patternProperties"',
  '"if"',
  '"then"',
  '"dependentSchemas"',
] as const;

const TOOLS = [
  REPORT_LEARNING_INTENT_TOOL,
  EMIT_EXPERIMENT_SPEC_TOOL,
  gradeExplanationTool(3),
];

describe("tool schemas stay provider-compatible", () => {
  it.each(TOOLS.map((tool) => [tool.name, tool] as const))(
    "%s uses only the common function-calling schema subset",
    (_name, tool) => {
      const serialized = JSON.stringify(tool.parameters);
      for (const keyword of FORBIDDEN_KEYWORDS) {
        expect(serialized, `schema must not contain ${keyword}`).not.toContain(
          keyword,
        );
      }
    },
  );

  it("emit_experiment_spec still describes all three families", () => {
    const serialized = JSON.stringify(EMIT_EXPERIMENT_SPEC_TOOL.parameters);
    for (const family of ["drop", "projectile", "pendulum"]) {
      expect(serialized).toContain(family);
    }
    // The flattened scene keeps every family's properties addressable.
    for (const property of [
      "airDensity",
      "objects",
      "launch",
      "targetDistance",
      "length",
      "releaseAngleDegrees",
      "damping",
      "bob",
    ]) {
      expect(serialized).toContain(`"${property}"`);
    }
  });

  it("keeps scene family and gravity as the only required scene fields", () => {
    const parameters = EMIT_EXPERIMENT_SPEC_TOOL.parameters as {
      properties: { scene: { required: string[] } };
    };
    expect(parameters.properties.scene.required).toEqual([
      "family",
      "gravity",
    ]);
  });
});
