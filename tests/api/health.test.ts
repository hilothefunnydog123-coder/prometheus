import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports an operational app without exposing configuration", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      aiProviderConfigured: false,
    });
  });

  it("reports only whether the provider is configured", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "super-secret-key");
    vi.stubEnv("FEATHERLESS_TEXT_MODEL", "private-model-name");
    const response = await GET();
    const raw = await response.text();

    expect(JSON.parse(raw)).toEqual({
      status: "ok",
      aiProviderConfigured: true,
    });
    expect(raw).not.toContain("super-secret-key");
    expect(raw).not.toContain("private-model-name");
  });
});
