import { getFeatherlessConfig } from "./config";
import type { ExperimentSpec } from "./contracts/experiment-spec";
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
 * compileExperiment: LearningIntent -> validated ExperimentSpec.
 *
 * Pipeline: model attempt -> validate -> (on failure) one repair attempt
 * with concise validation errors -> validate -> deterministic fixture
 * fallback. Missing credentials and timeouts skip straight to the fallback.
 * The returned spec is ALWAYS valid: either validated model output or a
 * golden fixture.
 */

export type CompileSource = "model" | "model-repaired" | "fixture";

export type CompileFallbackReason =
  | "missing-credentials"
  | "timeout"
  | "provider-error"
  | "invalid-after-repair";

export interface CompileMeta {
  source: CompileSource;
  /** Model attempts made (0 when credentials are missing). */
  attempts: number;
  latencyMs: number;
  fixtureId?: string;
  fallbackReason?: CompileFallbackReason;
}

export interface CompileResult {
  spec: ExperimentSpec;
  meta: CompileMeta;
}

export interface CompileDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function fixtureResult(
  intent: LearningIntent,
  reason: CompileFallbackReason,
  attempts: number,
  startedAt: number,
): CompileResult {
  const fixture = closestFixture(intent);
  return {
    spec: fixture.spec,
    meta: {
      source: "fixture",
      attempts,
      latencyMs: Date.now() - startedAt,
      fixtureId: fixture.spec.id,
      fallbackReason: reason,
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
  deps: CompileDeps = {},
): Promise<CompileResult> {
  const startedAt = Date.now();
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return fixtureResult(intent, "missing-credentials", 0, startedAt);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: COMPILE_SYSTEM_PROMPT },
    { role: "user", content: wrapUntrusted(JSON.stringify(intent)) },
  ];

  let attempts = 0;
  let lastErrors: string[] = [];

  for (const phase of ["initial", "repair"] as const) {
    if (phase === "repair") {
      messages.push({ role: "user", content: repairPrompt(lastErrors) });
    }
    attempts += 1;
    try {
      const result = await chatCompletion(
        config,
        {
          model: config.textModel,
          messages,
          tool: EMIT_EXPERIMENT_SPEC_TOOL,
        },
        deps.fetchImpl,
      );
      const outcome = parseAndValidate(result.toolArguments);
      if (outcome.spec) {
        return {
          spec: outcome.spec,
          meta: {
            source: phase === "initial" ? "model" : "model-repaired",
            attempts,
            latencyMs: Date.now() - startedAt,
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
        return fixtureResult(intent, "timeout", attempts, startedAt);
      }
      if (error instanceof MissingCredentialsError) {
        return fixtureResult(intent, "missing-credentials", attempts, startedAt);
      }
      // HTTP or envelope errors are not repairable by the model.
      return fixtureResult(intent, "provider-error", attempts, startedAt);
    }
  }

  return fixtureResult(intent, "invalid-after-repair", attempts, startedAt);
}
