import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EXPERIMENT_FAMILIES,
  slugSchema,
} from "@/lib/ai/contracts/experiment-spec";
import { escapeHtml } from "@/lib/ai/errors";
import { evaluateExplanation } from "@/lib/ai/evaluate-explanation";
import {
  RATE_LIMITS,
  clientKeyFromRequest,
  createRateLimiter,
} from "@/lib/api/rate-limit";

/**
 * POST /api/evaluate — application/json
 *   {
 *     explanation: string (1..4000),
 *     context: { family, question, concepts }
 *   }
 *
 * Response 200: EvaluationResult — structured rubric + advisory
 * masterySignal.
 *
 * INVARIANT: this route generates feedback only. It must never import or
 * call the mastery module; applying masterySignal to BKT state is the
 * client's decision (enforced by tests/api/evaluate.test.ts).
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

// Per-instance, in-memory: resets on redeploy, which is fine for the
// hackathon deployment shape (single server process).
const limiter = createRateLimiter(RATE_LIMITS.evaluate);

const evaluateRequestSchema = z
  .object({
    explanation: z.string().min(1).max(4000),
    context: z
      .object({
        family: z.enum(EXPERIMENT_FAMILIES),
        question: z.string().trim().min(8).max(300),
        concepts: z.array(slugSchema).max(5),
      })
      .strict(),
  })
  .strict();

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
  const decision = limiter.check(clientKeyFromRequest(request));
  if (!decision.allowed) {
    const response = errorResponse(
      429,
      "rate_limited",
      "Too many requests. Try again shortly.",
    );
    response.headers.set("Retry-After", String(decision.retryAfterSeconds));
    return response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send application/json with 'explanation' and 'context' fields.",
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
      "Expected { explanation, context: { family, question, concepts } } within documented limits.",
    );
  }

  try {
    const result = await evaluateExplanation(
      parsed.data.explanation,
      parsed.data.context,
    );
    return NextResponse.json(result, { status: 200 });
  } catch {
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while evaluating the explanation.",
    );
  }
}
