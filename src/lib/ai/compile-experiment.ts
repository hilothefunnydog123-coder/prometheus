import type {
  CompileResponse,
  ExperimentSpec,
  GradeBand,
} from "@/lib/contracts/experiment";
import { getFeatherlessConfig } from "./config";
import type { LearningIntent } from "./contracts/learning-intent";
import {
  MissingCredentialsError,
  ModelOutputError,
  ProviderCancelledError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./errors";
import { chatCompletion, type ChatMessage } from "./featherless-client";
import {
  COMPILE_SYSTEM_PROMPT,
  EMIT_EXPERIMENT_SPEC_TOOL,
  repairPrompt,
  wrapUntrusted,
} from "./prompts";
import { validateRendererExperimentSpec } from "./validation";
import { closestValidatedExample } from "./validated-examples";
import { questionAlignmentErrors } from "./question-alignment";

/**
 * compileExperiment: LearningIntent -> renderer-contract CompileResponse.
 *
 * Pipeline: model attempt -> validate + server-side correctness overwrite ->
 * (on failure) one repair attempt with concise validation errors ->
 * deterministic fixture fallback. Missing credentials, timeouts, provider
 * errors, and failed repairs all resolve to the closest golden fixture with
 * provenance.source = "validated-example" and the fallback disclosed in
 * warnings. The returned spec is ALWAYS valid, and its correctOutcomeKey
 * values are always computed by the server, never by the model.
 */

export type CompileFallbackReason =
  | "missing-credentials"
  | "timeout"
  | "cancelled"
  | "network-error"
  | "rate-limited"
  | "provider-error"
  | "invalid-after-repair";

const FALLBACK_PHRASES: Record<CompileFallbackReason, string> = {
  "missing-credentials": "The AI compiler is not configured on this server.",
  timeout: "The AI compiler timed out.",
  cancelled: "The AI compiler request was cancelled.",
  "network-error": "The AI compiler could not reach its provider.",
  "rate-limited": "The AI compiler is busy right now.",
  "provider-error": "The AI compiler is temporarily unavailable.",
  "invalid-after-repair":
    "The AI compiler could not produce a valid experiment for this request.",
};

export interface CompileOptions {
  gradeBand: GradeBand;
  sourceQuestion?: string;
}

export interface CompileDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  fallbackMode?: "fixture" | "error";
}

function fixtureResponse(
  intent: LearningIntent,
  gradeBand: GradeBand,
  reason: CompileFallbackReason,
): CompileResponse {
  const spec = closestValidatedExample(intent);
  spec.gradeBand = gradeBand;
  const validated = validateRendererExperimentSpec(spec);
  if (!validated.ok) {
    throw new Error("Bundled validated example failed validation");
  }
  return {
    spec: validated.spec,
    warnings: [
      `${FALLBACK_PHRASES[reason]} You are running a validated example experiment instead.`,
    ],
    provenance: {
      source: "validated-example",
      generatedAt: new Date().toISOString(),
    },
  };
}

interface AttemptOutcome {
  spec?: ExperimentSpec;
  errors: string[];
}

function parseAndValidate(
  toolArguments: string | null,
  sourceQuestion?: string,
): AttemptOutcome {
  if (toolArguments === null) {
    return { errors: ["no tool call was made; call emit_experiment_spec"] };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(toolArguments);
  } catch {
    return {
      errors: ["tool arguments were not valid JSON; emit strict JSON only"],
    };
  }
  const result = validateRendererExperimentSpec(candidate);
  if (!result.ok) return { errors: result.errors };
  const alignmentErrors = sourceQuestion
    ? questionAlignmentErrors(result.spec, sourceQuestion)
    : [];
  return alignmentErrors.length === 0
    ? { spec: result.spec, errors: [] }
    : { errors: alignmentErrors };
}

function fixtureOrThrow(
  intent: LearningIntent,
  options: CompileOptions,
  deps: CompileDeps,
  reason: CompileFallbackReason,
  error: Error,
): CompileResponse {
  if (deps.fallbackMode === "error") throw error;
  return fixtureResponse(intent, options.gradeBand, reason);
}

export async function compileExperiment(
  intent: LearningIntent,
  options: CompileOptions,
  deps: CompileDeps = {},
): Promise<CompileResponse> {
  if (deps.signal?.aborted) {
    return fixtureOrThrow(
      intent,
      options,
      deps,
      "cancelled",
      new ProviderCancelledError(),
    );
  }
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return fixtureOrThrow(
      intent,
      options,
      deps,
      "missing-credentials",
      new MissingCredentialsError(),
    );
  }

  const sourceQuestion = options.sourceQuestion?.trim();
  const request = {
    sourceQuestion: sourceQuestion || intent.topic,
    intent,
    gradeBand: options.gradeBand,
  };
  const messages: ChatMessage[] = [
    { role: "system", content: COMPILE_SYSTEM_PROMPT },
    { role: "user", content: wrapUntrusted(JSON.stringify(request)) },
  ];

  let lastErrors: string[] = [];

  for (const phase of ["initial", "repair"] as const) {
    if (phase === "repair") {
      messages.push({ role: "user", content: repairPrompt(lastErrors) });
    }
    try {
      const result = await chatCompletion(
        config,
        {
          model: config.textModel,
          messages,
          tool: EMIT_EXPERIMENT_SPEC_TOOL,
          maxTokens: 3000,
          signal: deps.signal,
        },
        deps.fetchImpl,
      );
      const outcome = parseAndValidate(result.toolArguments, sourceQuestion);
      if (outcome.spec) {
        const spec = structuredClone(outcome.spec);
        // The grade band comes from validated request data, not the model.
        spec.gradeBand = options.gradeBand;
        return {
          spec,
          warnings:
            phase === "repair"
              ? [
                  "The generated experiment required one automatic correction before it passed validation.",
                ]
              : [],
          provenance: {
            source: "generated",
            model: config.textModel,
            generatedAt: new Date().toISOString(),
          },
        };
      }
      lastErrors = outcome.errors;
    } catch (error) {
      if (error instanceof ModelOutputError) {
        lastErrors = [
          "the provider returned unusable structured output; call emit_experiment_spec with complete strict JSON",
        ];
        if (phase === "initial") continue;
        return fixtureOrThrow(
          intent,
          options,
          deps,
          "invalid-after-repair",
          new ModelOutputError("experiment remained invalid after repair"),
        );
      }
      if (error instanceof ProviderTimeoutError) {
        return fixtureOrThrow(intent, options, deps, "timeout", error);
      }
      if (error instanceof ProviderCancelledError) {
        return fixtureOrThrow(intent, options, deps, "cancelled", error);
      }
      if (error instanceof ProviderNetworkError) {
        return fixtureOrThrow(intent, options, deps, "network-error", error);
      }
      if (error instanceof ProviderRateLimitError) {
        return fixtureOrThrow(intent, options, deps, "rate-limited", error);
      }
      if (error instanceof MissingCredentialsError) {
        return fixtureOrThrow(
          intent,
          options,
          deps,
          "missing-credentials",
          error,
        );
      }
      // HTTP or envelope errors are not repairable by the model.
      const providerError =
        error instanceof ProviderHttpError
          ? error
          : new ProviderHttpError(502);
      return fixtureOrThrow(
        intent,
        options,
        deps,
        "provider-error",
        providerError,
      );
    }
  }

  return fixtureOrThrow(
    intent,
    options,
    deps,
    "invalid-after-repair",
    new ModelOutputError("experiment remained invalid after repair"),
  );
}
