import { hash } from "node:crypto";
export type BoundedString = {
  value: string;
  truncated: boolean;
  sourceDigest: string;
  sourceUtf8Bytes: number;
};
export function assertWellFormedUnicode(value: string, label = "string"): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label} contains an unpaired high surrogate`);
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${label} contains an unpaired low surrogate`);
    }
  }
}
export function boundUtf8String(value: string, maxBytes: number, label = "string"): BoundedString {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a non-negative integer");
  assertWellFormedUnicode(value, label);
  const source = Buffer.from(value, "utf8");
  const sourceDigest = hash("sha256", source, "hex");
  if (source.byteLength <= maxBytes) {
    return { value, truncated: false, sourceDigest, sourceUtf8Bytes: source.byteLength };
  }
  let bounded = "";
  let bytes = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > maxBytes) break;
    bounded += codePoint;
    bytes += size;
  }
  return { value: bounded, truncated: true, sourceDigest, sourceUtf8Bytes: source.byteLength };
}
export function boundedStringArray(
  values: readonly string[],
  options: { maxItems: number; maxItemBytes: number },
): { values: string[]; truncated: boolean; sourceDigest: string } {
  const sourceDigest = hash("sha256", JSON.stringify(values), "hex");
  const seen = new Set<string>();
  const bounded: string[] = [];
  let truncated = values.length > options.maxItems;
  for (const value of values) {
    if (bounded.length >= options.maxItems) break;
    const item = boundUtf8String(value, options.maxItemBytes, "array item");
    truncated ||= item.truncated;
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    bounded.push(item.value);
  }
  return { values: bounded, truncated, sourceDigest };
}
