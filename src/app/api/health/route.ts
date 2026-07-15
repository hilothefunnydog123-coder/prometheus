import { NextResponse } from "next/server";
import { getFeatherlessConfig } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      aiProviderConfigured: getFeatherlessConfig() !== null,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
