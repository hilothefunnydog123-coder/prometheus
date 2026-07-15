import { NextResponse } from "next/server";
import {
  DEFAULT_BASE_URL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VISION_MODEL,
  getFeatherlessConfig,
} from "@/lib/ai/config";

/**
 * GET /api/health — app and provider configuration, WITHOUT secrets.
 *
 * The response object is constructed field-by-field: the API key is never
 * read into it, so it cannot leak regardless of environment contents
 * (asserted by tests/api/health.test.ts).
 */

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const config = getFeatherlessConfig();
  return NextResponse.json(
    {
      status: "ok",
      service: "counterfactual-lab-api",
      contractVersion: "1.0",
      time: new Date().toISOString(),
      provider: {
        name: "featherless",
        configured: config !== null,
        baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
        textModel: config?.textModel ?? DEFAULT_TEXT_MODEL,
        visionModel: config?.visionModel ?? DEFAULT_VISION_MODEL,
        timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    },
    { status: 200 },
  );
}
