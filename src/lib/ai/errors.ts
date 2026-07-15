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

export class ProviderHttpError extends Error {
  readonly code = "provider_http_error";
  constructor(readonly status: number) {
    // Deliberately excludes the response body — provider errors can echo
    // request content and must never reach logs or users verbatim.
    super(`AI provider returned HTTP ${status}`);
    this.name = "ProviderHttpError";
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
  if (error instanceof ProviderHttpError) {
    return "The AI service is currently unavailable.";
  }
  if (error instanceof ModelOutputError) {
    return "The AI service returned an unusable response.";
  }
  return "Something went wrong while processing the request.";
}
