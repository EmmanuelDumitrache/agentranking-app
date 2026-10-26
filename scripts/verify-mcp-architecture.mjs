import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const canonicalRuntime = resolve(root, "src/features/agent-chat/server/mcp");
const legacyGlobalRoute = resolve(root, "src/app/api/dashboard/mcp/test/route.ts");
const legacyAgentRoutes = resolve(root, "src/app/api/dashboard/agents");
const legacyVerificationMcpTools = resolve(root, "src/lib/verification/mcp-tools.ts");
const secretEnvelope = resolve(root, "src/lib/secret-envelope.ts");
const prismaSchema = resolve(root, "prisma/schema.prisma");
const sourceRoots = ["src", "services", "scripts", "packages"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const violations = [];

function normalize(path) {
  return relative(root, path).split(sep).join("/");
}

function extension(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot);
}

function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(path, visitor) {
  if (!(await exists(path))) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git" || entry.name === "dist") continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      await walk(child, visitor);
    } else if (entry.isFile()) {
      await visitor(child);
    }
  }
}


const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const rootDependencyNames = [
  rootPackage.dependencies,
  rootPackage.devDependencies,
  rootPackage.peerDependencies,
  rootPackage.optionalDependencies,
].flatMap((deps) => Object.keys(deps ?? {}));
const competingRootMcpDependencies = rootDependencyNames.filter((name) =>
  name === "@ai-sdk/mcp"
  || name === "@modelcontextprotocol/sdk"
  || name === "@modelcontextprotocol/server",
);
if (competingRootMcpDependencies.length > 0) {
  violations.push(
    `package.json declares competing MCP implementations (${competingRootMcpDependencies.join(", ")}); use @modelcontextprotocol/client through the canonical runtime`,
  );
}

if (await exists(legacyVerificationMcpTools)) {
  violations.push(
    `${normalize(legacyVerificationMcpTools)} is a legacy MCP-named domain implementation; expose protocol-neutral verification tools through the canonical runtime instead`,
  );
}

if (await exists(legacyGlobalRoute)) {
  violations.push(
    `${normalize(legacyGlobalRoute)} is a legacy second MCP HTTP surface; use the account connection and explicit agent-binding routes instead`,
  );
}

if (await exists(prismaSchema)) {
  const schema = await readFile(prismaSchema, "utf8");
  const connection = schema.match(/model AgentMcpConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
  const binding = schema.match(/model AgentMcpBinding \{[\s\S]*?\n\}/)?.[0] ?? "";
  const catalog = schema.match(/model AgentMcpCatalog \{[\s\S]*?\n\}/)?.[0] ?? "";
  if (/\bserviceId\b|\bagentDbId\s+Int\b/.test(connection)) {
    violations.push("AgentMcpConnection must be account-owned and independent of AgentService/Agent");
  }
  if (!/@@unique\(\[agentDbId, connectionId\]\)/.test(binding)) {
    violations.push("AgentMcpBinding must uniquely own the agent/connection assignment");
  }
  if (/serviceDigest|service_digest/.test(catalog)) {
    violations.push("AgentMcpCatalog must use a principal digest, not legacy AgentService terminology");
  }
}

if (await exists(secretEnvelope)) {
  const secretEnvelopeSource = await readFile(secretEnvelope, "utf8");
  if (secretEnvelopeSource.includes("LLM_PROVIDER_CREDENTIAL_")) {
    violations.push(
      `${normalize(secretEnvelope)} must use APPLICATION_SECRET_* encryption keys only; MCP/application secrets must not fall back to BYOK credential keys`,
    );
  }
}

for (const sourceRoot of sourceRoots) {
  await walk(resolve(root, sourceRoot), async (file) => {
    if (!sourceExtensions.has(extension(file))) return;
    if (file === resolve(root, "scripts/verify-mcp-architecture.mjs")) return;
    const text = await readFile(file, "utf8");
    const normalizedFile = normalize(file);
    const isTestContract = normalizedFile.includes("/__tests__/")
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedFile);
    const usesMcpSdk = /(?:from\s*["'](?:@modelcontextprotocol\/|@ai-sdk\/mcp)|import\s*\(\s*["'](?:@modelcontextprotocol\/|@ai-sdk\/mcp))/.test(text);
    const createsTransport = /\b(?:StreamableHTTPClientTransport|SSEClientTransport)\b/.test(text);
    if ((usesMcpSdk || createsTransport) && !isInside(file, canonicalRuntime)) {
      violations.push(
        `${normalize(file)} implements MCP protocol/runtime behavior outside ${normalize(canonicalRuntime)}`,
      );
    }
    if (
      isInside(file, canonicalRuntime)
      && !isTestContract
      && /\b(?:AgentService|agentService)\b/.test(text)
    ) {
      violations.push(
        `${normalize(file)} retains execution-time AgentService coupling inside the canonical MCP runtime`,
      );
    }
  });
}

await walk(legacyAgentRoutes, async (file) => {
  if (!sourceExtensions.has(extension(file))) return;
  const normalized = normalize(file);
  if (/\/mcp\/(?:connections|\[connectionId\])\//.test(normalized)) {
    violations.push(`${normalized} is a removed service-coupled MCP route surface`);
  }
});

await walk(resolve(root, "packages"), async (file) => {
  if (!file.endsWith(`${sep}package.json`)) return;
  const json = JSON.parse(await readFile(file, "utf8"));
  const dependencySets = [
    json.dependencies,
    json.devDependencies,
    json.peerDependencies,
    json.optionalDependencies,
  ];
  const mcpDependencies = dependencySets
    .flatMap((deps) => Object.keys(deps ?? {}))
    .filter((name) => name.startsWith("@modelcontextprotocol/"));
  if (mcpDependencies.length > 0) {
    violations.push(
      `${normalize(file)} declares MCP SDK dependencies (${mcpDependencies.join(", ")}); MCP belongs to the root Next.js app`,
    );
  }
});

if (!(await exists(canonicalRuntime))) {
  violations.push(`${normalize(canonicalRuntime)} is missing`);
}

for (const required of [
  "binding-repository.ts",
  "connection-service.ts",
  "credentials.ts",
  "discovery-service.ts",
  "network.ts",
  "platform-policy.ts",
  "policy-service.ts",
  "provider-registry.ts",
  "runtime-manager.ts",
  "tool-adapter.ts",
]) {
  const path = resolve(canonicalRuntime, required);
  if (!(await exists(path))) violations.push(`${normalize(path)} is required by the canonical MCP architecture`);
}

if (violations.length > 0) {
  console.error("MCP architecture verification failed:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `MCP architecture verified: account connections, explicit agent bindings, and one client runtime under ${normalize(canonicalRuntime)}; hosted public connector remains separate JSON-RPC in src/lib/public-mcp.`,
);
