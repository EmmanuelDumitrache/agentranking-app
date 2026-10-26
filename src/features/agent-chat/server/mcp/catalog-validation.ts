import "server-only";

import { createHash } from "node:crypto";
import { McpRuntimeError } from "./errors";
import type { McpJsonSchema, McpToolDefinition } from "./types";

export const MCP_DISCOVERY_LIMITS = Object.freeze({
  maxTools: 200,
  maxSchemaBytes: 128 * 1024,
  maxCatalogBytes: 2 * 1024 * 1024,
  maxRawResponseBytes: 4 * 1024 * 1024,
  maxPages: 10,
  maxSchemaDepth: 32,
  maxSchemaProperties: 1_000,
  maxUnionBranches: 100,
  maxRegexLength: 256,
  maxObjectKeyChars: 256,
  maxSupplementalItems: 500,
  maxSupplementalBytes: 256 * 1024,
  maxTitleChars: 240,
  maxDescriptionChars: 4_000,
});

function fail(message: string): never {
  throw new McpRuntimeError("MCP_DISCOVERY_LIMIT_EXCEEDED", message);
}

function utf8Bytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    fail("MCP catalog contains a cyclic or non-JSON value");
  }
}

export function sanitizeMcpCatalogText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return Array.from(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " "))
    .slice(0, max)
    .join("")
    .trim() || undefined;
}

function validateJsonValue(
  value: unknown,
  state: { depth: number; properties: number; seen: Set<object> },
  path: string,
  schemaKeywords: boolean,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") fail(`${path} contains a non-JSON value`);
  if (state.seen.has(value as object)) fail(`${path} contains a cyclic value`);
  if (state.depth >= MCP_DISCOVERY_LIMITS.maxSchemaDepth) {
    fail(`${path} exceeds the schema nesting limit`);
  }
  state.seen.add(value as object);
  state.depth += 1;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateJsonValue(value[index], state, `${path}[${index}]`, schemaKeywords);
    }
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    state.properties += entries.length;
    if (state.properties > MCP_DISCOVERY_LIMITS.maxSchemaProperties) {
      fail(`${path} exceeds the schema property limit`);
    }
    for (const [key, entry] of entries) {
      if (
        Array.from(key).length > MCP_DISCOVERY_LIMITS.maxObjectKeyChars
        || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(key)
      ) {
        fail(`${path} contains an invalid or oversized object key`);
      }
      if (schemaKeywords && key === "$ref") fail(`${path} uses unsupported JSON Schema references`);
      if (schemaKeywords && ["anyOf", "oneOf", "allOf"].includes(key)) {
        if (!Array.isArray(entry) || entry.length > MCP_DISCOVERY_LIMITS.maxUnionBranches) {
          fail(`${path} exceeds the schema union-branch limit`);
        }
      }
      if (schemaKeywords && (key === "pattern" || key === "patternProperties") && typeof entry === "string"
        && entry.length > MCP_DISCOVERY_LIMITS.maxRegexLength) {
        fail(`${path} exceeds the schema regular-expression limit`);
      }
      if (schemaKeywords && key === "patternProperties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        for (const pattern of Object.keys(entry as Record<string, unknown>)) {
          if (pattern.length > MCP_DISCOVERY_LIMITS.maxRegexLength) {
            fail(`${path} exceeds the schema regular-expression limit`);
          }
          try {
            new RegExp(pattern);
          } catch {
            fail(`${path} contains an invalid schema regular expression`);
          }
          assertSafeSchemaPattern(pattern, path);
        }
      }
      if (schemaKeywords && key === "pattern" && typeof entry === "string") {
        try {
          new RegExp(entry);
        } catch {
          fail(`${path} contains an invalid schema regular expression`);
        }
        assertSafeSchemaPattern(entry, path);
      }
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        fail(`${path} contains a forbidden object key`);
      }
      validateJsonValue(entry, state, `${path}.${key}`, schemaKeywords);
    }
  }
  state.depth -= 1;
  state.seen.delete(value as object);
}

function schemaPatternHasNestedBacktracking(pattern: string): boolean {
  const groups: Array<{ hasAlternation: boolean; hasQuantifier: boolean }> = [{
    hasAlternation: false,
    hasQuantifier: false,
  }];
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "(") {
      if (pattern.startsWith("(?:", index)) index += 2;
      else if (pattern.startsWith("(?", index)) return true;
      groups.push({ hasAlternation: false, hasQuantifier: false });
      continue;
    }
    const current = groups.at(-1)!;
    if (character === "|") {
      current.hasAlternation = true;
      continue;
    }
    if (character === ")" && groups.length > 1) {
      const group = groups.pop()!;
      const following = pattern.slice(index + 1);
      const quantified = /^[*+?]/u.test(following) || /^\{\d+(?:,\d*)?\}/u.test(following);
      if (quantified && (group.hasAlternation || group.hasQuantifier)) return true;
      const parent = groups.at(-1)!;
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifier ||= group.hasQuantifier || quantified;
      continue;
    }
    if (
      character === "*"
      || character === "+"
      || character === "?"
      || (character === "{" && /^\{\d+(?:,\d*)?\}/u.test(pattern.slice(index)))
    ) {
      current.hasQuantifier = true;
    }
  }
  return false;
}

