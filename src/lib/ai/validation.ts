import type { ZodError } from "zod";
import {
  experimentSpecSchema,
  sceneSchema,
  type ExperimentSpec,
  type PredictionSpec,
  type SceneSpec,
} from "@/lib/contracts/experiment";
import {
  MAX_SIMULATED_SECONDS,
  OUTCOME_KEYS,
  expectedOutcomeKey,
  finalizeCorrectness,
  sceneDuration,
  type SceneChange,
} from "./deterministic-outcomes";
import {
  applySceneChange,
  getSceneValue,
  isAllowlistedPath,
  pathBounds,
} from "./scene-paths";
import { SAFE_ID_PATTERN, scanStringsForForbiddenContent } from "./text-rules";
import type { ExperimentSpec as LegacyExperimentSpec } from "./contracts/experiment-spec";
import {
  validateLegacyExperimentSpec,
  type ValidationResult as LegacyValidationResult,
} from "./legacy-validation";

/**
 * Deterministic domain validation on top of the public contract
 * (src/lib/contracts/experiment.ts), followed by server-side correctness
 * finalization. Error strings are concise plain text — they double as the
 * model repair prompt.
 *
 * A spec that validates is guaranteed to:
 * - satisfy every contract bound (Zod re-parse, including patched scenes)
 * - carry no executable code, markup, shader source, or file paths
 * - address only allowlisted scene paths from controls/changes/testChange
 * - change exactly one numeric property per counterfactual, staying in bounds
 * - complete within 20 s of simulated time in every world it describes
 * - cover each family outcome key exactly once per prediction
 * - have correctOutcomeKey values computed by the server, not the model
 */

const MAX_ERRORS = 12;
const MAX_ERROR_LENGTH = 220;
const VALUE_EPSILON = 1e-6;

