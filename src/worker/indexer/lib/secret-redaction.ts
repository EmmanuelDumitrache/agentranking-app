import { createHash } from "node:crypto";
const SECRET_QUERY_KEYS = /(?:key|token|secret|signature|sig|auth|credential|password|api[_-]?key|access[_-]?token)/i;
const SENSITIVE_PATH_SEGMENT = /^(?:[A-Za-z0-9_-]{24,}|[0-9a-f]{32,})$/i;
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
export function sanitizeSensitiveUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    const segments = url.pathname.split("/").map((segment, index) => {
      if (!segment) return segment;
      if (SENSITIVE_PATH_SEGMENT.test(segment) && index > 0) return `redacted-${shortHash(segment)}`;
      return segment;
    });
    url.pathname = segments.join("/");
    if (url.search) {
      const safe = new URLSearchParams();
      for (const [key] of url.searchParams) {
        safe.set(key, SECRET_QUERY_KEYS.test(key) ? "[REDACTED]" : "[OMITTED]");
      }
      url.search = safe.toString();
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
export function redactSensitiveText(value: string): string {
  let output = value.replace(/https?:\/\/[^\s'"<>]+/gi, (url) => sanitizeSensitiveUrl(url));
  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]");
  output = output.replace(/((?:api[_-]?key|token|secret|password|credential)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  return output;
}
export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[REDACTED_DEPTH]";
  if (typeof value === "string") return redactSensitiveText(value).slice(0, 4_000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactDiagnosticValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      output[key] = SECRET_QUERY_KEYS.test(key) ? "[REDACTED]" : redactDiagnosticValue(item, depth + 1);
    }
    return output;
  }
  return String(value);
}
