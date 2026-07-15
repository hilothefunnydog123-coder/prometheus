import { NextResponse } from "next/server";
import {
  evaluateExplanation,
  evaluationInputSchema,
} from "@/lib/ai/evaluate-explanation";
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
    });
    return NextResponse.json(result, { status: 200 });
  } catch {
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while evaluating the explanation.",
    );
  }
}
