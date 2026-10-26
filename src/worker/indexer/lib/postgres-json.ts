/**
 * Convert arbitrary runtime values into PostgreSQL JSON/JSONB-safe data.
 * PostgreSQL rejects NUL and unpaired UTF-16 surrogate escapes even though
 * JavaScript strings can contain them, so every string and object key is
 * normalised before Prisma serialises the value.
 */
function postgresSafeString(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      output += "\uFFFD";
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      output += "\uFFFD";
      continue;
    }
    output += value[index];
  }
  return output;
}

export function toPostgresJsonValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "string") return postgresSafeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  if (Array.isArray(value)) return value.map((entry) => toPostgresJsonValue(entry, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[postgresSafeString(key)] = toPostgresJsonValue(entry, seen);
    }
    seen.delete(value);
    return output;
  }
  return postgresSafeString(String(value));
}
