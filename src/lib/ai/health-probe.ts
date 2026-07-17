import { getFeatherlessConfig } from "./config";
import { chatCompletion } from "./featherless-client";
import {
  MissingCredentialsError,
  ModelOutputError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./errors";

/**
 * Live provider self-diagnosis behind GET /api/health?probe=1.
 *
 * Exists so an operator can diagnose a misconfigured deployment from a
 * browser URL instead of reading function logs. It reports only a
 * classification code, the configured model name, and a static hint — never
 * the API key, base URL, or any provider response content. Results are
 * cached for 30 seconds per instance so the public endpoint cannot be used
 * to drain provider quota.
 */

export type ProbeReport = {
  ok: boolean;
  code: string;
  model: string | null;
  hint: string;
};

const PROBE_CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;

let probeCache: { at: number; report: ProbeReport } | null = null;

/** Test-only: clear the probe cache between cases. */
export function resetHealthProbeCache(): void {
  probeCache = null;
}

function classifyProbeError(error: unknown, model: string): ProbeReport {
  if (error instanceof ProviderRateLimitError) {
    return {
      ok: false,
      code: "rate-limited",
      model,
      hint: "The provider returned 429. The Google/provider project is out of quota — wait for the reset, use a key from a different project, or enable billing.",
    };
  }
  if (error instanceof ProviderTimeoutError) {
    return {
      ok: false,
      code: "timeout",
      model,
      hint: "The model did not answer within the probe window. Use a faster model (a flash/lite variant) and keep GEMINI_TIMEOUT_MS below the hosting function limit.",
    };
  }
  if (error instanceof ProviderNetworkError) {
    return {
      ok: false,
      code: "network",
      model,
      hint: "The provider host could not be reached. Check the configured base URL.",
    };
  }
  if (error instanceof ProviderHttpError) {
    if (error.status === 404) {
      return {
        ok: false,
        code: "model-not-found",
        model,
        hint: "The provider does not recognize this model name for this API key. List your models at the provider and copy the exact name.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        ok: false,
        code: "auth",
        model,
        hint: "The provider rejected the API key or its permissions. Regenerate the key and confirm the API is enabled for its project.",
      };
    }
    if (error.status === 400) {
      return {
        ok: false,
        code: "request-rejected",
        model,
        hint: "The provider rejected the request format for this model.",
      };
    }
    return {
      ok: false,
      code: `provider-http-${error.status}`,
      model,
      hint: "The provider returned an unexpected HTTP error.",
    };
  }
  if (error instanceof ModelOutputError) {
    // The provider answered; unusable text for a one-word probe is still a
    // working key + model, which is all the probe measures.
    return { ok: true, code: "ok", model, hint: "Provider reachable." };
  }
  return {
    ok: false,
    code: "unknown",
    model,
    hint: "An unclassified error occurred while contacting the provider.",
  };
}

export async function runHealthProbe(): Promise<ProbeReport> {
  const now = Date.now();
  if (probeCache && now - probeCache.at < PROBE_CACHE_TTL_MS) {
    return probeCache.report;
  }
  const config = getFeatherlessConfig();
  let report: ProbeReport;
  if (!config) {
    report = {
      ok: false,
      code: "missing-credentials",
      model: null,
      hint: "No provider key found. Set GEMINI_API_KEY or FEATHERLESS_API_KEY (or OPENAI_API_KEY + OPENAI_BASE_URL) and redeploy.",
    };
  } else {
    try {
      await chatCompletion(config, {
        model: config.textModel,
        messages: [
          { role: "user", content: "Reply with the single word: ok" },
        ],
        maxTokens: 10,
        timeoutMs: Math.min(config.timeoutMs, PROBE_TIMEOUT_MS),
      });
      report = {
        ok: true,
        code: "ok",
        model: config.textModel,
        hint: "Provider reachable and the configured model answered.",
      };
    } catch (error) {
      if (error instanceof MissingCredentialsError) {
        report = {
          ok: false,
          code: "missing-credentials",
          model: config.textModel,
          hint: "No provider key found. Set GEMINI_API_KEY or FEATHERLESS_API_KEY and redeploy.",
        };
      } else {
        report = classifyProbeError(error, config.textModel);
      }
    }
  }
  probeCache = { at: now, report };
  return report;
}
