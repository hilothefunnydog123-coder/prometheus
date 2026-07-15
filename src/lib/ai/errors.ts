/**
 * Typed errors for the AI pipeline plus helpers to turn any failure into a
 * message that is safe to show an end user: static text, no provider
 * responses, no secrets, no reflected user input.
 */

export class MissingCredentialsError extends Error {
  readonly code = "missing_credentials";
  constructor() {
    super("AI provider credentials are not configured");
    this.name = "MissingCredentialsError";
  }
}

export class ProviderTimeoutError extends Error {
  readonly code = "provider_timeout";
  constructor(readonly timeoutMs: number) {
    super(`AI provider did not respond within ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderCancelledError extends Error {
  readonly code = "provider_cancelled";
  constructor() {
    super("AI provider request was cancelled");
    this.name = "ProviderCancelledError";
  }
}

export class ProviderNetworkError extends Error {
  readonly code = "provider_network_error";
  constructor() {
    super("AI provider could not be reached");
    this.name = "ProviderNetworkError";
  }
}

export class ProviderHttpError extends Error {
  readonly code: string = "provider_http_error";
  constructor(readonly status: number) {
    // Deliberately excludes the response body — provider errors can echo
    // request content and must never reach logs or users verbatim.
    super(`AI provider returned HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

export class ProviderRateLimitError extends ProviderHttpError {
  override readonly code = "provider_rate_limit";
  constructor() {
    super(429);
    this.name = "ProviderRateLimitError";
  }
}

export class ModelOutputError extends Error {
  readonly code = "model_output_error";
  constructor(reason: string) {
    super(`Model output was unusable: ${reason}`);
    this.name = "ModelOutputError";
  }
}

/** Escape HTML-significant characters. Defense in depth for API errors. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Map any thrown value to a static, user-safe message. Unknown errors get a
 * generic message — internal details stay on the server.
 */
export function toSafeMessage(error: unknown): string {
  if (error instanceof MissingCredentialsError) {
    return "The AI service is not configured; a bundled experiment was used instead.";
  }
  if (error instanceof ProviderTimeoutError) {
    return "The AI service took too long to respond.";
  }
  if (error instanceof ProviderCancelledError) {
    return "The AI request was cancelled.";
  }
  if (error instanceof ProviderRateLimitError) {
    return "The AI service is busy right now.";
  }
  if (error instanceof ProviderNetworkError) {
    return "The AI service could not be reached.";
  }
  if (error instanceof ProviderHttpError) {
    return "The AI service is currently unavailable.";
  }
  if (error instanceof ModelOutputError) {
    return "The AI service returned an unusable response.";
  }
  return "Something went wrong while processing the request.";
}
