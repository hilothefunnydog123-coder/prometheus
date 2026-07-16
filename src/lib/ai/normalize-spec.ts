import {
  experimentSpecSchema,
  type ControlSpec,
  type ExperimentSpec,
} from "@/lib/contracts/experiment";
import { getSceneValue, isAllowlistedPath, pathBounds } from "./scene-paths";

/**
 * Mechanical canonicalization of model-generated specs, applied after schema
 * parsing and before domain validation (AI_COMPILER_DIAGNOSIS.md fix #2/#3).
 *
 * The domain validator enforces cross-field physics rules that a language
 * model satisfies inconsistently even when its physics content is right:
 * base-vs-pendulum testChange placement, counterfactual testChange equality,
 * and controls that must mirror the scene value, stay inside contract
 * bounds, and align to their step. Every one of those has exactly one
 * correct server-computable answer, so instead of rejecting and burning the
 * single repair round on bookkeeping, the server rewrites them
 * deterministically. Validation still runs afterwards on the normalized
 * spec — nothing here loosens the contract, and physics content (scene
 * numbers, wording, choices) is never invented or altered.
 */

export function normalizeGeneratedSpec(input: unknown): unknown {
  const parsed = experimentSpecSchema.safeParse(input);
  if (!parsed.success) return input; // schema errors go to repair as before
  const spec = parsed.data;

  // A base testChange only means something for comparison-style predictions:
  // pendulum period questions and sandbox compare_change rules both describe a
  // second world. Everywhere else the base prediction describes the rendered
  // scene as-is, so a stray testChange is dropped.
  const baseNeedsTestChange =
    spec.scene.family === "pendulum" ||
    (spec.scene.family === "sandbox" &&
      spec.scene.outcomeRule.kind === "compare_change");
  if (!baseNeedsTestChange && spec.prediction.testChange) {
    delete spec.prediction.testChange;
  }

  // A counterfactual prediction always tests exactly its own change. The
  // validator requires equality when present; setting it unconditionally
  // also gives the outcome engine its declarative comparison for pendulums.
  for (const counterfactual of spec.counterfactuals) {
    counterfactual.prediction.testChange = { ...counterfactual.change };
  }

  spec.controls = spec.controls.map((control) =>
    normalizeControl(spec, control),
  );

  return spec;
}

/**
 * Make a control mirror the scene: value equals the scene value at its
 * targetPath, [min, max] contains the value inside contract bounds, step
 * fits the range, and the value sits on the step grid. Controls whose
 * targetPath the validator will reject anyway are returned unchanged.
 */
function normalizeControl(
  spec: ExperimentSpec,
  control: ControlSpec,
): ControlSpec {
  const family = spec.scene.family;
  if (!isAllowlistedPath(family, control.targetPath)) return control;
  const value = getSceneValue(spec.scene, control.targetPath);
  if (value === null) return control;
  const bounds = pathBounds(family, control.targetPath)!;

  let max = Math.min(bounds.max, Math.max(control.max, value));
  let step = control.step;

  // Anchor min on the step grid ending exactly at the scene value.
  const desiredMin = Math.min(Math.max(control.min, bounds.min), value);
  let min = alignMin(value, desiredMin, step, bounds.min);

  if (min >= max) {
    // Degenerate range around the value: widen by one step where possible.
    if (value + step <= bounds.max) {
      max = value + step;
    } else if (value - step >= bounds.min) {
      min = value - step;
    } else {
      min = bounds.min;
      max = bounds.max;
    }
  }
  if (step > max - min) {
    step = max - min;
    min = alignMin(value, min, step, bounds.min);
  }

  return { ...control, min, max, step, value };
}

function alignMin(
  value: number,
  desiredMin: number,
  step: number,
  lowerBound: number,
): number {
  if (step <= 0) return desiredMin;
  let stepsBelow = Math.round((value - desiredMin) / step);
  if (stepsBelow < 0) stepsBelow = 0;
  let min = value - stepsBelow * step;
  if (min < lowerBound) {
    stepsBelow = Math.floor((value - lowerBound) / step);
    min = value - stepsBelow * step;
  }
  return min;
}
