import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
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

  it("uses Gemini when GEMINI_API_KEY is configured", () => {
    const config = getFeatherlessConfig({
      NODE_ENV: "test",
      GEMINI_API_KEY: " gemini-key ",
    });
    expect(config).toMatchObject({
      apiKey: "gemini-key",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      textModel: DEFAULT_GEMINI_MODEL,
      visionModel: DEFAULT_GEMINI_MODEL,
      maxTokensParameter: "max_tokens",
      supportsTemperature: true,
    });
  });

  it("supports Gemini model and endpoint overrides", () => {
    const config = getFeatherlessConfig({
      NODE_ENV: "test",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-custom",
      GEMINI_VISION_MODEL: "gemini-vision-custom",
      GEMINI_BASE_URL: "https://gemini.example/openai/",
    });
    expect(config).toMatchObject({
      textModel: "gemini-custom",
      visionModel: "gemini-vision-custom",
      baseUrl: "https://gemini.example/openai",
    });
  });

  it("prefers explicit Featherless credentials over Gemini", () => {
    const config = getFeatherlessConfig({
      NODE_ENV: "test",
      FEATHERLESS_API_KEY: "featherless-key",
      GEMINI_API_KEY: "gemini-key",
    });
    expect(config?.apiKey).toBe("featherless-key");
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
