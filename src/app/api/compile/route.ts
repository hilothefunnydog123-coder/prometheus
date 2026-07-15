import { NextResponse } from "next/server";
import { gradeBandSchema, type GradeBand } from "@/lib/contracts/experiment";
import {
  analyzeInput,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageInput,
  type SupportedImageMimeType,
} from "@/lib/ai/analyze-input";
import { compileExperiment } from "@/lib/ai/compile-experiment";
import {
  MissingCredentialsError,
  ModelOutputError,
  ProviderCancelledError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "@/lib/ai/errors";
import { validateImageData } from "@/lib/ai/image-validation";
import {
  mediaTypeOf,
  readBodyWithLimit,
  replayRequest,
  RequestBodyTooLargeError,
} from "@/app/api/_shared/request-body";

/**
 * POST /api/compile — multipart/form-data (matches the frontend exactly)
 *   prompt:    required, 1..2000 chars after trimming
 *   gradeBand: required, "8-10" | "11-12"
 *   image:     optional file, image/png | image/jpeg | image/webp, <= 4 MB
 *
 * Success 200: { spec, warnings, provenance } (CompileResponse). The spec
 * is ALWAYS a model-generated, validated ExperimentSpec with server-computed
 * correctOutcomeKey values. Provider trouble is returned explicitly; this
 * route never relabels a bundled example as a response to a custom question.
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
    { error: { code, message } },
    { status },
  );
}

function aiErrorResponse(error: unknown): NextResponse {
  if (error instanceof MissingCredentialsError) {
    return errorResponse(
      503,
      "ai_not_configured",
      "AI experiment generation is not configured on this deployment. Enable Netlify AI Gateway or add the Featherless API key, then try again.",
    );
  }
  if (error instanceof ProviderRateLimitError) {
    return errorResponse(
      429,
      "ai_busy",
      "The AI experiment generator is busy right now. Please retry in a moment.",
    );
  }
  if (error instanceof ProviderTimeoutError) {
    return errorResponse(
      504,
      "ai_timeout",
      "The AI experiment generator took too long to respond. Please retry.",
    );
  }
  if (error instanceof ProviderCancelledError) {
    return errorResponse(408, "request_cancelled", "The generation request was cancelled.");
  }
  if (
    error instanceof ProviderNetworkError ||
    error instanceof ProviderHttpError
  ) {
    return errorResponse(
      503,
      "ai_unavailable",
      "The AI experiment generator is temporarily unavailable. Please retry.",
    );
  }
  if (error instanceof ModelOutputError) {
    return errorResponse(
      502,
      "ai_invalid_output",
      "The AI could not produce a safe, question-aligned experiment. Try rephrasing the question.",
    );
  }
  return errorResponse(
    500,
    "internal_error",
    "Something went wrong while compiling the experiment.",
  );
}

function isSupportedImageMime(
  mimeType: string,
): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (mediaTypeOf(request.headers.get("content-type")) !== "multipart/form-data") {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send multipart/form-data with 'prompt' and 'gradeBand' fields and an optional 'image' file.",
    );
  }

  let form: FormData;
  try {
    const body = await readBodyWithLimit(request, MAX_REQUEST_BYTES);
    form = await replayRequest(request, body).formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        413,
        "payload_too_large",
        "Request exceeds the 6 MB limit.",
      );
    }
    return errorResponse(
      400,
      "malformed_request",
      "The multipart form data could not be parsed.",
    );
  }

  const allowedFields = new Set(["prompt", "gradeBand", "image"]);
  const fieldNames = Array.from(form.keys());
  if (
    fieldNames.some((field) => !allowedFields.has(field)) ||
    form.getAll("prompt").length > 1 ||
    form.getAll("gradeBand").length > 1 ||
    form.getAll("image").length > 1
  ) {
    return errorResponse(
      400,
      "invalid_form",
      "Send exactly one 'prompt' and 'gradeBand' field and at most one 'image' file.",
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
  const prompt = promptEntry.trim();

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
    if (imageEntry.size === 0) {
      return errorResponse(
        400,
        "invalid_image",
        "The uploaded image is empty or invalid.",
      );
    }
    if (imageEntry.size > MAX_IMAGE_BYTES) {
      return errorResponse(
        413,
        "image_too_large",
        "Images must be 4 MB or smaller.",
      );
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(await imageEntry.arrayBuffer());
    } catch {
      return errorResponse(
        400,
        "invalid_image",
        "The uploaded image is empty or invalid.",
      );
    }
    const imageValidation = validateImageData(buffer, imageEntry.type);
    if (!imageValidation.ok) {
      if (imageValidation.reason === "dimensions-too-large") {
        return errorResponse(
          413,
          "image_dimensions_too_large",
          "Image dimensions must be 4096 by 4096 pixels or smaller.",
        );
      }
      if (imageValidation.reason === "mime-mismatch") {
        return errorResponse(
          415,
          "image_type_mismatch",
          "The image contents do not match the declared file type.",
        );
      }
      return errorResponse(
        400,
        "invalid_image",
        "The uploaded image is empty or invalid.",
      );
    }
    image = {
      mimeType: imageEntry.type,
      base64Data: buffer.toString("base64"),
    };
  }

  try {
    const intent = await analyzeInput(prompt, image, {
      signal: request.signal,
      fallbackMode: "error",
    });
    if (intent.family === "unknown") {
      return errorResponse(
        422,
        "unsupported_material",
        "This material is not supported yet. Counterfactual Lab covers three experiment families: drop (free fall), projectile motion, and pendulum. Try a question about one of those.",
      );
    }
    const response = await compileExperiment(
      intent,
      { gradeBand, sourceQuestion: prompt },
      { signal: request.signal, fallbackMode: "error" },
    );
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
