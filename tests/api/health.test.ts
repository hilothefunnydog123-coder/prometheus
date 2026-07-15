import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

const SECRET = "fl-super-secret-key-1234567890";

beforeEach(() => {
  vi.stubEnv("FEATHERLESS_API_KEY", SECRET);
  vi.stubEnv("FEATHERLESS_TEXT_MODEL", "");
  vi.stubEnv("FEATHERLESS_VISION_MODEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports app and provider configuration", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      provider: {
        configured: boolean;
        textModel: string;
        visionModel: string;
        baseUrl: string;
        timeoutMs: number;
      };
    };
    expect(body.status).toBe("ok");
    expect(body.provider.configured).toBe(true);
    expect(body.provider.textModel).toBe("Qwen/Qwen3-32B");
    expect(body.provider.visionModel).toBe("google/gemma-3-27b-it");
    expect(body.provider.baseUrl).toContain("featherless");
    expect(body.provider.timeoutMs).toBeGreaterThan(0);
  });

  it("never leaks the API key or any secret material", async () => {
    const response = await GET();
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toContain(SECRET);
    expect(raw.toLowerCase()).not.toContain("apikey");
    expect(raw.toLowerCase()).not.toContain("api_key");
    expect(raw).not.toContain("Bearer");
  });

  it("reports configured=false without credentials", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "");
    const response = await GET();
    const body = (await response.json()) as {
      provider: { configured: boolean; textModel: string };
    };
    expect(body.provider.configured).toBe(false);
    expect(body.provider.textModel).toBe("Qwen/Qwen3-32B"); // defaults still shown
  });

  it("honors model overrides from the environment", async () => {
    vi.stubEnv("FEATHERLESS_TEXT_MODEL", "custom/text-model");
    vi.stubEnv("FEATHERLESS_VISION_MODEL", "custom/vision-model");
    const response = await GET();
    const body = (await response.json()) as {
      provider: { textModel: string; visionModel: string };
    };
    expect(body.provider.textModel).toBe("custom/text-model");
    expect(body.provider.visionModel).toBe("custom/vision-model");
  });
});
