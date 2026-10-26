import { z } from "zod";

export class HttpBodyTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`HTTP body exceeded ${maxBytes} bytes`);
    this.name = "HttpBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}
export class InvalidHttpBodyEncodingError extends Error {
  constructor(message = "HTTP body is not valid UTF-8", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidHttpBodyEncodingError";
  }
}
export class InvalidJsonBodyError extends Error {
  constructor(message = "HTTP body is not valid JSON", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidJsonBodyError";
  }
}
export class MissingHttpContentLengthError extends Error {
  constructor() {
    super("HTTP Content-Length is required for this request");
    this.name = "MissingHttpContentLengthError";
  }
}
type BodySource = {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
};
const DEFAULT_MAX_BYTES = 1_048_576;
const ABSOLUTE_MAX_BYTES = 67_108_864;
function boundedMaxBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_BYTES;
  return Math.min(ABSOLUTE_MAX_BYTES, Math.max(1, Math.trunc(value!)));
}
function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
/**
 * Guards APIs such as Request.formData() that otherwise materialize the whole
 * multipart body before application code can enforce a limit. Requiring a
 * declared length rejects chunked uploads, which cannot be safely bounded by
 * the platform form-data parser.
 */
export function assertDeclaredHttpBodyWithinLimit(
  source: Pick<BodySource, "headers">,
  maxBytes = DEFAULT_MAX_BYTES,
  options: { required?: boolean } = {},
): number | null {
  const limit = boundedMaxBytes(maxBytes);
  const declared = declaredContentLength(source.headers);
  if (declared === null) {
    if (options.required) throw new MissingHttpContentLengthError();
    return null;
  }
  if (declared > limit) throw new HttpBodyTooLargeError(limit);
  return declared;
}
/**
 * Reads a Request/Response body without allowing a chunked or dishonest peer
 * to make the process buffer an unbounded payload before a size check runs.
 */
export async function readBoundedHttpBodyBytes(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Uint8Array> {
  const limit = boundedMaxBytes(maxBytes);
  const declared = declaredContentLength(source.headers);
  if (declared !== null && declared > limit) {
    throw new HttpBodyTooLargeError(limit);
  }
  if (!source.body) return new Uint8Array(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel("HTTP body too large");
        } catch {
          // Cancellation is best effort; the size failure remains authoritative.
        }
        throw new HttpBodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore already-released/errored readers.
    }
  }
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!.slice();
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
export async function readBoundedHttpBodyText(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<string> {
  const bytes = await readBoundedHttpBodyBytes(source, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch (error) {
    throw new InvalidHttpBodyEncodingError(undefined, { cause: error });
  }
}
export async function readBoundedJsonBody(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<unknown> {
  const text = await readBoundedHttpBodyText(source, maxBytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InvalidJsonBodyError(undefined, { cause: error });
  }
}
export async function parseBoundedJsonBody<S extends z.ZodType>(
  source: BodySource,
  schema: S,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<z.output<S>> {
  const raw = await readBoundedJsonBody(source, maxBytes);
  return schema.parse(raw);
}
/**
 * Reads an optional JSON body with the same streaming byte bound. Empty or
 * whitespace-only bodies return undefined; malformed non-empty bodies remain errors.
 */
export async function readOptionalBoundedJsonBody(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<unknown | undefined> {
  const text = await readBoundedHttpBodyText(source, maxBytes);
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InvalidJsonBodyError(undefined, { cause: error });
  }
}
export async function parseOptionalBoundedJsonBody<S extends z.ZodType>(
  source: BodySource,
  schema: S,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<z.output<S> | undefined> {
  const raw = await readOptionalBoundedJsonBody(source, maxBytes);
  if (raw === undefined) return undefined;
  return schema.parse(raw);
}
/** Reads a bounded JSON request body and requires a non-array object root. */
export async function readBoundedJsonObject(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Record<string, unknown>> {
  const value = await readBoundedJsonBody(source, maxBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidJsonBodyError("HTTP JSON body must be an object");
  }
  return value as Record<string, unknown>;
}
/** Reads an optional bounded JSON object; an empty body returns an empty object. */
export async function readOptionalBoundedJsonObject(
  source: BodySource,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Record<string, unknown>> {
  const value = await readOptionalBoundedJsonBody(source, maxBytes);
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidJsonBodyError("HTTP JSON body must be an object");
  }
  return value as Record<string, unknown>;
}
