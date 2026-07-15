import { z } from "zod";

/**
 * PUBLIC CONTRACT — ExperimentSpec
 *
 * The shared contract between the AI compiler (this module) and the 3D
 * renderer / UI (Contributor A). The renderer treats a validated
 * ExperimentSpec as pure declarative data: parameters, a prediction prompt,
 * and a set of single-property counterfactual patches. Specs never contain
 * executable code, and every free-text field is validated to be plain text
 * (no control characters, no angle brackets) so it can be rendered safely.
 *
 * Breaking changes to this file require a documented incompatibility note in
 * the PR before merging.
 */

export const EXPERIMENT_FAMILIES = ["drop", "projectile", "pendulum"] as const;
export type ExperimentFamily = (typeof EXPERIMENT_FAMILIES)[number];

/** Global physical bounds for every tunable parameter (SI units). */
export const PARAMETER_BOUNDS = {
  gravity: { min: 0.5, max: 30, unit: "m/s^2" },
  mass: { min: 0.01, max: 1000, unit: "kg" },
  height: { min: 0.1, max: 100, unit: "m" },
  initialSpeed: { min: 0.5, max: 100, unit: "m/s" },
  angleDeg: { min: 5, max: 85, unit: "deg" },
  length: { min: 0.1, max: 20, unit: "m" },
  releaseAngleDeg: { min: 1, max: 60, unit: "deg" },
} as const satisfies Record<string, { min: number; max: number; unit: string }>;

export type ParameterName = keyof typeof PARAMETER_BOUNDS;

const PARAMETER_NAME_VALUES = [
  "gravity",
  "mass",
  "height",
  "initialSpeed",
  "angleDeg",
  "length",
  "releaseAngleDeg",
] as const satisfies readonly ParameterName[];

// Compile-time exhaustiveness check: every ParameterName appears in the enum.
type AssertAllParameterNames =
  ParameterName extends (typeof PARAMETER_NAME_VALUES)[number] ? true : never;
const _assertAllParameterNames: AssertAllParameterNames = true;
void _assertAllParameterNames;

export const parameterNameSchema = z.enum(PARAMETER_NAME_VALUES);

/** Which parameters each family requires and additionally allows. */
export const FAMILY_PARAMETERS: Record<
  ExperimentFamily,
  { required: readonly ParameterName[]; optional: readonly ParameterName[] }
> = {
  drop: { required: ["gravity", "mass", "height"], optional: [] },
  projectile: {
    required: ["gravity", "mass", "initialSpeed", "angleDeg"],
    optional: ["height"],
  },
  pendulum: {
    required: ["gravity", "mass", "length", "releaseAngleDeg"],
    optional: [],
  },
};

/**
 * Counterfactual patches may only target these parameters, per family.
 * Note: `mass` is deliberately allowed for drop and pendulum — "does mass
 * change the outcome?" is the canonical misconception probe.
 */
export const COUNTERFACTUAL_ALLOWLIST: Record<
  ExperimentFamily,
  readonly ParameterName[]
> = {
  drop: ["gravity", "mass", "height"],
  projectile: ["gravity", "initialSpeed", "angleDeg"],
  pendulum: ["gravity", "mass", "length", "releaseAngleDeg"],
};

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ANGLE_BRACKETS = /[<>]/;

/**
 * Plain-text field: trimmed, length-bounded, no control characters and no
 * angle brackets. This keeps every spec string inert when rendered — a spec
 * can never smuggle markup or script fragments to the UI.
 */
export const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), {
      message: "must not contain control characters",
    })
    .refine((s) => !ANGLE_BRACKETS.test(s), {
      message: "must not contain angle brackets",
    });

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "must be a short lowercase slug");

export const simulationSchema = z
  .object({
    /** Seconds of simulated time the renderer will play. */
    duration: z.number().finite().min(0.5).max(60),
    /** Fixed physics timestep in seconds. */
    timestep: z
      .number()
      .finite()
      .min(1 / 240)
      .max(1 / 30),
  })
  .strict()
  .refine((s) => s.duration / s.timestep <= 20000, {
    message: "duration/timestep must not exceed 20000 steps",
  });

export const predictionOutcomeSchema = z
  .object({
    id: slugSchema,
    label: safeText(1, 120),
  })
  .strict();

export const predictionSchema = z
  .object({
    question: safeText(8, 300),
    outcomes: z.array(predictionOutcomeSchema).min(2).max(5),
    /** Must reference one of the outcome ids (enforced by validation.ts). */
    correctOutcomeId: slugSchema,
  })
  .strict();

/** A counterfactual changes exactly one parameter — enforced structurally. */
export const counterfactualPatchSchema = z
  .object({
    parameter: parameterNameSchema,
    value: z.number().finite(),
  })
  .strict();

export const counterfactualSchema = z
  .object({
    id: slugSchema,
    label: safeText(3, 120),
    patch: counterfactualPatchSchema,
  })
  .strict();

export const experimentSpecSchema = z
  .object({
    id: slugSchema,
    family: z.enum(EXPERIMENT_FAMILIES),
    title: safeText(3, 80),
    description: safeText(10, 400),
    /** Concept slugs used to key mastery tracking (BKT). */
    concepts: z.array(slugSchema).min(1).max(4),
    parameters: z.record(parameterNameSchema, z.number().finite()),
    simulation: simulationSchema,
    prediction: predictionSchema,
    counterfactuals: z.array(counterfactualSchema).min(1).max(4),
    /** Prompt shown after the experiment asking the learner to explain. */
    explanationPrompt: safeText(10, 300),
  })
  .strict();

export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;
export type ExperimentParameters = ExperimentSpec["parameters"];
export type Counterfactual = z.infer<typeof counterfactualSchema>;
export type Prediction = z.infer<typeof predictionSchema>;
