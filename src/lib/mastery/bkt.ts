/**
 * Bayesian Knowledge Tracing (BKT).
 *
 * Pure functions, no I/O — persistence and the decision of WHEN to update
 * mastery live with the caller (the UI applies updates after predictions;
 * /api/evaluate explicitly never calls this module).
 *
 * Standard two-step update:
 *   1. Bayesian posterior of "already knew it" given the observation:
 *        correct:   pK(1-pSlip) / (pK(1-pSlip) + (1-pK)pGuess)
 *        incorrect: pK·pSlip    / (pK·pSlip    + (1-pK)(1-pGuess))
 *   2. Learning transition: p' = posterior + (1 - posterior)·pLearn
 */

export interface BktParams {
  /** P(L0): prior probability the concept is already known. */
  pInit: number;
  /** P(T): probability of learning the concept on each opportunity. */
  pLearn: number;
  /** P(G): probability of answering correctly despite not knowing. */
  pGuess: number;
  /** P(S): probability of answering incorrectly despite knowing. */
  pSlip: number;
}

export const BKT_DEFAULTS: BktParams = {
  pInit: 0.25,
  pLearn: 0.15,
  pGuess: 0.2,
  pSlip: 0.1,
};

export const MASTERY_THRESHOLD = 0.95;

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a probability in [0, 1], got ${value}`);
  }
}

function assertParams(params: BktParams): void {
  assertProbability(params.pInit, "pInit");
  assertProbability(params.pLearn, "pLearn");
  assertProbability(params.pGuess, "pGuess");
  assertProbability(params.pSlip, "pSlip");
  // Degenerate parameterizations make observations uninformative or inverted.
  if (params.pGuess + params.pSlip >= 1) {
    throw new RangeError("pGuess + pSlip must be < 1 for BKT to be identifiable");
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Starting mastery for a concept never seen before: P(L0). */
export function initialMastery(params: BktParams = BKT_DEFAULTS): number {
  assertParams(params);
  return params.pInit;
}

/** Probability the learner answers the next item correctly. */
export function predictCorrectness(
  pKnown: number,
  params: BktParams = BKT_DEFAULTS,
): number {
  assertParams(params);
  assertProbability(pKnown, "pKnown");
  return clamp01(
    pKnown * (1 - params.pSlip) + (1 - pKnown) * params.pGuess,
  );
}

/** One BKT update from a single observed answer. */
export function updateMastery(
  pKnown: number,
  observedCorrect: boolean,
  params: BktParams = BKT_DEFAULTS,
): number {
  assertParams(params);
  assertProbability(pKnown, "pKnown");
  const { pLearn, pGuess, pSlip } = params;

  const evidence = observedCorrect
    ? pKnown * (1 - pSlip) + (1 - pKnown) * pGuess
    : pKnown * pSlip + (1 - pKnown) * (1 - pGuess);
  // evidence > 0 is guaranteed by pGuess + pSlip < 1 for any pKnown in [0,1].
  const posterior = observedCorrect
    ? (pKnown * (1 - pSlip)) / evidence
    : (pKnown * pSlip) / evidence;

  return clamp01(posterior + (1 - posterior) * pLearn);
}

/**
 * Fold a sequence of observations starting from P(L0). Returns the mastery
 * trajectory: element i is the mastery AFTER observation i.
 */
export function masteryTrajectory(
  observations: readonly boolean[],
  params: BktParams = BKT_DEFAULTS,
): number[] {
  let pKnown = initialMastery(params);
  return observations.map((correct) => {
    pKnown = updateMastery(pKnown, correct, params);
    return pKnown;
  });
}

export function isMastered(
  pKnown: number,
  threshold: number = MASTERY_THRESHOLD,
): boolean {
  assertProbability(pKnown, "pKnown");
  assertProbability(threshold, "threshold");
  return pKnown >= threshold;
}
