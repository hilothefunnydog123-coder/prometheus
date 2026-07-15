import { z } from "zod";
import {
  type EvaluationResponse,
  type MisconceptionSpec,
} from "@/lib/contracts/experiment";
import { getFeatherlessConfig } from "./config";
import { ModelOutputError } from "./errors";
import { chatCompletion } from "./featherless-client";
import {
  EVALUATE_SYSTEM_PROMPT,
  gradeExplanationTool,
  sanitizeUserText,
  wrapUntrusted,
} from "./prompts";
import { safeText } from "./text-rules";

/**
 * evaluateExplanation: learner explanation -> renderer-contract
 * EvaluationResponse ({ score, criteria, feedback, hint }).
 *
 * Rubric-based and deterministic where it matters: the model only judges
 * each rubric criterion true/false and writes feedback/hint text — the
 * score is always computed server-side as passed/total. The evaluator
 * NEVER updates mastery; applying results to BKT state is the frontend's
 * decision (src/lib/mastery/bkt.ts stays pure).
 *
 * Total function: provider failures degrade to a deterministic keyword
 * heuristic with the same response shape.
 */

export interface EvaluationInput {
  experimentId: string;
  observedOutcome?: string;
  studentExplanation: string;
  misconception: MisconceptionSpec;
}

export interface EvaluateDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const MAX_EXPLANATION_LENGTH = 4000;

const safeMisconceptionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
    title: safeText(1, 120),
    description: safeText(1, 400),
    explanationRubric: z.array(safeText(1, 180)).min(1).max(5),
  })
  .strict();

export const evaluationInputSchema = z
  .object({
    experimentId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
    observedOutcome: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)
      .optional(),
    studentExplanation: z.string().trim().min(1).max(MAX_EXPLANATION_LENGTH),
    misconception: safeMisconceptionSchema,
  })
  .strict();

/**
 * Stable, ordered criteria keys derived from the rubric text. The frontend
 * reads criteria by insertion order against the rubric array, so order is
 * preserved and each rubric item maps to exactly one key.
 */
export function criteriaKeys(rubric: readonly string[]): string[] {
  const seen = new Set<string>();
  return rubric.map((item, index) => {
    let key =
      item
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "")
        .slice(0, 40) || `criterion-${index + 1}`;
    if (seen.has(key)) key = `${key}-${index + 1}`;
    seen.add(key);
    return key;
  });
}

function toResponse(
  rubric: readonly string[],
  passes: readonly boolean[],
  feedback: string,
  hint: string,
): EvaluationResponse {
  const keys = criteriaKeys(rubric);
  const criteria: Record<string, boolean> = {};
  keys.forEach((key, index) => {
    criteria[key] = passes[index] ?? false;
  });
  const passed = passes.filter(Boolean).length;
  const score =
    rubric.length === 0 ? 0 : Math.round((passed / rubric.length) * 100) / 100;
  return { score, criteria, feedback, hint };
}

const DEFAULT_HINT =
  "Change one variable at a time and watch how the measured value responds.";

/**
 * Deterministic fallback grader: a rubric criterion passes when the
 * explanation contains at least one substantive word from the criterion
 * text. Crude but honest — the feedback says grading is offline.
 */
export function heuristicEvaluation(input: EvaluationInput): EvaluationResponse {
  const explanation = sanitizeUserText(
    input.studentExplanation,
    MAX_EXPLANATION_LENGTH,
  ).toLowerCase();
  const rubric = input.misconception.explanationRubric;
  const passes = rubric.map((item) => {
    const tokens = item
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3);
    return tokens.some((token) => explanation.includes(token));
  });
  return toResponse(
    rubric,
    passes,
    "Automated grading is offline, so this rough score only checks whether your explanation mentions the rubric's key ideas. Compare your reasoning with the evidence you just observed.",
    DEFAULT_HINT,
  );
}

export async function evaluateExplanation(
  input: EvaluationInput,
  deps: EvaluateDeps = {},
): Promise<EvaluationResponse> {
  // Defensive re-validation: the misconception arrives from the client.
  const validatedInput = evaluationInputSchema.parse(input);
  const misconception = validatedInput.misconception;
  const trimmedInput: EvaluationInput = {
    ...validatedInput,
    misconception,
    studentExplanation: sanitizeUserText(
      validatedInput.studentExplanation,
      MAX_EXPLANATION_LENGTH,
    ),
  };

  if (deps.signal?.aborted) {
    return heuristicEvaluation(trimmedInput);
  }
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return heuristicEvaluation(trimmedInput);
  }

  const rubric = misconception.explanationRubric;
  const resultSchema = z
    .object({
      criteria: z.array(z.boolean()).length(rubric.length),
      feedback: safeText(10, 400),
      hint: safeText(5, 200),
    })
    .strict();
  const messages = [
    { role: "system" as const, content: EVALUATE_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: wrapUntrusted(
        JSON.stringify({
          experimentId: trimmedInput.experimentId,
          observedOutcome: trimmedInput.observedOutcome ?? null,
          misconception,
          studentExplanation: trimmedInput.studentExplanation,
        }),
        8000,
      ),
    },
  ];

  for (const phase of ["initial", "repair"] as const) {
    if (phase === "repair") {
      messages.push({
        role: "user",
        content:
          "The prior tool output was invalid. Call grade_explanation once with exactly one boolean per rubric criterion and bounded plain-text feedback and hint.",
      });
    }
    try {
      const result = await chatCompletion(
        config,
        {
          model: config.textModel,
          messages,
          tool: gradeExplanationTool(rubric.length),
          maxTokens: 500,
          signal: deps.signal,
        },
        deps.fetchImpl,
      );
      if (result.toolArguments === null) {
        if (phase === "initial") continue;
        return heuristicEvaluation(trimmedInput);
      }
      let candidate: unknown;
      try {
        candidate = JSON.parse(result.toolArguments);
      } catch {
        if (phase === "initial") continue;
        return heuristicEvaluation(trimmedInput);
      }
      const parsed = resultSchema.safeParse(candidate);
      if (!parsed.success) {
        if (phase === "initial") continue;
        return heuristicEvaluation(trimmedInput);
      }
      return toResponse(
        rubric,
        parsed.data.criteria,
        parsed.data.feedback,
        parsed.data.hint,
      );
    } catch (error) {
      if (error instanceof ModelOutputError && phase === "initial") {
        continue;
      }
      return heuristicEvaluation(trimmedInput);
    }
  }

  return heuristicEvaluation(trimmedInput);
}
