import { z } from "zod";
import { safeText } from "./experiment-spec";

/**
 * PUBLIC CONTRACT — ExplanationEvaluation
 *
 * Structured rubric produced by the explanation evaluator. The evaluator
 * generates feedback only; it never updates mastery. `masterySignal` is an
 * advisory flag the client may pass to the BKT module — the decision to
 * update mastery is explicitly outside /api/evaluate.
 */

export const rubricScoreSchema = z.number().int().min(0).max(3);

export const explanationEvaluationSchema = z
  .object({
    scores: z
      .object({
        /** Is the stated outcome/physics correct? */
        correctness: rubricScoreSchema,
        /** Does the explanation identify the causal mechanism? */
        mechanism: rubricScoreSchema,
        /** Appropriate use of physics vocabulary for the level. */
        vocabulary: rubricScoreSchema,
      })
      .strict(),
    misconceptions: z.array(safeText(3, 200)).max(4),
    feedback: safeText(10, 600),
  })
  .strict();

export type ExplanationEvaluation = z.infer<typeof explanationEvaluationSchema>;

export interface EvaluationResult {
  evaluation: ExplanationEvaluation;
  /** Deterministically derived: (correctness + mechanism + vocabulary) / 9. */
  overall: number;
  /** Advisory only — mastery updates are the caller's responsibility. */
  masterySignal: "correct" | "incorrect";
  source: "model" | "heuristic";
}

/** Derive the overall score and mastery signal from rubric scores. */
export function deriveEvaluationResult(
  evaluation: ExplanationEvaluation,
  source: EvaluationResult["source"],
): EvaluationResult {
  const { correctness, mechanism, vocabulary } = evaluation.scores;
  const overall =
    Math.round(((correctness + mechanism + vocabulary) / 9) * 100) / 100;
  const masterySignal =
    correctness >= 2 && mechanism >= 2 ? "correct" : "incorrect";
  return { evaluation, overall, masterySignal, source };
}
