import type {
  Counterfactual,
  ExperimentSpec,
  ParameterName,
} from "@/lib/ai/contracts/experiment-spec";
import { computeOutcomes } from "./outcomes";

/**
 * Quantitative counterfactual comparison — the pedagogical payoff of the
 * whole app. After the learner predicts, the UI runs the patched world and
 * shows exactly which outcome metrics moved and which stayed put ("you
 * doubled the mass; the fall time changed by 0%").
 */

export interface MetricComparison {
  /** Metric slug from computeOutcomes, e.g. "fall-time". */
  id: string;
  label: string;
  unit: string;
  baseValue: number;
  patchedValue: number;
  /** patchedValue - baseValue. */
  absoluteChange: number;
  /**
   * (patched - base) / |base|, or null when the base value is ~0 and a
   * ratio would be meaningless.
   */
  relativeChange: number | null;
  /** True when the metric moved beyond numerical noise. */
  changed: boolean;
}

export interface CounterfactualComparison {
  counterfactualId: string;
  parameter: ParameterName;
  baseParameterValue: number;
  patchedParameterValue: number;
  metrics: MetricComparison[];
}

/**
 * Relative threshold below which a metric counts as "unchanged". Chosen well
 * above double-precision noise but far below any physically meaningful
 * effect at our parameter bounds.
 */
export const CHANGE_EPSILON = 1e-9;

/** Base magnitude under which relative change is reported as null. */
const NEAR_ZERO = 1e-12;

function compareMetric(
  id: string,
  label: string,
  unit: string,
  baseValue: number,
  patchedValue: number,
): MetricComparison {
  const absoluteChange = patchedValue - baseValue;
  const nearZeroBase = Math.abs(baseValue) < NEAR_ZERO;
  const relativeChange = nearZeroBase ? null : absoluteChange / Math.abs(baseValue);
  const changed = nearZeroBase
    ? Math.abs(absoluteChange) > CHANGE_EPSILON
    : Math.abs(relativeChange as number) > CHANGE_EPSILON;
  return { id, label, unit, baseValue, patchedValue, absoluteChange, relativeChange, changed };
}

/**
 * Run the base and patched worlds and diff every outcome metric.
 *
 * Expects a spec that already passed validateExperimentSpec, so the patched
 * parameter is guaranteed to exist on the base experiment; throws a
 * descriptive Error otherwise (a programmer error, not a user-input path).
 */
export function compareCounterfactual(
  spec: ExperimentSpec,
  counterfactual: Counterfactual,
): CounterfactualComparison {
  const { parameter, value } = counterfactual.patch;
  const baseParameterValue = spec.parameters[parameter];
  if (baseParameterValue === undefined) {
    throw new Error(
      `simulation: counterfactual "${counterfactual.id}" patches "${parameter}" which is not set on the base experiment`,
    );
  }

  const base = computeOutcomes(spec.family, spec.parameters);
  const patched = computeOutcomes(spec.family, {
    ...spec.parameters,
    [parameter]: value,
  });

  const metrics = base.metrics.map((baseMetric, index) => {
    const patchedMetric = patched.metrics[index]!;
    return compareMetric(
      baseMetric.id,
      baseMetric.label,
      baseMetric.unit,
      baseMetric.value,
      patchedMetric.value,
    );
  });

  return {
    counterfactualId: counterfactual.id,
    parameter,
    baseParameterValue,
    patchedParameterValue: value,
    metrics,
  };
}

/** Comparison for every counterfactual on the spec, in spec order. */
export function compareAllCounterfactuals(
  spec: ExperimentSpec,
): CounterfactualComparison[] {
  return spec.counterfactuals.map((cf) => compareCounterfactual(spec, cf));
}
