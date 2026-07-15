import { describe, expect, it } from "vitest";
import {
  ModelOutputError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  toSafeMessage,
} from "./errors";

describe("toSafeMessage", () => {
  it("maps known failures to static end-user messages", () => {
    for (const error of [
      new ProviderTimeoutError(12345),
      new ProviderHttpError(503),
      new ProviderRateLimitError(),
      new ProviderNetworkError(),
      new ModelOutputError("fixed internal diagnostic"),
    ]) {
      const message = toSafeMessage(error);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/12345|503|diagnostic/);
    }
  });

  it("never reflects secrets, stack traces, prompts, or provider responses", () => {
    const secret =
      "FEATHERLESS_API_KEY stack trace system prompt provider response";
    expect(toSafeMessage(new Error(secret))).toBe(
      "Something went wrong while processing the request.",
    );
    expect(toSafeMessage({ response: secret })).not.toContain(secret);
  });
});
