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
}

export const DEFAULT_BASE_URL = "https://api.featherless.ai/v1";
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Documented defaults; override with FEATHERLESS_TEXT_MODEL / _VISION_MODEL. */
export const DEFAULT_TEXT_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";
export const DEFAULT_VISION_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct";

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
 * Returns null when FEATHERLESS_API_KEY is absent — callers treat that as
 * "missing credentials" and take the deterministic fallback path.
 */
export function getFeatherlessConfig(
  env: NodeJS.ProcessEnv = process.env,
): FeatherlessConfig | null {
  assertServerOnly();
  const apiKey = env.FEATHERLESS_API_KEY?.trim();
  if (!apiKey) return null;

  const timeoutRaw = Number(env.FEATHERLESS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.min(timeoutRaw, 120_000)
      : DEFAULT_TIMEOUT_MS;

  return {
    apiKey,
    textModel: env.FEATHERLESS_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    visionModel: env.FEATHERLESS_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
    baseUrl: (env.FEATHERLESS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
    timeoutMs,
  };
}
