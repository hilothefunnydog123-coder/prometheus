import { NextResponse } from "next/server";
import {
  evaluateExplanation,
  evaluationInputSchema,
} from "@/lib/ai/evaluate-explanation";
import {
  MissingCredentialsError,
  ModelOutputError,
  ProviderCancelledError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "@/lib/ai/errors";
import {
  decodeUtf8,
  mediaTypeOf,
  readBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/app/api/_shared/request-body";

/**
 * POST /api/evaluate — application/json (matches the frontend exactly)
 *   {
 *     experimentId: string,
 *     observedOutcome?: string,
 *     question: string,
 *     objective: string,
 *     evidenceSummary: string,
 *     studentExplanation: string,
 *     misconception: MisconceptionSpec
 *   }
 *
 * Response 200: { score, criteria, feedback, hint } (EvaluationResponse).
 * criteria has one boolean per rubric item, in rubric order; score is
 * computed server-side as passed/total.
 *
 * INVARIANT: this route generates feedback only. It must never import or
 * call the mastery module; applying results to BKT state is the frontend's
 * decision (enforced by tests/api/evaluate.test.ts).
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status },
  );
}

function aiErrorResponse(error: unknown): NextResponse {
  if (error instanceof MissingCredentialsError) {
    return errorResponse(
      503,
      "ai_not_configured",
      "AI explanation feedback is not configured on this deployment. Enable Netlify AI Gateway or add the Featherless API key, then try again.",
    );
  }
  if (error instanceof ProviderRateLimitError) {
    return errorResponse(429, "ai_busy", "The AI feedback service is busy. Please retry in a moment.");
  }
  if (error instanceof ProviderTimeoutError) {
    return errorResponse(504, "ai_timeout", "The AI feedback service took too long to respond. Please retry.");
  }
  if (error instanceof ProviderCancelledError) {
    return errorResponse(408, "request_cancelled", "The feedback request was cancelled.");
  }
  if (error instanceof ProviderNetworkError || error instanceof ProviderHttpError) {
    return errorResponse(503, "ai_unavailable", "The AI feedback service is temporarily unavailable. Please retry.");
  }
  if (error instanceof ModelOutputError) {
    return errorResponse(502, "ai_invalid_output", "The AI could not produce valid feedback. Please retry.");
  }
  return errorResponse(500, "internal_error", "Something went wrong while evaluating the explanation.");
}

export async function POST(request: Request): Promise<NextResponse> {
  if (mediaTypeOf(request.headers.get("content-type")) !== "application/json") {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send application/json with experimentId, studentExplanation, and misconception fields.",
    );
  }

  let rawBody: string;
  try {
    rawBody = decodeUtf8(await readBodyWithLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        413,
        "payload_too_large",
        "Request exceeds the 64 KB limit.",
      );
    }
    return errorResponse(400, "malformed_request", "The request body could not be read.");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json", "The request body is not valid JSON.");
  }

  const parsed = evaluationInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      "Expected { experimentId, observedOutcome?, studentExplanation, misconception } within documented limits.",
    );
  }

  try {
    const result = await evaluateExplanation(parsed.data, {
      signal: request.signal,
      fallbackMode: "error",
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
