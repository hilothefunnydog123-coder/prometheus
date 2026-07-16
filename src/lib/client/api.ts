import type { ExperimentSpec } from "@/lib/ai/contracts/experiment-spec";
import type { EvaluationResult } from "@/lib/ai/contracts/evaluation";
import type { LearningIntent } from "@/lib/ai/contracts/learning-intent";
import type { CompileMeta } from "@/lib/ai/compile-experiment";

/**
 * Thin typed client for the two API routes. Every function returns a
 * discriminated result instead of throwing so the UI can render friendly
 * messages without try/catch towers.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export interface CompileResponse {
  intent: LearningIntent;
  spec: ExperimentSpec;
  meta: CompileMeta;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function friendlyError(response: Response): Promise<string> {
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Try again in about ${retryAfter}s.`
      : " Try again shortly.";
    return `You're going a little fast for the lab.${wait}`;
  }
  try {
    const body = (await response.json()) as ErrorBody;
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through to the generic message
  }
  return "Something went wrong. Please try again.";
}

export async function requestCompile(
  text: string,
  image?: File | null,
): Promise<ApiResult<CompileResponse>> {
  const form = new FormData();
  form.set("text", text);
  if (image) form.set("image", image);
  try {
    const response = await fetch("/api/compile", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      return { ok: false, message: await friendlyError(response) };
    }
    return { ok: true, data: (await response.json()) as CompileResponse };
  } catch {
    return {
      ok: false,
      message: "Could not reach the lab server. Check your connection.",
    };
  }
}

export interface EvaluateContext {
  family: ExperimentSpec["family"];
  question: string;
  concepts: string[];
}

export async function requestEvaluation(
  explanation: string,
  context: EvaluateContext,
): Promise<ApiResult<EvaluationResult>> {
  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ explanation, context }),
    });
    if (!response.ok) {
      return { ok: false, message: await friendlyError(response) };
    }
    return { ok: true, data: (await response.json()) as EvaluationResult };
  } catch {
    return {
      ok: false,
      message: "Could not reach the lab server. Check your connection.",
    };
  }
}
