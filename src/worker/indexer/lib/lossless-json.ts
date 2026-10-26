import { assertWellFormedUnicode } from "./unicode-bounds.js";
export class LosslessJsonNumber {
  readonly token: string;
  constructor(token: string) {
    this.token = token;
  }
  toString(): string {
    return this.token;
  }
}
export type LosslessJsonValue =
  | null
  | boolean
  | string
  | LosslessJsonNumber
  | LosslessJsonValue[]
  | { [key: string]: LosslessJsonValue };
export type LosslessJsonParseOptions = {
  maxDepth?: number;
  maxNodes?: number;
  maxObjectMembers?: number;
  maxArrayItems?: number;
};
class Parser {
  private index = 0;
  private nodes = 0;
  private readonly maxDepth: number;
  private readonly maxNodes: number;
  private readonly maxObjectMembers: number;
  private readonly maxArrayItems: number;
  constructor(private readonly source: string, options: LosslessJsonParseOptions) {
    this.maxDepth = options.maxDepth ?? 64;
    this.maxNodes = options.maxNodes ?? 100_000;
    this.maxObjectMembers = options.maxObjectMembers ?? 10_000;
    this.maxArrayItems = options.maxArrayItems ?? 10_000;
  }
  parse(): LosslessJsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) this.fail("unexpected trailing content");
    return value;
  }
  private parseValue(depth: number): LosslessJsonValue {
    if (depth > this.maxDepth) this.fail("JSON nesting depth exceeds limit");
    this.nodes += 1;
    if (this.nodes > this.maxNodes) this.fail("JSON node count exceeds limit");
    const ch = this.source[this.index];
    if (ch === '"') return this.parseString();
    if (ch === "{") return this.parseObject(depth + 1);
    if (ch === "[") return this.parseArray(depth + 1);
    if (ch === "t" && this.consumeLiteral("true")) return true;
    if (ch === "f" && this.consumeLiteral("false")) return false;
    if (ch === "n" && this.consumeLiteral("null")) return null;
    if (ch === "-" || (ch != null && ch >= "0" && ch <= "9")) return this.parseNumber();
    this.fail("unexpected token");
  }
  private parseObject(depth: number): { [key: string]: LosslessJsonValue } {
    this.index += 1;
    this.skipWhitespace();
    const out: { [key: string]: LosslessJsonValue } = Object.create(null) as { [key: string]: LosslessJsonValue };
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return out;
    }
    let members = 0;
    for (;;) {
      if (this.source[this.index] !== '"') this.fail("object key must be a string");
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      members += 1;
      if (members > this.maxObjectMembers) this.fail("object member count exceeds limit");
      this.skipWhitespace();
      if (this.source[this.index] !== ":") this.fail("expected ':' after object key");
      this.index += 1;
      this.skipWhitespace();
      out[key] = this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return out;
      }
      if (separator !== ",") this.fail("expected ',' or '}' in object");
      this.index += 1;
      this.skipWhitespace();
    }
  }
  private parseArray(depth: number): LosslessJsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const out: LosslessJsonValue[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return out;
    }
    for (;;) {
      if (out.length >= this.maxArrayItems) this.fail("array item count exceeds limit");
      out.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return out;
      }
      if (separator !== ",") this.fail("expected ',' or ']' in array");
      this.index += 1;
      this.skipWhitespace();
    }
  }
  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const ch = this.source[this.index];
      if (escaped) {
        escaped = false;
        this.index += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        this.index += 1;
        continue;
      }
      if (ch === '"') {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        let decoded: unknown;
        try {
          decoded = JSON.parse(token) as unknown;
        } catch (error) {
          throw new Error(`Invalid JSON string at byte ${start}`, { cause: error });
        }
        if (typeof decoded !== "string") this.fail("invalid string token");
        assertWellFormedUnicode(decoded, "JSON string");
        return decoded;
      }
      if (ch != null && ch.charCodeAt(0) <= 0x1f) this.fail("unescaped control character in string");
      this.index += 1;
    }
    this.fail("unterminated string");
  }
  private parseNumber(): LosslessJsonNumber {
    const rest = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (!match) this.fail("invalid JSON number");
    const token = match[0];
    this.index += token.length;
    return new LosslessJsonNumber(token);
  }
  private consumeLiteral(literal: string): boolean {
    if (!this.source.startsWith(literal, this.index)) return false;
    this.index += literal.length;
    return true;
  }
  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const ch = this.source.charCodeAt(this.index);
      if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) return;
      this.index += 1;
    }
  }
  private fail(message: string): never {
    throw new Error(`${message} at character ${this.index}`);
  }
}
export function parseLosslessJson(
  source: string,
  options: LosslessJsonParseOptions = {},
): LosslessJsonValue {
  return new Parser(source, options).parse();
}
export function decodeJsonBytes(
  bytes: Uint8Array,
  options: LosslessJsonParseOptions = {},
): { value: LosslessJsonValue; text: string; hadBom: boolean } {
  const hadBom = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = hadBom ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  } catch (error) {
    throw new Error("JSON document is not valid UTF-8", { cause: error });
  }
  return { value: parseLosslessJson(text, options), text, hadBom };
}
export function isLosslessObject(value: LosslessJsonValue): value is { [key: string]: LosslessJsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof LosslessJsonNumber);
}
export function losslessIntegerToken(value: LosslessJsonValue, label: string): string {
  if (!(value instanceof LosslessJsonNumber) || !/^(?:0|[1-9][0-9]*)$/.test(value.token)) {
    throw new Error(`${label} must be a non-negative canonical JSON integer`);
  }
  return value.token;
}
export function losslessNumberToken(value: LosslessJsonValue, label: string): string {
  if (!(value instanceof LosslessJsonNumber)) throw new Error(`${label} must be a JSON number`);
  return value.token;
}
export function losslessToJsonSafe(value: LosslessJsonValue): unknown {
  if (value instanceof LosslessJsonNumber) return { $number: value.token };
  if (Array.isArray(value)) return value.map(losslessToJsonSafe);
  if (isLosslessObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, losslessToJsonSafe(item)]));
  }
  return value;
}
export function canonicalLosslessJson(value: LosslessJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof LosslessJsonNumber) return value.token;
  if (Array.isArray(value)) return `[${value.map(canonicalLosslessJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalLosslessJson(value[key]!)}`)
    .join(",")}}`;
}
