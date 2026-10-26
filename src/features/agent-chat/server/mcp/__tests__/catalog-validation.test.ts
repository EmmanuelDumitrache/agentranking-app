import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MCP_DISCOVERY_LIMITS,
  mcpToolSchemaHash,
  validateMcpCatalogMetadata,
  validateMcpJsonSchema,
  validateMcpSupplementalCatalog,
  validateMcpToolCatalog,
} from "../catalog-validation";

function tool(name: string) {
  return {
    name,
    description: "read data",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { address: { type: "string" } },
    },
  };
}

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

test("catalog validation enforces tool count, duplicates, schema references, and prototype keys", () => {
  assert.throws(() => validateMcpToolCatalog(
    Array.from({ length: MCP_DISCOVERY_LIMITS.maxTools + 1 }, (_, index) => tool(`tool_${index}`)),
  ));
  assert.throws(() => validateMcpToolCatalog([tool("same"), tool("same")]));
  assert.throws(() => validateMcpJsonSchema({ type: "object", $ref: "https://example.com/schema" }, "schema"));
  assert.throws(() => validateMcpJsonSchema(
    JSON.parse('{"type":"object","properties":{"constructor":{"type":"string"}}}'),
    "schema",
  ));
});

test("schema hashes are canonical and change only with executable descriptor content", () => {
  const left = tool("lookup");
  const right = {
    inputSchema: {
      properties: { address: { type: "string" } },
      additionalProperties: false,
      type: "object",
    },
    description: "a different presentation description",
    name: "lookup",
  };
  assert.equal(mcpToolSchemaHash(left), mcpToolSchemaHash(right));
  assert.notEqual(
    mcpToolSchemaHash(left),
    mcpToolSchemaHash({ ...left, inputSchema: { type: "object", required: ["address"] } }),
  );
});

test("cyclic and oversized schemas fail closed", () => {
  const cyclic: Record<string, unknown> = { type: "object" };
  cyclic.self = cyclic;
  assert.throws(() => validateMcpJsonSchema(cyclic, "schema"));
  assert.throws(() => validateMcpJsonSchema({
    type: "object",
    description: "x".repeat(MCP_DISCOVERY_LIMITS.maxSchemaBytes + 1),
  }, "schema"));
});

test("deep, over-broad, and pathological regular-expression schemas fail closed", () => {
  let deep: Record<string, unknown> = { type: "object" };
  const root = deep;
  for (let index = 0; index <= MCP_DISCOVERY_LIMITS.maxSchemaDepth; index += 1) {
    deep.properties = { nested: { type: "object" } };
    deep = (deep.properties as Record<string, Record<string, unknown>>).nested!;
  }
  assert.throws(() => validateMcpJsonSchema(root, "schema"));
  assert.throws(() => validateMcpJsonSchema({
    type: "string",
    pattern: "[".repeat(MCP_DISCOVERY_LIMITS.maxRegexLength + 1),
  }, "schema"));
  assert.throws(() => validateMcpJsonSchema({
    type: "string",
    oneOf: Array.from({ length: MCP_DISCOVERY_LIMITS.maxUnionBranches + 1 }, () => ({ type: "string" })),
  }, "schema"));
  for (const pattern of [
    "^(a+)+$",
    "(.*a){2,}",
    "^(.*)(.*)$",
    "(?=secret).*",
    "(a)\\1",
    "^(a|aa)+$",
    "^(a|(aa))+$",
    "a{1000000}",
  ]) {
    assert.throws(() => validateMcpJsonSchema({ type: "string", pattern }, "schema"), pattern);
  }
  assert.doesNotThrow(() => validateMcpJsonSchema({
    type: "string",
    pattern: "^[a-z0-9_-]{1,64}$",
  }, "schema"));
});

test("presentation text is bounded without changing executable schemas", () => {
  const [validated] = validateMcpToolCatalog([{
    ...tool("bounded"),
    title: "t".repeat(MCP_DISCOVERY_LIMITS.maxTitleChars + 100),
    description: "d".repeat(MCP_DISCOVERY_LIMITS.maxDescriptionChars + 100),
  }]);
  assert.ok(validated);
  assert.equal(Array.from(validated.title ?? "").length, MCP_DISCOVERY_LIMITS.maxTitleChars);
  assert.equal(Array.from(validated.description ?? "").length, MCP_DISCOVERY_LIMITS.maxDescriptionChars);
});

test("annotations and supplemental discovery surfaces receive JSON, depth, count, and byte bounds", () => {
  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let index = 0; index <= MCP_DISCOVERY_LIMITS.maxSchemaDepth; index += 1) {
    deep.child = {};
    deep = deep.child as Record<string, unknown>;
  }
  assert.throws(() => validateMcpCatalogMetadata(root, "metadata"));
  assert.throws(() => validateMcpSupplementalCatalog(
    Array.from({ length: MCP_DISCOVERY_LIMITS.maxSupplementalItems + 1 }, () => ({})),
    "resources",
  ));
  assert.throws(() => validateMcpToolCatalog([{
    ...tool("bad_annotations"),
    annotations: JSON.parse('{"constructor":{"readOnlyHint":true}}'),
  }]));
});

test("catalog persistence keeps last-good data on refresh failure and quarantines material changes", async () => {
  const repository = await source("src/features/agent-chat/server/mcp/repository.ts");
  const discovery = await source("src/features/agent-chat/server/mcp/discovery-service.ts");
  const clientFactory = await source("src/features/agent-chat/server/mcp/client-factory.ts");
  assert.match(clientFactory, /listMaxPages: MCP_DISCOVERY_LIMITS\.maxPages/);
  assert.match(repository, /RISK_RANK\[existing\.effectiveRisk\] > RISK_RANK\[classification\.effectiveRisk\]/);
  assert.match(repository, /manifestChanged/);
  assert.match(repository, /if \(materialChange\) materialCatalogChange = true/);
  assert.match(repository, /nextRevision = materialCatalogChange/);
  assert.match(repository, /CATALOG_TOOL_CHANGE/);
  assert.match(repository, /previousSchemaHash: existing\?\.schemaHash/);
  assert.match(repository, /CATALOG_TOOL_REMOVE/);
  assert.match(repository, /riskClassificationChanged/);
  assert.match(repository, /schemaChanged[\s\S]*?riskClassificationChanged[\s\S]*?identityChanged[\s\S]*?appearedAfterExplicitPolicy/);
  assert.ok((repository.match(/acknowledgedSchemaHash: null/g)?.length ?? 0) >= 2);
  assert.match(repository, /previousSchemaHash: schemaChanged/);
  assert.match(repository, /active: false/);
  assert.match(repository, /Tool was removed from the latest provider catalog/);
  assert.match(repository, /quarantined: true/);
  assert.match(discovery, /connection\.catalogRevision > 0\s*\? "DEGRADED"/);
  assert.match(discovery, /retainedCatalogRevision: connection\.catalogRevision/);
});
