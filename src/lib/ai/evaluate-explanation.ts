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

  const familyVocabulary: Record<ExperimentFamily, RegExp[]> = {
    drop: [
      /\bgravit/, /\baccelerat/, /\binertia\b/, /\bforce\b/, /\bmass\b/,
      /same rate/, /arriv(?:e|ed|ing) together/, /hit together/, /air resistance/,
      /\bdrag\b/,
    ],
    projectile: [
      /\bgravit/, /\baccelerat/, /\bvelocity\b/, /horizontal/, /vertical/,
      /component/, /trajectory/, /launch angle/, /time of flight/, /\brange\b/,
    ],
    pendulum: [
      /\bgravit/, /\bperiod\b/, /\blength\b/, /pendulum/, /oscillat/,
      /restoring force/, /release angle/, /\bcycle\b/, /\bfrequency\b/,
    ],
  };
  const conceptWords = context.concepts
    .flatMap((concept) => concept.split(/[-_]/))
    .filter((word) => word.length > 3);
  const conceptMatches = conceptWords.filter((word) => text.includes(word)).length;
  const vocabularyMatches = familyVocabulary[context.family].filter((pattern) =>
    pattern.test(text),
  ).length;
  const evidenceLanguage = /\b(observed|showed|measured|graph|tim(?:e|ing)|result|together|same)\b/.test(text);
  const causalLanguage = /\b(because|therefore|since|so|caus|due to|means that|which makes)\b/.test(text);
  const mechanismEvidence = vocabularyMatches + Math.min(conceptMatches, 2);

  const correctnessScore =
    mechanismEvidence >= 5 && evidenceLanguage
      ? 3
      : mechanismEvidence >= 3
        ? 2
        : mechanismEvidence >= 1
          ? 1
          : 0;
  const mechanismScore =
    causalLanguage && mechanismEvidence >= 4 && words.length >= 12
      ? 3
      : causalLanguage && mechanismEvidence >= 2
        ? 2
        : mechanismEvidence >= 2 && words.length >= 12
          ? 1
          : 0;
  const vocabularyScore =
    mechanismEvidence >= 5
      ? 3
      : mechanismEvidence >= 3
        ? 2
        : mechanismEvidence >= 1
          ? 1
          : 0;
  const overall = correctnessScore + mechanismScore + vocabularyScore;
  const feedback =
    overall >= 7
      ? "Strong causal chain: you connected the observed result to the underlying mechanism and used the experiment's key physics vocabulary. Now test whether that reasoning survives one controlled change."
      : overall >= 4
        ? "You identified part of the mechanism. Strengthen the explanation by naming what the evidence showed and linking it with because or therefore to the physics that caused it."
        : "This describes the result more than its cause. Name a measured observation, then explain which physics principle produced it; this local rubric is intentionally conservative while automated grading is offline.";

  return explanationEvaluationSchema.parse({
    scores: {
      correctness: correctnessScore,
      mechanism: mechanismScore,
      vocabulary: vocabularyScore,
    },
    misconceptions: [],
    feedback,
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
