import { assertServerOnly, type FeatherlessConfig } from "./config";
import {
  ModelOutputError,
  ProviderCancelledError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./errors";

/**
 * Minimal server-only client for the Featherless OpenAI-compatible
 * chat-completions endpoint. Supports forced tool calls so every model
 * response is constrained to a JSON schema instead of free text.
 *
 * The fetch implementation is injectable so unit tests never touch the
 * network. Nothing in this module logs — the Authorization header must never
 * appear in output of any kind.
 */

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (Zod remains the source of truth). */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** When set, the model is forced to call exactly this tool. */
  tool?: ToolDefinition;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Cancels the provider call when the incoming request is abandoned. */
  signal?: AbortSignal;
}

export interface ChatResult {
  /** Raw JSON string of the forced tool call's arguments, if any. */
  toolArguments: string | null;
  /** Assistant text content, if any. */
  content: string | null;
  latencyMs: number;
}

interface ProviderResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);
export const TRANSIENT_RETRY_DELAY_MS = 250;
const MAX_PROVIDER_ATTEMPTS = 2;

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new ProviderCancelledError());
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new ProviderCancelledError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function readResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new ModelOutputError("provider response exceeded the size limit");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains authoritative if cancellation races.
        }
        throw new ModelOutputError("provider response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ModelOutputError("provider response was not valid UTF-8");
  }
}

export async function chatCompletion(
  config: FeatherlessConfig,
  request: ChatRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResult> {
  assertServerOnly();
  if (request.signal?.aborted) {
    throw new ProviderCancelledError();
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await chatCompletionOnce(config, request, fetchImpl);
    } catch (error) {
      if (request.signal?.aborted) {
        throw new ProviderCancelledError();
      }
      const transient =
        error instanceof ProviderHttpError &&
        TRANSIENT_HTTP_STATUSES.has(error.status);
      if (!transient || attempt >= MAX_PROVIDER_ATTEMPTS) {
        throw error;
      }
      await waitForRetry(TRANSIENT_RETRY_DELAY_MS, request.signal);
    }
  }
}

async function chatCompletionOnce(
  config: FeatherlessConfig,
  request: ChatRequest,
  fetchImpl: typeof fetch,
): Promise<ChatResult> {
  if (request.signal?.aborted) {
    throw new ProviderCancelledError();
  }

  const requestedTimeout = request.timeoutMs ?? config.timeoutMs;
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(requestedTimeout, 120_000)
      : config.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancelFromCaller = () => controller.abort();
  if (request.signal?.aborted) {
    cancelFromCaller();
  } else {
    request.signal?.addEventListener("abort", cancelFromCaller, { once: true });
  }
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    [config.maxTokensParameter]: request.maxTokens ?? 1600,
  };
  if (config.supportsTemperature) {
    body.temperature = request.temperature ?? 0.2;
  }
  if (request.tool) {
    body.tools = [
      {
        type: "function",
        function: {
          name: request.tool.name,
          description: request.tool.description,
          parameters: request.tool.parameters,
        },
      },
    ];
    body.tool_choice = {
      type: "function",
      function: { name: request.tool.name },
    };
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new ProviderRateLimitError();
      }
      throw new ProviderHttpError(response.status);
    }

    const rawResponse = await readResponseText(
      response,
      MAX_PROVIDER_RESPONSE_BYTES,
    );
    if (rawResponse.trim().length === 0) {
      throw new ModelOutputError("provider response was empty");
    }

    let parsed: ProviderResponse;
    try {
      parsed = JSON.parse(rawResponse) as ProviderResponse;
    } catch {
      throw new ModelOutputError("provider response was not valid JSON");
    }

    const message = parsed.choices?.[0]?.message;
    if (!message || typeof message !== "object") {
      throw new ModelOutputError("provider response had no choices");
    }

    const toolCall = request.tool
      ? message.tool_calls?.find(
          (call) => call.function?.name === request.tool?.name,
        )
      : message.tool_calls?.[0];
    const rawArguments = toolCall?.function?.arguments;
    if (
      rawArguments !== undefined &&
      (typeof rawArguments !== "string" || rawArguments.trim().length === 0)
    ) {
      throw new ModelOutputError("tool arguments were empty");
    }
    if (
      typeof rawArguments === "string" &&
      new TextEncoder().encode(rawArguments).byteLength >
        MAX_TOOL_ARGUMENT_BYTES
    ) {
      throw new ModelOutputError("tool arguments exceeded the size limit");
    }
    const content =
      typeof message.content === "string" && message.content.trim().length > 0
        ? message.content
        : null;

    if (request.tool && message.tool_calls?.length && !toolCall) {
      throw new ModelOutputError("provider called the wrong tool");
    }
    if (!rawArguments && content === null) {
      throw new ModelOutputError("provider response contained no output");
    }

    return {
      toolArguments: rawArguments ?? null,
      content,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (
      error instanceof ModelOutputError ||
      error instanceof ProviderHttpError
    ) {
      throw error;
    }
    if (timedOut) {
      throw new ProviderTimeoutError(timeoutMs);
    }
    if (request.signal?.aborted) {
      throw new ProviderCancelledError();
    }
    throw new ProviderNetworkError();
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", cancelFromCaller);
  }
}
