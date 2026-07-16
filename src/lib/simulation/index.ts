/**
 * Deterministic physics for the three experiment families. Pure functions,
 * no I/O, usable from both the server (validation, eval) and the client
 * (renderer, counterfactual reveal).
 */
export {
  computeOutcomes,
  dropFallTime,
  dropImpactSpeed,
  pendulumMaxSpeed,
  pendulumPeriod,
  pendulumSmallAnglePeriod,
  projectileFlightTime,
  projectileMaxHeight,
  projectileRange,
  type ExperimentOutcome,
  type OutcomeMetric,
} from "./outcomes";
export { sampleTrajectory, type TrajectoryPoint } from "./trajectory";
export {
  CHANGE_EPSILON,
  compareAllCounterfactuals,
  compareCounterfactual,
  type CounterfactualComparison,
  type MetricComparison,
} from "./counterfactual";