function schemaPatternHasOversizedQuantifier(pattern: string): boolean {
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character !== "{") continue;
    const quantifier = pattern.slice(index).match(/^\{(\d+)(?:,(\d*))?\}/u);
    if (!quantifier) continue;
    const minimum = Number(quantifier[1]);
    const maximum = quantifier[2] ? Number(quantifier[2]) : minimum;
    if (
      !Number.isSafeInteger(minimum)
      || !Number.isSafeInteger(maximum)
      || minimum > 1_000
      || maximum > 1_000
    ) return true;
    index += quantifier[0].length - 1;
  }
  return false;
}

function assertSafeSchemaPattern(pattern: string, path: string): void {
  // JSON Schema patterns are attacker-controlled executable work. Reject
  // features that commonly create non-linear backtracking or make static
  // review ambiguous; providers can express the same validation structurally.
  if (
    /\\(?:[1-9]|k<)/u.test(pattern)
    || /\(\?(?:[=!]|<[=!])/u.test(pattern)
    || schemaPatternHasNestedBacktracking(pattern)
    || schemaPatternHasOversizedQuantifier(pattern)
    || /\.\*[^\n]{0,64}\.\*/u.test(pattern)
  ) {
    fail(`${path} contains an unsafe schema regular expression`);
  }
}

export function validateMcpJsonSchema(value: unknown, label: string): McpJsonSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is not an object schema`);
  }
  if (utf8Bytes(value) > MCP_DISCOVERY_LIMITS.maxSchemaBytes) {
    fail(`${label} exceeds the individual schema byte limit`);
  }
  validateJsonValue(value, { depth: 0, properties: 0, seen: new Set() }, label, true);
  return JSON.parse(JSON.stringify(value)) as McpJsonSchema;
}

export function validateMcpCatalogMetadata<T>(value: T, label: string): T {
  if (utf8Bytes(value) > MCP_DISCOVERY_LIMITS.maxSupplementalBytes) {
    fail(`${label} exceeds the metadata byte limit`);
  }
  validateJsonValue(value, { depth: 0, properties: 0, seen: new Set() }, label, false);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function validateMcpSupplementalCatalog(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", `${label} did not return an array`);
  }
  if (value.length > MCP_DISCOVERY_LIMITS.maxSupplementalItems) {
    fail(`${label} returned too many entries`);
  }
  return validateMcpCatalogMetadata(value, label);
}

export function canonicalMcpJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalMcpJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalMcpJson(entry)}`)
    .join(",")}}`;
}

export function mcpToolSchemaHash(tool: McpToolDefinition): string {
  return createHash("sha256").update(canonicalMcpJson({
    name: tool.name,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
  })).digest("hex");
}

export function validateMcpToolCatalog(rawTools: unknown): McpToolDefinition[] {
  if (!Array.isArray(rawTools)) {
    throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", "MCP tools/list did not return an array");
  }
  if (rawTools.length > MCP_DISCOVERY_LIMITS.maxTools) {
    fail("MCP server returned too many tools");
  }
  if (utf8Bytes(rawTools) > MCP_DISCOVERY_LIMITS.maxRawResponseBytes) {
    fail("MCP tools/list response exceeds the raw response limit");
  }
  const seen = new Set<string>();
  const tools = rawTools.map((raw, index): McpToolDefinition => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", `MCP tool at index ${index} is invalid`);
    }
    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!name || name.length > 200 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) {
      throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", `MCP tool at index ${index} has an invalid name`);
    }
    if (seen.has(name)) {
      throw new McpRuntimeError("MCP_PROTOCOL_UNSUPPORTED", `MCP catalog contains duplicate tool name ${name}`);
    }
    seen.add(name);
    const inputSchema = validateMcpJsonSchema(source.inputSchema, `Tool ${name} input schema`);
    const outputSchema = source.outputSchema === undefined
      ? undefined
      : validateMcpJsonSchema(source.outputSchema, `Tool ${name} output schema`);
    const rawAnnotations = source.annotations && typeof source.annotations === "object"
      && !Array.isArray(source.annotations)
      ? validateMcpCatalogMetadata(source.annotations, `Tool ${name} annotations`) as McpToolDefinition["annotations"]
      : undefined;
    const annotations = rawAnnotations
      ? {
          ...rawAnnotations,
          title: sanitizeMcpCatalogText(
            typeof rawAnnotations.title === "string" ? rawAnnotations.title : undefined,
            MCP_DISCOVERY_LIMITS.maxTitleChars,
          ),
        }
      : undefined;
    return {
      name,
      title: sanitizeMcpCatalogText(typeof source.title === "string" ? source.title : undefined, MCP_DISCOVERY_LIMITS.maxTitleChars),
      description: sanitizeMcpCatalogText(
        typeof source.description === "string" ? source.description : undefined,
        MCP_DISCOVERY_LIMITS.maxDescriptionChars,
      ),
      inputSchema,
      outputSchema,
      annotations,
    };
  });
  if (utf8Bytes(tools) > MCP_DISCOVERY_LIMITS.maxCatalogBytes) {
    fail("MCP catalog exceeds the persistence byte limit");
  }
  return tools;
}
