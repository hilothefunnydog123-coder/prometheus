export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeded its configured limit");
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestBodyReadError extends Error {
  constructor() {
    super("request body could not be read");
    this.name = "RequestBodyReadError";
  }
}

export function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function validateDeclaredLength(request: Request, maximumBytes: number): void {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) throw new RequestBodyReadError();
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new RequestBodyReadError();
  if (length > maximumBytes) throw new RequestBodyTooLargeError();
}

/** Read a request stream while enforcing the actual byte count. */
export async function readBodyWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  validateDeclaredLength(request, maximumBytes);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
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
          // The size violation is authoritative even if cancellation races.
        }
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new RequestBodyReadError();
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function decodeUtf8(body: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RequestBodyReadError();
  }
}

export function replayRequest(request: Request, body: Uint8Array): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const replayBody = new Uint8Array(body.byteLength);
  replayBody.set(body);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: replayBody.buffer,
  });
}
