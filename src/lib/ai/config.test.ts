import { describe, expect, it } from "vitest";
import {
  DEFAULT_NETLIFY_GATEWAY_MODEL,
  getFeatherlessConfig,
} from "./config";

describe("getFeatherlessConfig", () => {
  it("prefers an explicitly configured Featherless provider", () => {
    const config = getFeatherlessConfig({
      NODE_ENV: "test",
      FEATHERLESS_API_KEY: "featherless-key",
      OPENAI_API_KEY: "gateway-key",
      OPENAI_BASE_URL: "https://gateway.example",
    });
    expect(config?.apiKey).toBe("featherless-key");
    expect(config?.maxTokensParameter).toBe("max_tokens");
  });

  it("uses Netlify AI Gateway when its OpenAI variables are injected", () => {
    const config = getFeatherlessConfig({
      NODE_ENV: "test",
      OPENAI_API_KEY: "gateway-key",
      OPENAI_BASE_URL: "https://gateway.example",
    });
    expect(config).toMatchObject({
      apiKey: "gateway-key",
      baseUrl: "https://gateway.example/v1",
      textModel: DEFAULT_NETLIFY_GATEWAY_MODEL,
      visionModel: DEFAULT_NETLIFY_GATEWAY_MODEL,
      maxTokensParameter: "max_completion_tokens",
      supportsTemperature: false,
    });
  });

  it("does not use an unrelated OpenAI key without a gateway base URL", () => {
    expect(
      getFeatherlessConfig({
        NODE_ENV: "test",
        OPENAI_API_KEY: "unpaired-key",
      }),
    ).toBeNull();
  });
});
