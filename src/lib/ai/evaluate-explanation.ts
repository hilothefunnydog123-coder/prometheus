import { getFeatherlessConfig } from "./config";
import type { ExperimentFamily } from "./contracts/experiment-spec";
import {
  deriveEvaluationResult,
  explanationEvaluationSchema,
  type EvaluationResult,
  type ExplanationEvaluation,
} from "./contracts/evaluation";
import { chatCompletion } from "./featherless-client";
import {
  EVALUATE_SYSTEM_PROMPT,
  GRADE_EXPLANATION_TOOL,
  sanitizeUserText,
  wrapUntrusted,
} from "./prompts";

/**
 * evaluateExplanation: learner explanation -> structured rubric feedback.
 *
 * Generates feedback only — it never updates mastery. The masterySignal in
 * the result is advisory; applying it via the BKT module is the caller's
 * decision (see src/lib/mastery/bkt.ts).
 *
 * Like analyzeInput, this function is total: provider failures degrade to a
 * deterministic heuristic rubric marked source: "heuristic".
 */

export interface EvaluationContext {
  family: ExperimentFamily;
  /** The explanation prompt or prediction question the learner answered. */
  question: string;
  /** Concept slugs from the ExperimentSpec, used by the heuristic grader. */
  concepts: readonly string[];
}

export interface EvaluateDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const MAX_EXPLANATION_LENGTH = 4000;

/**
 * Deterministic fallback grader: crude but honest. Scores concept-keyword
 * coverage and explanation substance, detects nothing it cannot detect, and
 * says so in the feedback.
 */
export function heuristicEvaluation(
  explanation: string,
  context: EvaluationContext,
): ExplanationEvaluation {
  const text = sanitizeUserText(explanation).toLowerCase();
  const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 2);

  const conceptWords = context.concepts.flatMap((c) => c.split(/[-_]/));
  const coveredConcepts = conceptWords.filter((w) => text.includes(w)).length;
  const coverageScore =
    conceptWords.length === 0
      ? 1
      : Math.min(3, Math.round((coveredConcepts / conceptWords.length) * 3));

  const substanceScore = words.length >= 40 ? 2 : words.length >= 15 ? 1 : 0;

  return explanationEvaluationSchema.parse({
    scores: {
      correctness: Math.min(coverageScore, 2),
      mechanism: Math.min(substanceScore, 2),
      vocabulary: coverageScore,
    },
    misconceptions: [],
    feedback:
      "Automated grading is offline, so this is a rough keyword-based score. Compare your explanation with what the simulation showed and check that you named the cause, not just the result.",
  });
}

export async function evaluateExplanation(
  explanation: string,
  context: EvaluationContext,
  deps: EvaluateDeps = {},
): Promise<EvaluationResult> {
  const trimmed = sanitizeUserText(explanation).slice(
    0,
    MAX_EXPLANATION_LENGTH,
  );
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return deriveEvaluationResult(
      heuristicEvaluation(trimmed, context),
      "heuristic",
    );
  }

  try {
    const result = await chatCompletion(
      config,
      {
        model: config.textModel,
        messages: [
          { role: "system", content: EVALUATE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `Experiment family: ${context.family}`,
              `Question the learner answered: ${sanitizeUserText(context.question)}`,
              `Target concepts: ${context.concepts.join(", ") || "(none)"}`,
              "Learner explanation:",
              wrapUntrusted(trimmed),
            ].join("\n"),
          },
        ],
        tool: GRADE_EXPLANATION_TOOL,
        maxTokens: 600,
      },
      deps.fetchImpl,
    );
    if (result.toolArguments === null) {
      return deriveEvaluationResult(
        heuristicEvaluation(trimmed, context),
        "heuristic",
      );
    }
    const candidate: unknown = JSON.parse(result.toolArguments);
    const parsed = explanationEvaluationSchema.safeParse(candidate);
    if (!parsed.success) {
      return deriveEvaluationResult(
        heuristicEvaluation(trimmed, context),
        "heuristic",
      );
    }
    return deriveEvaluationResult(parsed.data, "model");
  } catch {
    return deriveEvaluationResult(
      heuristicEvaluation(trimmed, context),
      "heuristic",
    );
  }
}
