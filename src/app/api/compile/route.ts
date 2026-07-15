import { NextResponse } from "next/server";
import { gradeBandSchema, type GradeBand } from "@/lib/contracts/experiment";
import {
  analyzeInput,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageInput,
  type SupportedImageMimeType,
} from "@/lib/ai/analyze-input";
import { compileExperiment } from "@/lib/ai/compile-experiment";
import { escapeHtml } from "@/lib/ai/errors";

/**
 * POST /api/compile — multipart/form-data (matches the frontend exactly)
 *   prompt:    required, 1..2000 chars after trimming
 *   gradeBand: required, "8-10" | "11-12"
 *   image:     optional file, image/png | image/jpeg | image/webp, <= 4 MB
 *
 * Success 200: { spec, warnings, provenance } (CompileResponse). The spec
 * is ALWAYS a valid ExperimentSpec with server-computed correctOutcomeKey
 * values. Provider trouble (missing credentials, timeout, provider error,
 * failed repair) still returns 200 with the closest golden fixture,
 * provenance.source = "validated-example", and the fallback disclosed in
 * warnings.
 *
 * Unsupported educational material returns 422 with a safe message naming
 * the three supported families.
 *
 * Error responses use static, pre-escaped messages and never echo user
 * input: { error: { code, message } }.
 */

export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

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

function isSupportedImageMime(
  mimeType: string,
): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send multipart/form-data with 'prompt' and 'gradeBand' fields and an optional 'image' file.",
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

  const promptEntry = form.get("prompt");
  if (typeof promptEntry !== "string" || promptEntry.trim().length === 0) {
    return errorResponse(
      400,
      "invalid_prompt",
      "A non-empty 'prompt' field is required.",
    );
  }
  if (promptEntry.length > MAX_PROMPT_LENGTH) {
    return errorResponse(
      400,
      "prompt_too_long",
      "The 'prompt' field must be 2000 characters or fewer.",
    );
  }

  const gradeBandEntry = form.get("gradeBand");
  const gradeBandParsed = gradeBandSchema.safeParse(gradeBandEntry);
  if (!gradeBandParsed.success) {
    return errorResponse(
      400,
      "invalid_grade_band",
      "The 'gradeBand' field must be '8-10' or '11-12'.",
    );
  }
  const gradeBand: GradeBand = gradeBandParsed.data;

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
    const intent = await analyzeInput(promptEntry, image);
    if (intent.family === "unknown") {
      return errorResponse(
        422,
        "unsupported_material",
        "This material is not supported yet. Counterfactual Lab covers three experiment families: drop (free fall), projectile motion, and pendulum. Try a question about one of those.",
      );
    }
    const response = await compileExperiment(intent, { gradeBand });
    return NextResponse.json(response, { status: 200 });
  } catch {
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong while compiling the experiment.",
    );
  }
}
