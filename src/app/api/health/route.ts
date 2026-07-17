import { NextResponse } from "next/server";
import { getFeatherlessConfig } from "@/lib/ai/config";
import { runHealthProbe } from "@/lib/ai/health-probe";

export const runtime = "nodejs";

/**
 * GET /api/health           -> { status, aiProviderConfigured }   (unchanged)
 * GET /api/health?probe=1   -> adds a live one-token provider check:
 *   probe: { ok, code, model, hint }   (see src/lib/ai/health-probe.ts)
 */

export async function GET(request: Request): Promise<NextResponse> {
  const base = {
    status: "ok",
    aiProviderConfigured: getFeatherlessConfig() !== null,
  };

  let probeRequested = false;
  try {
    probeRequested = new URL(request.url).searchParams.get("probe") === "1";
  } catch {
    probeRequested = false;
  }

  if (!probeRequested) {
    return NextResponse.json(base, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  const probe = await runHealthProbe();
  return NextResponse.json(
    { ...base, probe },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
