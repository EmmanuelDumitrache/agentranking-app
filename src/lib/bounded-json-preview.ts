export type BoundedJsonPreviewOptions = {
  maxChars?: number;
  maxDepth?: number;
  maxEntriesPerContainer?: number;
  maxNodes?: number;
  maxStringChars?: number;
  indent?: number;
};

const TRUNCATED = "[Preview truncated]";
const CIRCULAR = "[Circular]";

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value!)));
}

function safeString(value: unknown, fallback: string): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

/**
 * Produces a display-only JSON preview without traversing an unbounded object
 * graph. This is intentionally lossy and must not be used for persistence or
 * hashing.
 */
export function boundedJsonPreview(
  value: unknown,
  options: BoundedJsonPreviewOptions = {},
): { text: string; truncated: boolean } {
  const maxChars = boundedPositiveInteger(options.maxChars, 12_000, 1_000_000);
  const maxDepth = boundedPositiveInteger(options.maxDepth, 6, 20);
  const maxEntries = boundedPositiveInteger(options.maxEntriesPerContainer, 80, 1_000);
  const maxNodes = boundedPositiveInteger(options.maxNodes, 1_000, 50_000);
  const maxStringChars = boundedPositiveInteger(options.maxStringChars, 4_000, 100_000);
  const indent = Number.isFinite(options.indent)
    ? Math.min(8, Math.max(0, Math.trunc(options.indent!)))
    : 2;

  let nodesRemaining = maxNodes;
  let structurallyTruncated = false;
  const seen = new WeakSet<object>();

  const normalize = (input: unknown, depth: number): unknown => {
    nodesRemaining -= 1;
    if (nodesRemaining < 0) {
      structurallyTruncated = true;
      return TRUNCATED;
    }
    if (typeof input === "string") {
      if (input.length <= maxStringChars) return input;
      structurallyTruncated = true;
      return `${input.slice(0, maxStringChars)}…`;
    }
    if (
      input === null ||
      typeof input === "boolean" ||
      typeof input === "number"
    ) {
      return input;
    }
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined") return "[undefined]";
    if (typeof input === "function") return `[Function ${input.name || "anonymous"}]`;
    if (typeof input === "symbol") return input.toString();
    if (depth >= maxDepth) {
      structurallyTruncated = true;
      return TRUNCATED;
    }
    if (typeof input !== "object") return safeString(input, "[Unprintable]");
    if (seen.has(input)) return CIRCULAR;
    seen.add(input);
    try {
      if (input instanceof Date) return Number.isNaN(input.getTime()) ? "Invalid Date" : input.toISOString();
      if (input instanceof URL) return input.toString();
      if (input instanceof Error) {
        return {
          name: input.name,
          message: input.message,
          ...(input.stack ? { stack: normalize(input.stack, depth + 1) } : {}),
        };
      }
      if (Array.isArray(input)) {
        const length = Math.min(input.length, maxEntries);
        const output = new Array<unknown>(length);
        for (let index = 0; index < length; index += 1) {
          output[index] = normalize(input[index], depth + 1);
        }
        if (input.length > length) {
          structurallyTruncated = true;
          output.push(`[${input.length - length} more items]`);
        }
        return output;
      }
      if (input instanceof Map) {
        const output: unknown[] = [];
        let count = 0;
        for (const [key, nested] of input) {
          if (count >= maxEntries) {
            structurallyTruncated = true;
            output.push(`[${input.size - count} more entries]`);
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
            structurallyTruncated = true;
            output.push(`[${input.size - count} more entries]`);
            break;
          }
          output.push(normalize(nested, depth + 1));
          count += 1;
        }
        return { "[Set]": output };
      }

      const output: Record<string, unknown> = {};
      let count = 0;
      for (const key in input as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        if (count >= maxEntries) {
          structurallyTruncated = true;
          output["…"] = TRUNCATED;
          break;
        }
        try {
          output[key] = normalize((input as Record<string, unknown>)[key], depth + 1);
        } catch (error) {
          output[key] = `[Unreadable: ${error instanceof Error ? error.message : safeString(error, "unknown error")}]`;
        }
        count += 1;
      }
      return output;
    } finally {
      seen.delete(input);
    }
  };

  let text: string;
  try {
    text = JSON.stringify(normalize(value, 0), null, indent) ?? safeString(value, "[Unprintable]");
  } catch {
    text = "[Unprintable]";
  }
  if (text.length > maxChars) {
    return { text: `${text.slice(0, maxChars)}\n…`, truncated: true };
  }
  return { text, truncated: structurallyTruncated };
}
