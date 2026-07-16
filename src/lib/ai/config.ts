/**
 * Server-only provider configuration. Values are read from the environment
 * at call time (never at module load) so tests and routes see current env.
 *
 * The API key is intentionally never logged and never included in errors.
 */

export interface FeatherlessConfig {
  apiKey: string;
  textModel: string;
  visionModel: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokensParameter: "max_tokens" | "max_completion_tokens" | null;
  supportsTemperature: boolean;
  toolChoiceMode?: "named" | "auto";
}

export const DEFAULT_BASE_URL = "https://api.featherless.ai/v1";
export const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_GEMINI_TIMEOUT_MS = 25_000;

/** Documented defaults; override with FEATHERLESS_TEXT_MODEL / _VISION_MODEL. */
export const DEFAULT_TEXT_MODEL = "Qwen/Qwen3-32B";
export const DEFAULT_VISION_MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_NETLIFY_GATEWAY_MODEL = "gpt-5.4-mini";

/**
 * Throws if imported into a browser bundle. Every module that can touch the
 * API key calls this before doing work.
 */
export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("Featherless client must never run in the browser");
  }
}

/**
 * Explicit provider credentials take priority over Netlify AI Gateway.
 * Gemini's OpenAI-compatible endpoint lets it share the same validated client
 * pipeline as Featherless. On Netlify, OPENAI_API_KEY + OPENAI_BASE_URL may
 * also be injected automatically by AI Gateway. Returns null only when none
 * of these providers is available.
 */
export function getFeatherlessConfig(
  env: NodeJS.ProcessEnv = process.env,
): FeatherlessConfig | null {
  assertServerOnly();
  const featherlessApiKey = env.FEATHERLESS_API_KEY?.trim();
  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  const netlifyApiKey = env.OPENAI_API_KEY?.trim();
  const netlifyBaseUrl = env.OPENAI_BASE_URL?.trim();

  const timeoutRaw = Number(env.FEATHERLESS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.min(timeoutRaw, 120_000)
      : DEFAULT_TIMEOUT_MS;

  if (featherlessApiKey) {
    return {
      apiKey: featherlessApiKey,
      textModel: env.FEATHERLESS_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
      visionModel: env.FEATHERLESS_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
      baseUrl: (env.FEATHERLESS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
        /\/+$/,
        "",
      ),
      timeoutMs,
      maxTokensParameter: "max_tokens",
      supportsTemperature: true,
    };
  }

  if (geminiApiKey) {
    const geminiModel =
      env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const geminiTimeoutRaw = Number(
      env.GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT_MS,
    );
    const geminiTimeoutMs =
      Number.isFinite(geminiTimeoutRaw) && geminiTimeoutRaw > 0
        ? Math.min(geminiTimeoutRaw, 120_000)
        : DEFAULT_GEMINI_TIMEOUT_MS;
    return {
      apiKey: geminiApiKey,
      textModel: geminiModel,
      visionModel: env.GEMINI_VISION_MODEL?.trim() || geminiModel,
      baseUrl: (
        env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL
      ).replace(/\/+$/, ""),
      timeoutMs: geminiTimeoutMs,
      // Google's OpenAI-compatibility examples use automatic function
      // selection and omit optional sampling/token fields. Keeping the Gemini
      // request to that documented surface avoids provider-side HTTP 400s.
      maxTokensParameter: null,
      supportsTemperature: false,
      toolChoiceMode: "auto",
    };
  }

  if (netlifyApiKey && netlifyBaseUrl) {
    const baseUrl = netlifyBaseUrl.replace(/\/+$/, "");
    const gatewayModel =
      env.NETLIFY_AI_MODEL?.trim() || DEFAULT_NETLIFY_GATEWAY_MODEL;
    return {
      apiKey: netlifyApiKey,
      textModel: gatewayModel,
      visionModel: env.NETLIFY_AI_VISION_MODEL?.trim() || gatewayModel,
      baseUrl: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      timeoutMs,
      maxTokensParameter: "max_completion_tokens",
      supportsTemperature: false,
    };
  }

  return null;
}
