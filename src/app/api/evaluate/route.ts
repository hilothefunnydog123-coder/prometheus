import { NextResponse } from "next/server";
import { z } from "zod";
import { misconceptionSchema } from "@/lib/contracts/experiment";
import { escapeHtml } from "@/lib/ai/errors";
import { evaluateExplanation } from "@/lib/ai/evaluate-explanation";

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

const evaluateRequestSchema = z.object({
  experimentId: z.string().trim().min(1).max(80),
  observedOutcome: z.string().trim().min(1).max(60).optional(),
  studentExplanation: z.string().min(1).max(4000),
  misconception: misconceptionSchema,
});

function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message: escapeHtml(message) } },
    { status },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send application/json with experimentId, studentExplanation, and misconception fields.",
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse(400, "malformed_request", "The request body could not be read.");
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "Request exceeds the 64 KB limit.");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json", "The request body is not valid JSON.");
  }

  const parsed = evaluateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      "Expected { experimentId, observedOutcome?, studentExplanation, misconception } within documented limits.",
    );
  }

  try {
    const result = await evaluateExplanation(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch {
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while evaluating the explanation.",
    );
  }
}
