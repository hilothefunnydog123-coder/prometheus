import type {
  CompileResponse,
  ExperimentSpec,
  GradeBand,
} from "@/lib/contracts/experiment";
import { getFeatherlessConfig } from "./config";
import type { LearningIntent } from "./contracts/learning-intent";
import { MissingCredentialsError, ProviderTimeoutError } from "./errors";
import { chatCompletion, type ChatMessage } from "./featherless-client";
import {
  COMPILE_SYSTEM_PROMPT,
  EMIT_EXPERIMENT_SPEC_TOOL,
  repairPrompt,
  wrapUntrusted,
} from "./prompts";
import { validateExperimentSpec } from "./validation";
import { closestFixture } from "@/lib/fixtures";

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
  | "provider-error"
  | "invalid-after-repair";

const FALLBACK_PHRASES: Record<CompileFallbackReason, string> = {
  "missing-credentials": "The AI compiler is not configured on this server.",
  timeout: "The AI compiler timed out.",
  "provider-error": "The AI compiler is temporarily unavailable.",
  "invalid-after-repair":
    "The AI compiler could not produce a valid experiment for this request.",
};

export interface CompileOptions {
  gradeBand: GradeBand;
}

export interface CompileDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function fixtureResponse(
  intent: LearningIntent,
  gradeBand: GradeBand,
  reason: CompileFallbackReason,
): CompileResponse {
  const fixture = closestFixture(intent);
  const spec = structuredClone(fixture.spec);
  spec.gradeBand = gradeBand;
  return {
    spec,
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

function parseAndValidate(toolArguments: string | null): AttemptOutcome {
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
  const result = validateExperimentSpec(candidate);
  return result.ok ? { spec: result.spec, errors: [] } : { errors: result.errors };
}

export async function compileExperiment(
  intent: LearningIntent,
  options: CompileOptions,
  deps: CompileDeps = {},
): Promise<CompileResponse> {
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return fixtureResponse(intent, options.gradeBand, "missing-credentials");
  }

  const request = { intent, gradeBand: options.gradeBand };
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
        },
        deps.fetchImpl,
      );
      const outcome = parseAndValidate(result.toolArguments);
      if (outcome.spec) {
        return {
          spec: outcome.spec,
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
      // Keep the invalid output in context so the repair sees what it wrote.
      messages.push({
        role: "assistant",
        content: result.toolArguments ?? result.content ?? "",
      });
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        return fixtureResponse(intent, options.gradeBand, "timeout");
      }
      if (error instanceof MissingCredentialsError) {
        return fixtureResponse(intent, options.gradeBand, "missing-credentials");
      }
      // HTTP or envelope errors are not repairable by the model.
      return fixtureResponse(intent, options.gradeBand, "provider-error");
    }
  }

  return fixtureResponse(intent, options.gradeBand, "invalid-after-repair");
}
