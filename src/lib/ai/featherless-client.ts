import { assertServerOnly, type FeatherlessConfig } from "./config";
import {
  ModelOutputError,
  ProviderHttpError,
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

export async function chatCompletion(
  config: FeatherlessConfig,
  request: ChatRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResult> {
  assertServerOnly();

  const timeoutMs = request.timeoutMs ?? config.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? 1600,
  };
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

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderTimeoutError(timeoutMs);
    }
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ProviderHttpError(response.status);
  }

  let parsed: ProviderResponse;
  try {
    parsed = (await response.json()) as ProviderResponse;
  } catch {
    throw new ModelOutputError("provider response was not valid JSON");
  }

  const message = parsed.choices?.[0]?.message;
  if (!message) {
    throw new ModelOutputError("provider response had no choices");
  }

  return {
    toolArguments: message.tool_calls?.[0]?.function?.arguments ?? null,
    content: typeof message.content === "string" ? message.content : null,
    latencyMs: Date.now() - startedAt,
  };
}