export interface ValidationSuccess {
  ok: true;
  /** Parsed spec with server-computed correctOutcomeKey values. */
  spec: ExperimentSpec;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function clip(message: string): string {
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : message;
}

export function formatZodErrors(error: ZodError): string[] {
  return error.issues
    .slice(0, MAX_ERRORS)
    .map((issue) =>
      clip(`${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
}

function checkChange(
  spec: ExperimentSpec,
  change: SceneChange,
  label: string,
): string[] {
  const family = spec.scene.family;
  if (!isAllowlistedPath(family, change.targetPath)) {
    return [
      `${label}: targetPath "${change.targetPath}" is not allowlisted for family "${family}"`,
    ];
  }
  const bounds = pathBounds(family, change.targetPath)!;
  if (change.value < bounds.min || change.value > bounds.max) {
    return [
      `${label}: value ${change.value} is outside [${bounds.min}, ${bounds.max}] for ${change.targetPath}`,
    ];
  }
  const current = getSceneValue(spec.scene, change.targetPath);
  if (current === null) {
    return [`${label}: targetPath "${change.targetPath}" does not resolve to a number`];
  }
  if (Math.abs(change.value - current) <= VALUE_EPSILON * Math.max(1, Math.abs(current))) {
    return [
      `${label}: value ${change.value} must differ from the current value ${current}`,
    ];
  }
  return [];
}

function checkPatchedScene(
  scene: SceneSpec,
  change: SceneChange,
  label: string,
): string[] {
  let patched: SceneSpec;
  try {
    patched = applySceneChange(scene, change.targetPath, change.value);
  } catch {
    return [`${label}: change could not be applied`];
  }
  const reparsed = sceneSchema.safeParse(patched);
  if (!reparsed.success) {
    return [`${label}: patched scene violates contract bounds`];
  }
  if (sceneDuration(patched) === null) {
    return [
      `${label}: patched experiment does not finish within ${MAX_SIMULATED_SECONDS} s`,
    ];
  }
  return [];
}

function checkPrediction(
  spec: ExperimentSpec,
  prediction: PredictionSpec,
  label: string,
): string[] {
  const errors: string[] = [];
  const vocabulary = OUTCOME_KEYS[spec.scene.family];

  const ids = prediction.choices.map((choice) => choice.id);
  if (new Set(ids).size !== ids.length) {
    errors.push(`${label}.choices: choice ids must be unique`);
  }
  const keys = prediction.choices.map((choice) => choice.outcomeKey);
  const keySet = new Set(keys);
  if (keySet.size !== keys.length) {
    errors.push(`${label}.choices: outcomeKeys must be unique`);
  }
  const missing = vocabulary.filter((key) => !keySet.has(key));
  const unknown = keys.filter(
    (key) => !(vocabulary as readonly string[]).includes(key),
  );
  if (missing.length > 0 || unknown.length > 0) {
    errors.push(
      `${label}.choices: outcomeKeys must be exactly [${vocabulary.join(", ")}]` +
        (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""),
    );
  }

  if (prediction.testChange) {
    errors.push(...checkChange(spec, prediction.testChange, `${label}.testChange`));
    if (errors.length === 0) {
      errors.push(
        ...checkPatchedScene(spec.scene, prediction.testChange, `${label}.testChange`),
      );
    }
  }
  return errors;
}

function checkControls(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  const family = spec.scene.family;
  const ids = new Set<string>();
  for (const control of spec.controls) {
    const label = `controls.${control.id}`;
    if (ids.has(control.id)) errors.push(`${label}: duplicate control id`);
    ids.add(control.id);

    if (!isAllowlistedPath(family, control.targetPath)) {
      errors.push(
        `${label}: targetPath "${control.targetPath}" is not allowlisted for family "${family}"`,
      );
      continue;
    }
    const bounds = pathBounds(family, control.targetPath)!;
    if (control.min >= control.max) {
      errors.push(`${label}: min must be less than max`);
    }
    if (control.min < bounds.min || control.max > bounds.max) {
      errors.push(
        `${label}: range [${control.min}, ${control.max}] exceeds contract bounds [${bounds.min}, ${bounds.max}] for ${control.targetPath}`,
      );
    }
    if (control.value < control.min || control.value > control.max) {
      errors.push(`${label}: value ${control.value} is outside its own range`);
    }
    const current = getSceneValue(spec.scene, control.targetPath);
    if (current === null) {
      errors.push(`${label}: targetPath does not resolve to a number`);
    } else if (Math.abs(current - control.value) > VALUE_EPSILON * Math.max(1, Math.abs(current))) {
      errors.push(
        `${label}: value ${control.value} must equal the scene value ${current} at ${control.targetPath}`,
      );
    }
  }
  return errors;
}

function checkMeasurements(spec: ExperimentSpec): string[] {
  const ids = spec.measurements.map((measurement) => measurement.id);
  return new Set(ids).size === ids.length
    ? []
    : ["measurements: ids must be unique"];
}

function checkFamilyRequirements(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  if (spec.scene.family === "drop") {
    const [a, b] = spec.scene.objects;
    if (a.id === b.id) {
      errors.push("scene.objects: the two drop objects must have distinct ids");
    }
  }
  if (spec.scene.family === "projectile" && spec.scene.targetDistance === undefined) {
    errors.push(
      "scene.targetDistance: required — undershoot/hit/overshoot predictions need a target",
    );
  }
  if (spec.scene.family === "pendulum" && !spec.prediction.testChange) {
    errors.push(
      "prediction.testChange: required for pendulum — declare the compared change (e.g. scene.bob.mass to a new value) instead of describing it only in prose",
    );
  }
  if (spec.scene.family !== "pendulum" && spec.prediction.testChange) {
    errors.push(
      "prediction.testChange: base drop/projectile predictions must describe the rendered base scene",
    );
  }
  return errors;
}

function checkCounterfactuals(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const counterfactual of spec.counterfactuals) {
    const label = `counterfactuals.${counterfactual.id}`;
    if (ids.has(counterfactual.id)) errors.push(`${label}: duplicate id`);
    ids.add(counterfactual.id);

    const changeErrors = checkChange(spec, counterfactual.change, `${label}.change`);
    errors.push(...changeErrors);
    if (changeErrors.length === 0) {
      errors.push(
        ...checkPatchedScene(spec.scene, counterfactual.change, `${label}.change`),
      );
    }
    errors.push(
      ...checkPrediction(spec, counterfactual.prediction, `${label}.prediction`),
    );
    if (
      spec.scene.family !== "pendulum" &&
      counterfactual.prediction.testChange &&
      (counterfactual.prediction.testChange.targetPath !==
        counterfactual.change.targetPath ||
        Math.abs(
          counterfactual.prediction.testChange.value -
            counterfactual.change.value,
        ) > VALUE_EPSILON)
    ) {
      errors.push(
        `${label}.prediction.testChange: must match the counterfactual change so server correctness matches the rendered world`,
      );
    }
  }
  return errors;
}

function checkOutcomesComputable(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  if (
    expectedOutcomeKey(spec.scene, spec.prediction.testChange) === null &&
    spec.scene.family !== "pendulum" // pendulum is reported by family checks
  ) {
    errors.push("prediction: outcome is not computable for the base scene");
  }
  return errors;
}

/**
 * Full validation + correctness finalization. Never throws. On success the
 * returned spec has correctOutcomeKey overwritten with computed values for
 * the base prediction and every counterfactual.
 */
export function validateRendererExperimentSpec(input: unknown): ValidationResult {
  const parsed = experimentSpecSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: formatZodErrors(parsed.error) };
  }
  const spec = parsed.data;

  const errors: string[] = [];

  if (!SAFE_ID_PATTERN.test(spec.id)) {
    errors.push("id: must be letters, digits, hyphens, or underscores");
  }
  errors.push(...scanStringsForForbiddenContent(spec));
  errors.push(...checkFamilyRequirements(spec));
  errors.push(...checkControls(spec));
  errors.push(...checkMeasurements(spec));
  errors.push(...checkPrediction(spec, spec.prediction, "prediction"));
  errors.push(...checkCounterfactuals(spec));

  if (sceneDuration(spec.scene) === null) {
    errors.push(
      `scene: the experiment does not finish within ${MAX_SIMULATED_SECONDS} s of simulated time`,
    );
  }

  if (errors.length === 0) {
    errors.push(...checkOutcomesComputable(spec));
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors.map(clip).slice(0, MAX_ERRORS) };
  }

  try {
    return { ok: true, spec: finalizeCorrectness(spec) };
  } catch (error) {
    return {
      ok: false,
      errors: [clip(error instanceof Error ? error.message : "outcome finalization failed")],
    };
  }
}

/**
 * Backward-compatible dispatcher for the legacy bundled-fixture validator.
 * Production compiler calls validateRendererExperimentSpec directly.
 */
export function validateExperimentSpec(
  input: ExperimentSpec,
): ValidationResult;
export function validateExperimentSpec(
  input: LegacyExperimentSpec,
): LegacyValidationResult;
export function validateExperimentSpec(
  input: unknown,
): ValidationResult | LegacyValidationResult;
export function validateExperimentSpec(
  input: unknown,
): ValidationResult | LegacyValidationResult {
  if (
    input !== null &&
    typeof input === "object" &&
    ("scene" in input || "version" in input || "gradeBand" in input)
  ) {
    return validateRendererExperimentSpec(input);
  }
  return validateLegacyExperimentSpec(input);
}
