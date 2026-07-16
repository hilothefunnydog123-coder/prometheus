import { afterEach, describe, expect, it } from "vitest";
import type { FeatherlessConfig } from "./config";
import {
  ModelOutputError,
  ProviderCancelledError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "./errors";
import {
  chatCompletion,
  type ChatRequest,
  type ToolDefinition,
} from "./featherless-client";
import {
  createFetchStub,
  jsonResponse,
  textResponse,
  toolCallResponse,
} from "./testing/mock-provider";

const config: FeatherlessConfig = {
  apiKey: "test-key",
  textModel: "test-text-model",
  visionModel: "test-vision-model",
  baseUrl: "https://provider.test/v1",
  timeoutMs: 1000,
  maxTokensParameter: "max_tokens",
  supportsTemperature: true,
};

const request: ChatRequest = {
  model: config.textModel,
  messages: [{ role: "user", content: "hello" }],
};

const tool: ToolDefinition = {
  name: "some_tool",
  description: "Return structured output.",
  parameters: { type: "object", additionalProperties: false },
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("chatCompletion", () => {
  it("posts auth and forces the requested tool", async () => {
    const stub = createFetchStub([
      toolCallResponse("some_tool", { hello: "world" }),
    ]);
    const result = await chatCompletion(
      config,
      { ...request, tool },
      stub.fetchImpl,
    );

    expect(result.toolArguments).toBe(JSON.stringify({ hello: "world" }));
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const call = stub.calls[0]!;
    expect(call.url).toBe("https://provider.test/v1/chat/completions");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    expect(call.body.tool_choice).toEqual({
      type: "function",
      function: { name: "some_tool" },
    });
    expect(call.body.max_tokens).toBe(1600);
    expect(call.body.temperature).toBe(0.2);
  });

  it("uses the OpenAI gateway token field and omits temperature when configured", async () => {
    const gatewayConfig: FeatherlessConfig = {
      ...config,
      maxTokensParameter: "max_completion_tokens",
      supportsTemperature: false,
    };
    const stub = createFetchStub([textResponse("gateway answer")]);
    await chatCompletion(gatewayConfig, request, stub.fetchImpl);
    expect(stub.calls[0]!.body.max_completion_tokens).toBe(1600);
    expect(stub.calls[0]!.body.max_tokens).toBeUndefined();
    expect(stub.calls[0]!.body.temperature).toBeUndefined();
  });

  it("uses Gemini structured output without optional generation fields", async () => {
    const geminiConfig: FeatherlessConfig = {
      ...config,
      maxTokensParameter: null,
      supportsTemperature: false,
      structuredOutputMode: "json-schema",
      reasoningEffort: "minimal",
    };
    const stub = createFetchStub([textResponse('{"hello":"gemini"}')]);
    const result = await chatCompletion(
      geminiConfig,
      { ...request, tool },
      stub.fetchImpl,
    );
    expect(result.toolArguments).toBe('{"hello":"gemini"}');
    expect(stub.calls[0]!.body.tools).toBeUndefined();
    expect(stub.calls[0]!.body.tool_choice).toBeUndefined();
    expect(stub.calls[0]!.body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "some_tool",
        description: "Return structured output.",
        strict: true,
        schema: tool.parameters,
      },
    });
    expect(stub.calls[0]!.body.reasoning_effort).toBe("minimal");
    expect(stub.calls[0]!.body.max_tokens).toBeUndefined();
    expect(stub.calls[0]!.body.max_completion_tokens).toBeUndefined();
    expect(stub.calls[0]!.body.temperature).toBeUndefined();
  });

  it("returns non-empty assistant text when no tool is requested", async () => {
    const stub = createFetchStub([textResponse("plain answer")]);
    const result = await chatCompletion(config, request, stub.fetchImpl);
    expect(result.content).toBe("plain answer");
    expect(result.toolArguments).toBeNull();
  });

  it("maps HTTP failures without reading or exposing their body", async () => {
    const stub = createFetchStub([
      jsonResponse({ secret: "provider-body-secret" }, 503),
    ]);
    const error = await chatCompletion(config, request, stub.fetchImpl).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(503);
    expect(String(error)).not.toContain("provider-body-secret");
    expect(stub.calls).toHaveLength(2);
  });

  it("maps HTTP 429 to a distinct safe rate-limit error", async () => {
    const stub = createFetchStub([
      jsonResponse({ error: "quota detail and secret" }, 429),
    ]);
    const error = await chatCompletion(config, request, stub.fetchImpl).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderRateLimitError);
    expect(String(error)).not.toContain("quota detail");
    expect(stub.calls).toHaveLength(2);
  });

  it("retries a transient provider error exactly once, then succeeds", async () => {
    const stub = createFetchStub([
      jsonResponse({ error: "busy" }, 503),
      textResponse("recovered"),
    ]);
    const result = await chatCompletion(config, request, stub.fetchImpl);
    expect(result.content).toBe("recovered");
    expect(stub.calls).toHaveLength(2);
  });

  it("applies one timeout budget across transient retries", async () => {
    let calls = 0;
    const fetchImpl = ((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          setTimeout(
            () => resolve(jsonResponse({ error: "busy" }, 503)),
            70,
          );
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }) as typeof fetch;

    const startedAt = Date.now();
    await expect(
      chatCompletion(config, { ...request, timeoutMs: 100 }, fetchImpl),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(Date.now() - startedAt).toBeLessThan(220);
    expect(calls).toBe(1);
  });

  it("does not retry non-transient HTTP errors", async () => {
    const stub = createFetchStub([jsonResponse({ error: "bad request" }, 400)]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(stub.calls).toHaveLength(1);
  });

  it("does not retry timeouts", async () => {
    const stub = createFetchStub(["hang"]);
    await expect(
      chatCompletion(config, { ...request, timeoutMs: 20 }, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(stub.calls).toHaveLength(1);
  });

  it("cancels during retry backoff without making another provider call", async () => {
    const controller = new AbortController();
    const stub = createFetchStub([jsonResponse({ error: "busy" }, 503)]);
    const pending = chatCompletion(
      config,
      { ...request, signal: controller.signal },
      stub.fetchImpl,
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(stub.calls).toHaveLength(1);
  });

  it("maps network failures without retaining their message or cause", async () => {
    const stub = createFetchStub([
      new Error("socket failed with FEATHERLESS_API_KEY=very-secret"),
    ]);
    const error = await chatCompletion(config, request, stub.fetchImpl).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderNetworkError);
    expect(String(error)).not.toContain("very-secret");
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it.each([
    ["malformed JSON", new Response("<html>gateway</html>", { status: 200 })],
    ["empty body", new Response("", { status: 200 })],
    ["missing choices", jsonResponse({ choices: [] })],
    [
      "empty message",
      jsonResponse({ choices: [{ message: { content: null } }] }),
    ],
  ])("rejects %s as unusable model output", async (_label, response) => {
    const stub = createFetchStub([response]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("rejects a wrong forced tool name", async () => {
    const stub = createFetchStub([
      toolCallResponse("unexpected_tool", { result: true }),
    ]);
    await expect(
      chatCompletion(config, { ...request, tool }, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("rejects empty tool arguments", async () => {
    const stub = createFetchStub([toolCallResponse("some_tool", "   ")]);
    await expect(
      chatCompletion(config, { ...request, tool }, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("rejects provider responses whose declared size exceeds 1 MB", async () => {
    const response = jsonResponse({ choices: [] });
    response.headers.set("content-length", String(1024 * 1024 + 1));
    const stub = createFetchStub([response]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("aborts a provider that hangs before response headers", async () => {
    const stub = createFetchStub(["hang"]);
    await expect(
      chatCompletion(
        config,
        { ...request, timeoutMs: 20 },
        stub.fetchImpl,
      ),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(stub.calls[0]!.init.signal?.aborted).toBe(true);
  });

  it("keeps the timeout active while reading the response body", async () => {
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener(
              "abort",
              () =>
                controller.error(
                  new DOMException("The operation was aborted.", "AbortError"),
                ),
              { once: true },
            );
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await expect(
      chatCompletion(config, { ...request, timeoutMs: 20 }, fetchImpl),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("propagates caller cancellation to the provider signal", async () => {
    const controller = new AbortController();
    const stub = createFetchStub(["hang"]);
    const pending = chatCompletion(
      config,
      { ...request, signal: controller.signal },
      stub.fetchImpl,
    );
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(stub.calls[0]!.init.signal?.aborted).toBe(true);
  });

  it("does not call fetch when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stub = createFetchStub([]);
    await expect(
      chatCompletion(
        config,
        { ...request, signal: controller.signal },
        stub.fetchImpl,
      ),
    ).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(stub.calls).toHaveLength(0);
  });

  it("does not call fetch when imported into a browser-like environment", async () => {
    (globalThis as { window?: unknown }).window = {};
    const stub = createFetchStub([textResponse("nope")]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toThrow(/never run in the browser/);
    expect(stub.calls).toHaveLength(0);
  });
});
