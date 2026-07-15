/**
 * Test-only helpers for faking the Featherless provider. Unit tests must
 * never perform live provider calls — every test injects a fetch stub built
 * here (or stubs global fetch with one for API-route tests).
 */

export interface RecordedCall {
  url: string;
  init: RequestInit;
  /** Parsed JSON request body. */
  body: Record<string, unknown>;
}

export type PlannedResponse = Response | Error | "hang";

export interface FetchStub {
  calls: RecordedCall[];
  fetchImpl: typeof fetch;
}

/**
 * Returns a fetch stub that replays `planned` responses in order (the last
 * one repeats if called more often). "hang" never resolves until the abort
 * signal fires — used to exercise timeouts deterministically.
 */
export function createFetchStub(planned: PlannedResponse[]): FetchStub {
  const calls: RecordedCall[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body) as Record<string, unknown>;
    }
    calls.push({ url, init: init ?? {}, body });

    const index = Math.min(calls.length - 1, planned.length - 1);
    const next = planned[index];
    if (next === undefined) {
      return Promise.reject(new Error("fetch stub has no planned response"));
    }
    if (next === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next.clone());
  }) as typeof fetch;

  return { calls, fetchImpl };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A well-formed chat completion whose message is a forced tool call. */
export function toolCallResponse(name: string, args: unknown): Response {
  return jsonResponse({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              function: {
                name,
                arguments: typeof args === "string" ? args : JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  });
}

/** A chat completion with plain text content and no tool call. */
export function textResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}
