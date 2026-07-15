import type { ZodError } from "zod";
import {
  COUNTERFACTUAL_ALLOWLIST,
  FAMILY_PARAMETERS,
  PARAMETER_BOUNDS,
  experimentSpecSchema,
  type ExperimentFamily,
  type ExperimentParameters,
  type ExperimentSpec,
  type ParameterName,
} from "./contracts/experiment-spec";

/**
 * Deterministic domain validation for ExperimentSpec, layered on top of the
 * Zod schema. Errors are concise, plain-text strings — they double as the
 * repair prompt sent back to the model, so they must name the exact field
 * and constraint.
 */

const MAX_ERRORS = 12;
const MAX_ERROR_LENGTH = 200;

export interface ValidationSuccess {
  ok: true;
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

export function checkParameterBounds(
  parameters: ExperimentParameters,
): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(parameters)) {
    const bounds = PARAMETER_BOUNDS[name as ParameterName];
    if (value === undefined) continue;
    if (value < bounds.min || value > bounds.max) {
      errors.push(
        `parameters.${name}: ${value} is outside [${bounds.min}, ${bounds.max}] ${bounds.unit}`,
      );
    }
  }
  return errors;
}

export function checkFamilyParameters(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  const { required, optional } = FAMILY_PARAMETERS[spec.family];
  const allowed = new Set<ParameterName>([...required, ...optional]);
  for (const name of required) {
    if (spec.parameters[name] === undefined) {
      errors.push(`parameters.${name}: required for family "${spec.family}"`);
    }
  }
  for (const name of Object.keys(spec.parameters) as ParameterName[]) {
    if (!allowed.has(name)) {
      errors.push(
        `parameters.${name}: not applicable to family "${spec.family}"`,
      );
    }
  }
  return errors;
}

/**
 * Characteristic time of the experiment's main event, in seconds, or null if
 * the needed parameters are missing (family checks report that separately).
 */
export function characteristicTime(
  family: ExperimentFamily,
  parameters: ExperimentParameters,
): number | null {
  const g = parameters.gravity;
  if (g === undefined || g <= 0) return null;
  switch (family) {
    case "drop": {
      const h = parameters.height;
      if (h === undefined || h <= 0) return null;
      return Math.sqrt((2 * h) / g);
    }
    case "projectile": {
      const v = parameters.initialSpeed;
      const angle = parameters.angleDeg;
      if (v === undefined || angle === undefined) return null;
      const vy = v * Math.sin((angle * Math.PI) / 180);
      const h = parameters.height ?? 0;
      // Time to return to the ground from launch height h.
      return (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
    }
    case "pendulum": {
      const length = parameters.length;
      if (length === undefined || length <= 0) return null;
      // One full period; the renderer should show at least one swing cycle.
      return 2 * Math.PI * Math.sqrt(length / g);
    }
  }
}

export function checkFeasibility(spec: ExperimentSpec): string[] {
  const t = characteristicTime(spec.family, spec.parameters);
  if (t === null) return []; // missing params are reported by family checks
  if (t > spec.simulation.duration) {
    return [
      `simulation.duration: experiment needs ~${t.toFixed(2)}s to complete but duration is ${spec.simulation.duration}s`,
    ];
  }
  return [];
}

export function checkPredictionCoverage(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  const ids = spec.prediction.outcomes.map((o) => o.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push("prediction.outcomes: outcome ids must be unique");
  }
  const labels = spec.prediction.outcomes.map((o) =>
    o.label.trim().toLowerCase(),
  );
  if (new Set(labels).size !== labels.length) {
    errors.push("prediction.outcomes: outcome labels must be distinct");
  }
  if (!uniqueIds.has(spec.prediction.correctOutcomeId)) {
    errors.push(
      `prediction.correctOutcomeId: "${spec.prediction.correctOutcomeId}" does not match any outcome id`,
    );
  }
  return errors;
}

const MIN_RELATIVE_CHANGE = 1e-6;

export function checkCounterfactuals(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  const allowlist = COUNTERFACTUAL_ALLOWLIST[spec.family];
  const seenIds = new Set<string>();

  for (const cf of spec.counterfactuals) {
    const prefix = `counterfactuals.${cf.id}`;
    if (seenIds.has(cf.id)) {
      errors.push(`${prefix}: duplicate counterfactual id`);
    }
    seenIds.add(cf.id);

    const { parameter, value } = cf.patch;
    if (!allowlist.includes(parameter)) {
      errors.push(
        `${prefix}: parameter "${parameter}" is not allowed for family "${spec.family}" (allowed: ${allowlist.join(", ")})`,
      );
      continue;
    }
    const bounds = PARAMETER_BOUNDS[parameter];
    if (value < bounds.min || value > bounds.max) {
      errors.push(
        `${prefix}: value ${value} is outside [${bounds.min}, ${bounds.max}] ${bounds.unit}`,
      );
      continue;
    }
    const base = spec.parameters[parameter];
    if (base === undefined) {
      errors.push(
        `${prefix}: patches parameter "${parameter}" which is not set on the base experiment`,
      );
      continue;
    }
    if (Math.abs(value - base) <= MIN_RELATIVE_CHANGE * Math.max(1, Math.abs(base))) {
      errors.push(
        `${prefix}: patched value ${value} must differ from the base value ${base}`,
      );
      continue;
    }
    // The patched world must still complete within the simulation window.
    const patched = { ...spec.parameters, [parameter]: value };
    const t = characteristicTime(spec.family, patched);
    if (t !== null && t > spec.simulation.duration) {
      errors.push(
        `${prefix}: patched experiment needs ~${t.toFixed(2)}s but simulation.duration is ${spec.simulation.duration}s`,
      );
    }
  }
  return errors;
}

/**
 * Full validation: Zod schema first, then domain rules. Never throws.
 */
export function validateExperimentSpec(input: unknown): ValidationResult {
  const parsed = experimentSpecSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: formatZodErrors(parsed.error) };
  }
  const spec = parsed.data;
  const errors = [
    ...checkParameterBounds(spec.parameters),
    ...checkFamilyParameters(spec),
    ...checkFeasibility(spec),
    ...checkPredictionCoverage(spec),
    ...checkCounterfactuals(spec),
  ].map(clip);
  if (errors.length > 0) {
    return { ok: false, errors: errors.slice(0, MAX_ERRORS) };
  }
  return { ok: true, spec };
}
