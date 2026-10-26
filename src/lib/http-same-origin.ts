import "server-only";

type ExpectedOrigin = {
  origin: string | null;
  hostSource: "x-forwarded-host" | "host" | "request-url";
  protocolSource: "x-forwarded-proto" | "request-url";
};

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

function normalizeProtocol(value: string): "http" | "https" | null {
  const protocol = value.trim().toLowerCase().replace(/:$/, "");
  return protocol === "http" || protocol === "https" ? protocol : null;
}

function normalizeHost(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(`http://${candidate}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string): string | null {
  if (value === "null") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function expectedOriginForRequest(request: Request): ExpectedOrigin {
  const requestUrl = new URL(request.url);

  // Production is served through the managed reverse proxy, which overwrites
  // these forwarded headers before the request reaches Next.js. Prefer the
  // public-facing values so TLS termination/internal upstream URLs do not make
  // a legitimate browser Origin appear cross-origin.
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const headerHost = request.headers.get("host")?.trim() || null;
  const hostSource: ExpectedOrigin["hostSource"] = forwardedHost
    ? "x-forwarded-host"
    : headerHost
      ? "host"
      : "request-url";
  const host = normalizeHost(forwardedHost ?? headerHost ?? requestUrl.host);

  const forwardedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocolSource: ExpectedOrigin["protocolSource"] = forwardedProtocol
    ? "x-forwarded-proto"
    : "request-url";
  const protocol = normalizeProtocol(forwardedProtocol ?? requestUrl.protocol);

  if (!host || !protocol) {
    return { origin: null, hostSource, protocolSource };
  }

  return {
    origin: new URL(`${protocol}://${host}`).origin,
    hostSource,
    protocolSource,
  };
}

function forbiddenOriginError(): Error & { status: number } {
  const error = new Error("Cross-origin mutation is not permitted") as Error & { status: number };
  error.status = 403;
  return error;
}

function logOriginRejection(params: {
  suppliedOrigin: string | null;
  expected: ExpectedOrigin;
  reason: "invalid-origin" | "invalid-expected-origin" | "origin-mismatch";
}): void {
  console.warn("[http-same-origin] rejected mutation", {
    origin: params.suppliedOrigin === null ? "<invalid>" : params.suppliedOrigin,
    expectedOrigin: params.expected.origin ?? "<invalid>",
    hostSource: params.expected.hostSource,
    protocolSource: params.expected.protocolSource,
    reason: params.reason,
  });
}

export function assertSameOriginMutation(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return;

  const suppliedOrigin = normalizeOrigin(originHeader);
  const expected = expectedOriginForRequest(request);

  if (!suppliedOrigin) {
    logOriginRejection({ suppliedOrigin, expected, reason: "invalid-origin" });
    throw forbiddenOriginError();
  }
  if (!expected.origin) {
    logOriginRejection({ suppliedOrigin, expected, reason: "invalid-expected-origin" });
    throw forbiddenOriginError();
  }
  if (suppliedOrigin !== expected.origin) {
    logOriginRejection({ suppliedOrigin, expected, reason: "origin-mismatch" });
    throw forbiddenOriginError();
  }
}
