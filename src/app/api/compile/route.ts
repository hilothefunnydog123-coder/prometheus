import { NextResponse } from "next/server";
import {
  analyzeInput,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageInput,
  type SupportedImageMimeType,
} from "@/lib/ai/analyze-input";
import { compileExperiment } from "@/lib/ai/compile-experiment";
import { escapeHtml } from "@/lib/ai/errors";
import {
  RATE_LIMITS,
  clientKeyFromRequest,
  createRateLimiter,
} from "@/lib/api/rate-limit";

/**
 * POST /api/compile — multipart/form-data
 *   text:  required, 1..2000 chars after trimming
 *   image: optional file, image/png | image/jpeg | image/webp, <= 4 MB
 *
 * Response 200: { intent, spec, meta } — spec is ALWAYS a valid
 * ExperimentSpec (validated model output or a bundled fixture).
 *
 * Error responses use static, pre-escaped messages and never echo user
 * input: { error: { code, message } }.
 */

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

// Per-instance, in-memory: resets on redeploy, which is fine for the
// hackathon deployment shape (single server process).
const limiter = createRateLimiter(RATE_LIMITS.compile);

function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  // Messages are static strings; escapeHtml is defense in depth so nothing
  // markup-significant can ever appear in an error payload.
  return NextResponse.json(
    { error: { code, message: escapeHtml(message) } },
    { status },
  );
}

function isSupportedImageMime(
  mimeType: string,
): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
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
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send multipart/form-data with a 'text' field and an optional 'image' file.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      413,
      "payload_too_large",
      "Request exceeds the 6 MB limit.",
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      400,
      "malformed_request",
      "The multipart form data could not be parsed.",
    );
  }

  const textEntry = form.get("text");
  if (typeof textEntry !== "string" || textEntry.trim().length === 0) {
    return errorResponse(
      400,
      "invalid_text",
      "A non-empty 'text' field is required.",
    );
  }
  if (textEntry.length > MAX_TEXT_LENGTH) {
    return errorResponse(
      400,
      "text_too_long",
      "The 'text' field must be 2000 characters or fewer.",
    );
  }

  let image: ImageInput | undefined;
  const imageEntry = form.get("image");
  if (imageEntry !== null) {
    if (typeof imageEntry === "string" || !(imageEntry instanceof File)) {
      return errorResponse(
        400,
        "invalid_image",
        "The 'image' field must be an uploaded file.",
      );
    }
    if (!isSupportedImageMime(imageEntry.type)) {
      return errorResponse(
        415,
        "unsupported_image_type",
        "Images must be PNG, JPEG, or WebP.",
      );
    }
    if (imageEntry.size > MAX_IMAGE_BYTES) {
      return errorResponse(
        413,
        "image_too_large",
        "Images must be 4 MB or smaller.",
      );
    }
    const buffer = Buffer.from(await imageEntry.arrayBuffer());
    image = {
      mimeType: imageEntry.type,
      base64Data: buffer.toString("base64"),
    };
  }

  try {
    const intent = await analyzeInput(textEntry, image);
    const { spec, meta } = await compileExperiment(intent);
    return NextResponse.json({ intent, spec, meta }, { status: 200 });
  } catch {
    // analyzeInput/compileExperiment are designed to be total, so this is a
    // genuine bug path; keep the message generic.
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while compiling the experiment.",
    );
  }
}
