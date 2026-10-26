export type ProtocolConsistencyKind = "string" | "integer" | "address" | "registry" | "uri";
export type ProtocolExpectedField = {
  key: string;
  expected: unknown;
  kind: ProtocolConsistencyKind;
};

function scalar(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object" && !Array.isArray(value) && "$number" in value) {
    const token = (value as { $number?: unknown }).$number;
    return typeof token === "string" ? token : null;
  }
  return null;
}
function canonicalInteger(value: unknown): string | null {
  const token = scalar(value);
  if (token == null || !/^-?(?:0|[1-9][0-9]*)$/.test(token)) return null;
  try { return BigInt(token).toString(10); } catch { return null; }
}
function canonicalAddress(value: unknown): string | null {
  const token = scalar(value);
  if (token == null) return null;
  const candidate = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
  return /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate.toLowerCase() : null;
}
function canonicalRegistry(value: unknown): string | null {
  const token = scalar(value);
  if (token == null) return null;
  const parts = token.split(":");
  if (parts.length !== 3) return token;
  const [namespaceRaw, referenceRaw, identifierRaw] = parts;
  const namespace = namespaceRaw!.toLowerCase();
  const reference = namespace === "eip155" && /^[0-9]+$/.test(referenceRaw!)
    ? BigInt(referenceRaw!).toString(10)
    : referenceRaw!;
  const identifier = namespace === "eip155" && /^0x[0-9a-fA-F]{40}$/.test(identifierRaw!)
    ? identifierRaw!.toLowerCase()
    : identifierRaw!;
  return `${namespace}:${reference}:${identifier}`;
}
function canonicalUri(value: unknown): string | null {
  const token = scalar(value);
  if (token == null) return null;
  if (!/^https?:/i.test(token)) return token;
  try {
    const url = new URL(token);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return token;
  }
}
function canonical(value: unknown, kind: ProtocolConsistencyKind): string | null {
  if (kind === "integer") return canonicalInteger(value);
  if (kind === "address") return canonicalAddress(value);
  if (kind === "registry") return canonicalRegistry(value);
  if (kind === "uri") return canonicalUri(value);
  return scalar(value);
}

export function protocolDocumentConsistency(
  normalized: Record<string, unknown> | null,
  expectedFields: readonly ProtocolExpectedField[],
): Record<string, unknown> | null {
  if (!normalized) return null;
  const comparisons: Record<string, unknown> = {};
  let checked = 0;
  let mismatches = 0;
  for (const field of expectedFields) {
    const declaredRaw = normalized[field.key];
    if (declaredRaw == null || field.expected == null) continue;
    const declared = canonical(declaredRaw, field.kind);
    const expected = canonical(field.expected, field.kind);
    if (declared == null || expected == null) {
      comparisons[field.key] = { declared: declaredRaw, expected: field.expected, comparable: false };
      continue;
    }
    const matches = declared === expected;
    checked += 1;
    if (!matches) mismatches += 1;
    comparisons[field.key] = { declared, expected, matches };
  }
  return {
    status: checked === 0 ? "not-comparable" : mismatches === 0 ? "consistent" : "mismatch",
    checkedFieldCount: checked,
    mismatchCount: mismatches,
    comparisons,
  };
}
