import { afterEach, describe, expect, it } from "vitest";
import type { FeatherlessConfig } from "./config";
import {
  ModelOutputError,
  ProviderHttpError,
  ProviderTimeoutError,
} from "./errors";
import { chatCompletion } from "./featherless-client";
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
};

const request = {
  model: config.textModel,
  messages: [{ role: "user" as const, content: "hello" }],
};

afterEach(() => {
  // Guard against a test leaking a fake `window` and disabling the
  // server-only assertion for later tests.
  delete (globalThis as { window?: unknown }).window;
});

describe("chatCompletion", () => {
  it("posts to the chat completions endpoint with auth and tool choice", async () => {
    const stub = createFetchStub([
      toolCallResponse("some_tool", { hello: "world" }),
    ]);
    const result = await chatCompletion(
      config,
      {
        ...request,
        tool: {
          name: "some_tool",
          description: "d",
          parameters: { type: "object" },
        },
      },
      stub.fetchImpl,
    );

    expect(result.toolArguments).toBe(JSON.stringify({ hello: "world" }));
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const call = stub.calls[0]!;
    expect(call.url).toBe("https://provider.test/v1/chat/completions");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(call.body.model).toBe("test-text-model");
    expect(call.body.tool_choice).toEqual({
      type: "function",
      function: { name: "some_tool" },
    });
  });

  it("returns text content when the model does not call a tool", async () => {
    const stub = createFetchStub([textResponse("plain answer")]);
    const result = await chatCompletion(config, request, stub.fetchImpl);
    expect(result.content).toBe("plain answer");
    expect(result.toolArguments).toBeNull();
  });

  it("throws ProviderHttpError on non-2xx without leaking the body", async () => {
    const stub = createFetchStub([
      jsonResponse({ secret: "internal provider detail" }, 500),
    ]);
    const error = await chatCompletion(config, request, stub.fetchImpl).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(500);
    expect(String(error)).not.toContain("internal provider detail");
  });

  it("throws ModelOutputError when the provider envelope is not JSON", async () => {
    const stub = createFetchStub([
      new Response("<html>gateway error</html>", { status: 200 }),
    ]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("throws ModelOutputError when there are no choices", async () => {
    const stub = createFetchStub([jsonResponse({ choices: [] })]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("aborts and throws ProviderTimeoutError when the provider hangs", async () => {
    const stub = createFetchStub(["hang"]);
    await expect(
      chatCompletion(config, { ...request, timeoutMs: 20 }, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("retries exactly once on transient provider errors, then succeeds", async () => {
    const stub = createFetchStub([
      jsonResponse({ error: "busy" }, 503),
      textResponse("recovered"),
    ]);
    const result = await chatCompletion(config, request, stub.fetchImpl);
    expect(result.content).toBe("recovered");
    expect(stub.calls).toHaveLength(2);
  });

  it("gives up after the single retry on persistent transient errors", async () => {
    const stub = createFetchStub([jsonResponse({ error: "busy" }, 503)]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(stub.calls).toHaveLength(2);
  });

  it("does not retry non-transient HTTP errors", async () => {
    const stub = createFetchStub([jsonResponse({ error: "bad request" }, 400)]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(stub.calls).toHaveLength(1);
  });

  it("does not retry timeouts — the caller already waited a full budget", async () => {
    const stub = createFetchStub(["hang"]);
    await expect(
      chatCompletion(config, { ...request, timeoutMs: 20 }, stub.fetchImpl),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(stub.calls).toHaveLength(1);
  });

  it("refuses to run in a browser-like environment", async () => {
    (globalThis as { window?: unknown }).window = {};
    const stub = createFetchStub([textResponse("nope")]);
    await expect(
      chatCompletion(config, request, stub.fetchImpl),
    ).rejects.toThrow(/never run in the browser/);
    expect(stub.calls).toHaveLength(0);
  });
});
