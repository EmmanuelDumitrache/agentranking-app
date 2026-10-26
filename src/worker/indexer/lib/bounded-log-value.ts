import { boundUtf8String } from "./unicode-bounds.js";
const TRUNCATED = "[truncated]";
const CIRCULAR = "[circular]";
export type BoundedLogOptions = {
  maxChars?: number;
  maxDepth?: number;
  maxEntries?: number;
  maxNodes?: number;
  maxStringChars?: number;
};
function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value!)));
}
function safeString(value: unknown, fallback = "unknown"): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}
/**
 * Converts arbitrary logger metadata into a JSON-safe, size-bounded value.
 * Logging must never recursively traverse an attacker-controlled object graph,
 * throw on BigInt/cycles, or synchronously stringify megabytes of metadata.
 */
export function boundedLogValue(
  value: unknown,
  options: BoundedLogOptions = {},
): unknown {
  const maxChars = boundedInteger(options.maxChars, 24_000, 256_000);
  const maxDepth = boundedInteger(options.maxDepth, 5, 12);
  const maxEntries = boundedInteger(options.maxEntries, 50, 500);
  const maxNodes = boundedInteger(options.maxNodes, 500, 10_000);
  const maxStringChars = boundedInteger(options.maxStringChars, 2_000, 32_000);
  let bytesRemaining = maxChars;
  let nodesRemaining = maxNodes;
  const seen = new WeakSet<object>();
  const takeString = (input: string): string => {
    if (bytesRemaining <= 0) return TRUNCATED;
    const source = input.isWellFormed() ? input : input.toWellFormed();
    const allowed = Math.min(maxStringChars, bytesRemaining);
    const ellipsisBytes = Buffer.byteLength("…", "utf8");
    const bounded = boundUtf8String(source, allowed, "log string");
    if (!bounded.truncated) {
      bytesRemaining -= bounded.sourceUtf8Bytes;
      return bounded.value;
    }
    const prefix = boundUtf8String(source, Math.max(0, allowed - ellipsisBytes), "log string").value;
    bytesRemaining = Math.max(0, bytesRemaining - allowed);
    return `${prefix}…`;
  };
  const normalize = (input: unknown, depth: number): unknown => {
    nodesRemaining -= 1;
    if (nodesRemaining < 0 || bytesRemaining <= 0) return TRUNCATED;
    if (input === null || typeof input === "boolean" || typeof input === "number") return input;
    if (typeof input === "string") return takeString(input);
    if (typeof input === "bigint") return takeString(input.toString());
    if (typeof input === "undefined") return "[undefined]";
    if (typeof input === "symbol") return takeString(input.toString());
    if (typeof input === "function") return `[Function ${takeString(input.name || "anonymous")}]`;
    if (depth >= maxDepth) return TRUNCATED;
    if (typeof input !== "object") return takeString(safeString(input, "[unprintable]"));
    if (seen.has(input)) return CIRCULAR;
    seen.add(input);
    try {
      if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? "Invalid Date" : input.toISOString();
      }
      if (Error.isError(input)) {
        return {
          name: takeString(input.name),
          message: takeString(input.message),
          ...(input.stack
            ? { stack: takeString(input.stack.split("\n").slice(0, 8).join("\n")) }
            : {}),
        };
      }
      if (Array.isArray(input)) {
        const count = Math.min(input.length, maxEntries);
        const output = new Array<unknown>(count);
        for (let index = 0; index < count; index += 1) {
          output[index] = normalize(input[index], depth + 1);
        }
        if (input.length > count) output.push(`[${input.length - count} more items]`);
        return output;
      }
      if (input instanceof Map) {
        const output: unknown[] = [];
        let count = 0;
        for (const [key, nested] of input) {
          if (count >= maxEntries) {
            output.push(`[${Math.max(0, input.size - count)} more entries]`);
            break;
          }
          output.push([normalize(key, depth + 1), normalize(nested, depth + 1)]);
          count += 1;
        }
        return { "[Map]": output };
      }
      if (input instanceof Set) {
        const output: unknown[] = [];
        let count = 0;
        for (const nested of input) {
          if (count >= maxEntries) {
            output.push(`[${Math.max(0, input.size - count)} more entries]`);
            break;
          }
          output.push(normalize(nested, depth + 1));
          count += 1;
        }
        return { "[Set]": output };
      }
      const output: Record<string, unknown> = {};
      let inspected = 0;
      try {
        for (const key in input as Record<string, unknown>) {
          if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
          if (inspected >= maxEntries) {
            output["…"] = "[more entries]";
            break;
          }
          inspected += 1;
          let nested: unknown;
          try {
            nested = (input as Record<string, unknown>)[key];
          } catch (error) {
            const boundedKey = takeString(key);
            output[boundedKey] = `[Unreadable: ${takeString(Error.isError(error) ? error.message : safeString(error))}]`;
            continue;
          }
          // Match JSON.stringify object semantics: absent optional metadata must stay absent
          // rather than becoming the misleading string "[undefined]" in structured logs.
          if (nested === undefined) continue;
          const boundedKey = takeString(key);
          output[boundedKey] = normalize(nested, depth + 1);
        }
      } catch (error) {
        return `[Unreadable object: ${takeString(Error.isError(error) ? error.message : safeString(error))}]`;
      }
      return output;
    } finally {
      seen.delete(input);
    }
  };
  try {
    return normalize(value, 0);
  } catch (error) {
    return `[Unserializable: ${Error.isError(error) ? error.message : safeString(error)}]`;
  }
}
export function boundedLogJson(value: unknown, maxChars = 32_000): string {
  try {
    const serialized = JSON.stringify(boundedLogValue(value, { maxChars }));
    if (Buffer.byteLength(serialized, "utf8") <= maxChars) return serialized;
    const suffix = "…[truncated]";
    const bounded = boundUtf8String(
      serialized.isWellFormed() ? serialized : serialized.toWellFormed(),
      Math.max(0, maxChars - Buffer.byteLength(suffix, "utf8")),
      "serialized log JSON",
    );
    return JSON.stringify(`${bounded.value}${suffix}`);
  } catch (error) {
    return JSON.stringify(`[Unserializable: ${Error.isError(error) ? error.message : safeString(error)}]`);
  }
}