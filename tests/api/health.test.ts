import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { resetHealthProbeCache } from "@/lib/ai/health-probe";
import {
  createFetchStub,
  jsonResponse,
  textResponse,
} from "@/lib/ai/testing/mock-provider";

beforeEach(() => {
  resetHealthProbeCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function probeRequest(): Request {
  return new Request("http://test.local/api/health?probe=1");
}

type ProbeBody = {
  status: string;
  aiProviderConfigured: boolean;
  probe: { ok: boolean; code: string; model: string | null; hint: string };
};

describe("GET /api/health", () => {
  it("reports an operational app without exposing configuration", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const response = await GET(new Request("http://test.local/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      aiProviderConfigured: false,
    });
  });

  it("reports only whether the provider is configured", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "super-secret-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("FEATHERLESS_TEXT_MODEL", "private-model-name");
    const response = await GET(new Request("http://test.local/api/health"));
    const raw = await response.text();

    expect(JSON.parse(raw)).toEqual({
      status: "ok",
      aiProviderConfigured: true,
    });
    expect(raw).not.toContain("super-secret-key");
    expect(raw).not.toContain("private-model-name");
  });

  it("probe reports missing credentials without contacting a provider", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const stub = createFetchStub([]);
    vi.stubGlobal("fetch", stub.fetchImpl);

    const body = (await (await GET(probeRequest())).json()) as ProbeBody;
    expect(body.probe.ok).toBe(false);
    expect(body.probe.code).toBe("missing-credentials");
    expect(stub.calls).toHaveLength(0);
  });

  it("probe classifies an unknown model as model-not-found", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "test-key");
    vi.stubEnv("FEATHERLESS_TEXT_MODEL", "no-such-model");
    const stub = createFetchStub([jsonResponse({ error: "not found" }, 404)]);
    vi.stubGlobal("fetch", stub.fetchImpl);

    const raw = await (await GET(probeRequest())).text();
    const body = JSON.parse(raw) as ProbeBody;
    expect(body.probe.ok).toBe(false);
    expect(body.probe.code).toBe("model-not-found");
    expect(body.probe.model).toBe("no-such-model");
    expect(raw).not.toContain("test-key");
  });

  it("probe reports ok when the provider answers, and caches the result", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "test-key");
    const stub = createFetchStub([textResponse("ok")]);
    vi.stubGlobal("fetch", stub.fetchImpl);

    const first = (await (await GET(probeRequest())).json()) as ProbeBody;
    expect(first.probe.ok).toBe(true);
    expect(first.probe.code).toBe("ok");

    const second = (await (await GET(probeRequest())).json()) as ProbeBody;
    expect(second.probe.ok).toBe(true);
    // Cached: the provider is contacted once, not per request.
    expect(stub.calls).toHaveLength(1);
  });

  it("probe classifies a 429 as rate-limited", async () => {
    vi.stubEnv("FEATHERLESS_API_KEY", "test-key");
    const stub = createFetchStub([
      jsonResponse({ error: "quota" }, 429),
      jsonResponse({ error: "quota" }, 429),
    ]);
    vi.stubGlobal("fetch", stub.fetchImpl);

    const body = (await (await GET(probeRequest())).json()) as ProbeBody;
    expect(body.probe.ok).toBe(false);
    expect(body.probe.code).toBe("rate-limited");
  });
});
