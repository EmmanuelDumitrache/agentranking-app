import "server-only";

import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import {
  OutboundTargetRejectedError,
  resolvePublicAddress,
  stripCrossOriginSensitiveHeaders,
  validatePublicHttpUrl,
  type PublicHttpUrlOptions,
} from "@/lib/outbound-http";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const DNS_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;

const NETWORK_POLICY: PublicHttpUrlOptions = Object.freeze({
  allowHttp: false,
  allowLocalhost: false,
});

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function canReplayRedirect(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export type McpFetch = typeof fetch;

export type HardenedMcpFetchOptions = {
  sensitiveHeaderNames?: readonly string[];
  sensitiveQueryParameterNames?: readonly string[];
  rejectAuthenticatedCrossOriginRedirects?: boolean;
  maxResponseBytes?: number;
};

export async function assertMcpPublicUrlResolves(
  rawUrl: string | URL,
  signal?: AbortSignal,
): Promise<void> {
  const checked = validatePublicHttpUrl(rawUrl.toString(), {
    allowHttp: false,
    allowLocalhost: false,
  });
  if (!checked.ok) {
    throw new OutboundTargetRejectedError(`MCP URL rejected: ${checked.reason}`);
  }
  const deadline = AbortSignal.timeout(DNS_TIMEOUT_MS);
  await resolvePublicAddress(
    checked.url.hostname,
    { allowHttp: false, allowLocalhost: false },
    signal ? AbortSignal.any([signal, deadline]) : deadline,
    DNS_TIMEOUT_MS,
  );
}

function hasSensitiveHeaders(headers: Headers, names: readonly string[]): boolean {
  return ["authorization", "cookie", ...names].some((name) => headers.has(name));
}

function boundedResponse(response: Response, maxBytes: number): Response {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new OutboundTargetRejectedError("MCP response exceeds the configured byte limit");
  }
  if (!response.body) return response;
  let consumed = 0;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      consumed += chunk.value.byteLength;
      if (consumed > maxBytes) {
        await reader.cancel("mcp-response-limit");
        controller.error(new OutboundTargetRejectedError("MCP response exceeds the configured byte limit"));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function assertBoundedResponseHeaders(response: Response): void {
  let bytes = 0;
  for (const [name, value] of response.headers) {
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4;
    if (bytes > MAX_RESPONSE_HEADER_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw new OutboundTargetRejectedError("MCP response headers exceed the configured byte limit");
    }
  }
}

function terminalResponse(response: Response, maxResponseBytes?: number): Response {
  assertBoundedResponseHeaders(response);
  return maxResponseBytes
    ? boundedResponse(response, maxResponseBytes)
    : response;
}

/**
 * Fetch-compatible transport for MCP/OAuth that preserves streaming bodies while
 * applying the same public-destination policy as requestPublicHttp(). DNS is
 * resolved inside Undici's socket lookup hook, so the validated address is the
 * address that is actually connected to (no validate-then-re-resolve gap).
 */
const pinnedLookup = ((
  hostname: string,
  options: { all?: boolean },
  callback: (...args: unknown[]) => void,
) => {
  const policy = NETWORK_POLICY;
  const signal = AbortSignal.timeout(DNS_TIMEOUT_MS);
  resolvePublicAddress(hostname, policy, signal, DNS_TIMEOUT_MS).then(
    (resolved) => {
      if (options.all) {
        callback(null, [{ address: resolved.address, family: resolved.family }]);
      } else {
        callback(null, resolved.address, resolved.family);
      }
    },
    (error) => {
      const lookupError = error instanceof Error
        ? Object.assign(error, { code: "EHOSTUNREACH" })
        : Object.assign(new Error(String(error)), { code: "EHOSTUNREACH" });
      callback(lookupError);
    },
  );
}) as LookupFunction;

const dispatcher = new Agent({
  connect: { lookup: pinnedLookup },
});

export function createHardenedMcpFetch(options: HardenedMcpFetchOptions = {}): McpFetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const policy = NETWORK_POLICY;
    let request = new Request(input, init);
    for (let redirects = 0; ; redirects += 1) {
      const validated = validatePublicHttpUrl(request.url, policy);
      if (!validated.ok) {
        throw new OutboundTargetRejectedError(`MCP endpoint rejected: ${validated.reason}`);
      }

      const response = await undiciFetch(validated.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: request.body ? "half" : undefined,
        signal: request.signal,
        redirect: "manual",
        dispatcher,
      } as Parameters<typeof undiciFetch>[1]);

      if (!REDIRECTS.has(response.status)) {
        return terminalResponse(
          response as unknown as Response,
          options.maxResponseBytes,
        );
      }
      const location = response.headers.get("location");
      assertBoundedResponseHeaders(response as unknown as Response);
      if (!location) {
        return options.maxResponseBytes
          ? boundedResponse(response as unknown as Response, options.maxResponseBytes)
          : response as unknown as Response;
      }
      if (redirects >= MAX_REDIRECTS) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundTargetRejectedError("MCP endpoint exceeded the redirect limit");
      }
      if ((options.sensitiveQueryParameterNames ?? []).some((name) =>
        new URL(request.url).searchParams.has(name))) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundTargetRejectedError(
          "MCP endpoints authenticated with query credentials cannot redirect",
        );
      }
      if (!canReplayRedirect(request.method.toUpperCase())) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundTargetRejectedError(
          "MCP endpoint attempted to redirect a request body; configure the canonical endpoint URL instead",
        );
      }

      const next = new URL(location, validated.url);
      const nextValidated = validatePublicHttpUrl(next.toString(), policy);
      if (!nextValidated.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundTargetRejectedError(`MCP redirect rejected: ${nextValidated.reason}`);
      }
      const sameOrigin = validated.url.origin === nextValidated.url.origin;
      if (
        !sameOrigin
        && (options.rejectAuthenticatedCrossOriginRedirects ?? true)
        && hasSensitiveHeaders(request.headers, options.sensitiveHeaderNames ?? [])
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundTargetRejectedError(
          "Authenticated MCP requests cannot redirect to another origin",
        );
      }
      const nextHeaders = sameOrigin
        ? headersToRecord(request.headers)
        : stripCrossOriginSensitiveHeaders(headersToRecord(request.headers));
      await response.body?.cancel().catch(() => undefined);
      request = new Request(nextValidated.url, {
        method: request.method,
        headers: nextHeaders,
        signal: request.signal,
        redirect: "manual",
      });
    }
  }) as McpFetch;
}
