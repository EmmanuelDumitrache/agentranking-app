import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const allowlistPath = path.join(repoRoot, "scripts/client-server-ownership-allowlist.json");
const publicProviderScopePath = path.join(srcRoot, "lib/public-site/provider-scope.json");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
function toRepoPath(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}
function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function validateAllowlistEntry(entry, section) {
  for (const field of ["path", "reason", "owner", "removalCondition"]) {
    if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
      throw new Error(`${section} contains an entry without a non-empty ${field}`);
    }
  }
}
function globPatternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withGlobstar = escaped.replaceAll("**", "\u0000");
  const withStar = withGlobstar.replaceAll("*", "[^/]*");
  return new RegExp(`^${withStar.replaceAll("\u0000", ".*")}$`);
}
function matchesAllowlist(repoPath, entries) {
  return entries.some((entry) => globPatternToRegExp(entry.path).test(repoPath));
}
function validateRouteScope(scope, name) {
  if (!scope || !Array.isArray(scope.exact) || !Array.isArray(scope.prefixes)) {
    throw new Error(`Public provider scope ${name} must contain exact and prefixes arrays`);
  }
  for (const value of [...scope.exact, ...scope.prefixes]) {
    if (typeof value !== "string" || !value.startsWith("/")) {
      throw new Error(`Public provider scope ${name} contains invalid route ${String(value)}`);
    }
  }
}
function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
function pathMatchesRouteScope(pathname, scope) {
  return scope.exact.includes(pathname)
    || scope.prefixes.some((prefix) => pathMatchesPrefix(pathname, prefix));
}
function isClientModule(source) {
  return /^\s*(?:"use client"|'use client')\s*;/.test(source);
}
function isServerActionModule(source) {
  return /^\s*(?:"use server"|'use server')\s*;/.test(source);
}
function isTypeOnlyClause(clause) {
  if (/^\s*type\b/.test(clause)) return true;
  const brace = clause.match(/^\s*\{([\s\S]*)\}\s*$/);
  if (!brace) return false;
  const bindings = brace[1].split(",").map((part) => part.trim()).filter(Boolean);
  return bindings.length > 0 && bindings.every((binding) => binding.startsWith("type "));
}
function parseImports(source) {
  const imports = [];
  const fromPattern = /\b(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(fromPattern)) {
    const clause = match[1];
    if (clause.includes(";")) continue;
    imports.push({ specifier: match[2], typeOnly: isTypeOnlyClause(clause) });
  }
  const sideEffectPattern = /\bimport\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(sideEffectPattern)) {
    imports.push({ specifier: match[1], typeOnly: false });
  }
  const dynamicPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    imports.push({ specifier: match[1], typeOnly: false });
  }
  return imports;
}
function resolveLocalImport(importer, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}
function isServerMarkerPath(repoPath, source) {
  return (
    source.includes('"server-only"')
    || source.includes("'server-only'")
    || /(?:^|\/)server(?:\/|$)/.test(repoPath)
    || /\.server\.[^.]+$/.test(repoPath)
  );
}
function isDalLikeServerModule(repoPath) {
  if (repoPath.endsWith(".tsx") || repoPath.endsWith(".jsx")) return false;
  return repoPath.startsWith("src/lib/") || repoPath.includes("/server/");
}
function isNamedCall(node, name) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  return (
    (ts.isIdentifier(expression) && expression.text === name)
    || (
      ts.isPropertyAccessExpression(expression)
      && expression.name.text === name
    )
  );
}
function unwrapFunctionInitializer(initializer) {
  if (!initializer) return null;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer;
  }
  if (
    ts.isCallExpression(initializer)
    && (isNamedCall(initializer, "useCallback") || isNamedCall(initializer, "useMemo"))
  ) {
    const first = initializer.arguments[0];
    return first && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))
      ? first
      : null;
  }
  return null;
}
function localFunctionsByName(sourceFile) {
  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fn = unwrapFunctionInitializer(node.initializer);
      if (fn) functions.set(node.name.text, fn);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return functions;
}
function isFetchCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return node.expression.text === "fetch";
  return (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "fetch"
    && ts.isIdentifier(node.expression.expression)
    && ["globalThis", "window"].includes(node.expression.expression.text)
  );
}
function containsSameApplicationApiFetch(source, absolutePath) {
  if (!/\bfetch\b/.test(source) || !source.includes("/api/")) return false;
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  function visit(node) {
    if (found) return;
    if (isFetchCall(node)) {
      const target = node.arguments[0];
      const value = target && (
        ts.isStringLiteral(target)
        || ts.isNoSubstitutionTemplateLiteral(target)
      )
        ? target.text
        : target && ts.isTemplateExpression(target)
          ? target.head.text
          : null;
      if (value?.startsWith("/api/")) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}
function containsMountFetch(source, absolutePath) {
  if (!isClientModule(source) || !/\buseEffect\b/.test(source) || !/\bfetch\b/.test(source)) {
    return false;
  }
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const functions = localFunctionsByName(sourceFile);
  const memo = new Map();
  function functionContainsFetch(fn, visiting = new Set()) {
    if (memo.has(fn)) return memo.get(fn);
    if (visiting.has(fn)) return false;
    visiting.add(fn);
    let found = false;
    function visit(node) {
      if (found) return;
      if (node !== fn && ts.isFunctionLike(node)) return;
      if (isFetchCall(node)) {
        found = true;
        return;
      }
      if (ts.isCallExpression(node)) {
        let calledExpression = node.expression;
        while (ts.isParenthesizedExpression(calledExpression)) {
          calledExpression = calledExpression.expression;
        }
        if (ts.isArrowFunction(calledExpression) || ts.isFunctionExpression(calledExpression)) {
          if (functionContainsFetch(calledExpression, visiting)) {
            found = true;
            return;
          }
        }
        if (ts.isIdentifier(calledExpression)) {
          const local = functions.get(calledExpression.text);
          if (local && functionContainsFetch(local, visiting)) {
            found = true;
            return;
          }
        }
        for (const argument of node.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            if (functionContainsFetch(argument, visiting)) {
              found = true;
              return;
            }
          } else if (ts.isIdentifier(argument)) {
            const local = functions.get(argument.text);
            if (local && functionContainsFetch(local, visiting)) {
              found = true;
              return;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    if (fn.body) visit(fn.body);
    visiting.delete(fn);
    memo.set(fn, found);
    return found;
  }
  let mountFetch = false;
  function findEffects(node) {
    if (mountFetch) return;
    if (isNamedCall(node, "useEffect")) {
      const callback = node.arguments[0];
      if (callback) {
        if (
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          && functionContainsFetch(callback)
        ) {
          mountFetch = true;
          return;
        }
        if (ts.isIdentifier(callback)) {
          const local = functions.get(callback.text);
          if (local && functionContainsFetch(local)) {
            mountFetch = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, findEffects);
  }
  findEffects(sourceFile);
  return mountFetch;
}
const allowlist = readJson(allowlistPath);
const publicProviderScope = readJson(publicProviderScopePath);
for (const name of ["query", "session", "wallet"]) {
  validateRouteScope(publicProviderScope[name], name);
}
for (const section of ["clientRouteEntries", "mountTimeClientLoaders", "serverToClientImports"]) {
  if (!Array.isArray(allowlist[section])) {
    throw new Error(`Ownership allowlist section ${section} must be an array`);
  }
  allowlist[section].forEach((entry) => validateAllowlistEntry(entry, section));
}
const files = walk(srcRoot);
const records = new Map();
for (const absolutePath of files) {
  const source = fs.readFileSync(absolutePath, "utf8");
  const repoPath = toRepoPath(absolutePath);
  records.set(absolutePath, {
    absolutePath,
    repoPath,
    source,
    client: isClientModule(source),
    serverAction: isServerActionModule(source),
    serverMarked: isServerMarkerPath(repoPath, source),
    imports: parseImports(source),
  });
}
const failures = [];
function fail(repoPath, message) {
  failures.push(`${repoPath}: ${message}`);
}
function collectReachableRecords(entryAbsolutePath) {
  const reachable = [];
  const visited = new Set();
  const pending = [entryAbsolutePath];
  while (pending.length > 0) {
    const absolutePath = pending.pop();
    if (!absolutePath || visited.has(absolutePath)) continue;
    visited.add(absolutePath);
    const record = records.get(absolutePath);
    if (!record) continue;
    reachable.push(record);
    for (const imported of record.imports) {
      if (imported.typeOnly) continue;
      const target = resolveLocalImport(record.absolutePath, imported.specifier);
      if (target && !visited.has(target)) pending.push(target);
    }
  }
  return reachable;
}
const workerEntryPath = path.join(srcRoot, "worker/main.ts");
const workerEntry = records.get(workerEntryPath);
if (!workerEntry) {
  fail(toRepoPath(workerEntryPath), "standalone worker entrypoint is missing");
} else {
  for (const record of collectReachableRecords(workerEntryPath)) {
    for (const imported of record.imports) {
      if (imported.typeOnly) continue;
      if (imported.specifier === "next" || imported.specifier.startsWith("next/")) {
        fail(
          record.repoPath,
          `standalone worker import graph reaches Next.js runtime ${imported.specifier}; move shared errors/types/readers behind a framework-neutral module`,
        );
      }
    }
  }
}

function publicRoutePath(pageAbsolutePath) {
  const publicSiteRoot = path.join(srcRoot, "app/(public-site)");
  const relativeDirectory = path.relative(publicSiteRoot, path.dirname(pageAbsolutePath));
  if (relativeDirectory === "") return "/";
  const segments = relativeDirectory
    .split(path.sep)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}
function importsPackage(record, predicate) {
  return record.imports.some((entry) => !entry.typeOnly && predicate(entry.specifier));
}
for (const section of ["clientRouteEntries", "mountTimeClientLoaders", "serverToClientImports"]) {
  const seen = new Set();
  for (const entry of allowlist[section]) {
    if (seen.has(entry.path)) {
      fail(toRepoPath(allowlistPath), `${section} contains duplicate pattern ${entry.path}`);
    }
    seen.add(entry.path);
  }
}
for (const entry of allowlist.clientRouteEntries) {
  const matched = [...records.values()].some((record) => (
    record.client
    && /\/(?:page|layout)\.(?:tsx|jsx)$/.test(record.repoPath)
    && globPatternToRegExp(entry.path).test(record.repoPath)
  ));
  if (!matched) {
    fail(toRepoPath(allowlistPath), `stale clientRouteEntries pattern ${entry.path}`);
  }
}
for (const entry of allowlist.mountTimeClientLoaders) {
  const matched = [...records.values()].some((record) => (
    containsMountFetch(record.source, record.absolutePath)
    && globPatternToRegExp(entry.path).test(record.repoPath)
  ));
  if (!matched) {
    fail(toRepoPath(allowlistPath), `stale mountTimeClientLoaders pattern ${entry.path}`);
  }
}
for (const record of records.values()) {
  if (/^(?:<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)(?: .*)?$/m.test(record.source)) {
    fail(record.repoPath, "unresolved merge-conflict marker is present");
  }
}
for (const record of records.values()) {
  if (!record.client) continue;
  for (const imported of record.imports) {
    if (imported.typeOnly) continue;
    const specifier = imported.specifier;
    if (
      specifier === "@/lib/db"
      || specifier.startsWith("@/generated/prisma")
      || specifier === "next/headers"
      || specifier === "next/cache"
      || specifier === "next/server"
      || NODE_BUILTINS.has(specifier)
    ) {
      fail(record.repoPath, `client module imports server runtime ${specifier}`);
    }
  }
}
const serverReachabilityMemo = new Map();
function reachesServerOnly(absolutePath, visiting = new Set()) {
  if (serverReachabilityMemo.has(absolutePath)) return serverReachabilityMemo.get(absolutePath);
  if (visiting.has(absolutePath)) return null;
  const record = records.get(absolutePath);
  if (!record) return null;
  if (record.serverAction) return null;
  if (record.serverMarked) {
    serverReachabilityMemo.set(absolutePath, record.repoPath);
    return record.repoPath;
  }
  visiting.add(absolutePath);
  for (const imported of record.imports) {
    if (imported.typeOnly) continue;
    const target = resolveLocalImport(absolutePath, imported.specifier);
    if (!target) continue;
    const reached = reachesServerOnly(target, visiting);
    if (reached) {
      visiting.delete(absolutePath);
      serverReachabilityMemo.set(absolutePath, reached);
      return reached;
    }
  }
  visiting.delete(absolutePath);
  serverReachabilityMemo.set(absolutePath, null);
  return null;
}
for (const record of records.values()) {
  if (!record.client) continue;
  for (const imported of record.imports) {
    if (imported.typeOnly) continue;
    const target = resolveLocalImport(record.absolutePath, imported.specifier);
    if (!target) continue;
    const reached = reachesServerOnly(target);
    if (reached) {
      fail(record.repoPath, `client import graph reaches server-only module ${reached}`);
      break;
    }
  }
}
for (const record of records.values()) {
  if (!record.serverMarked || !isDalLikeServerModule(record.repoPath)) continue;
  for (const imported of record.imports) {
    if (imported.typeOnly) continue;
    const target = resolveLocalImport(record.absolutePath, imported.specifier);
    const targetRecord = target ? records.get(target) : null;
    if (!targetRecord?.client) continue;
    const allowKey = `${record.repoPath} -> ${targetRecord.repoPath}`;
    if (!matchesAllowlist(allowKey, allowlist.serverToClientImports)) {
      fail(record.repoPath, `DAL/server runtime imports client entrypoint ${targetRecord.repoPath}`);
    }
  }
}
for (const record of records.values()) {
  const isRouteEntry = /\/(?:page|layout)\.(?:tsx|jsx)$/.test(record.repoPath);
  if (record.client && isRouteEntry && !matchesAllowlist(record.repoPath, allowlist.clientRouteEntries)) {
    fail(record.repoPath, 'page/layout declares "use client" without a reviewed ownership exception');
  }
  if (
    isRouteEntry
    && !record.client
    && containsSameApplicationApiFetch(record.source, record.absolutePath)
  ) {
    fail(record.repoPath, "Server Component fetches a same-application /api route instead of an owned server reader");
  }
  if (
    isRouteEntry
    && !record.client
    && record.source.includes("ensureMinimalUserProfile")
  ) {
    fail(record.repoPath, "server page/layout creates a user profile during a read; use getDashboardUserProfile or an explicit mutation");
  }
  if (
    containsMountFetch(record.source, record.absolutePath)
    && !matchesAllowlist(record.repoPath, allowlist.mountTimeClientLoaders)
  ) {
    fail(record.repoPath, "client module combines useEffect and fetch without a reviewed loader classification");
  }
}
const walletProvider = records.get(path.join(srcRoot, "providers/wallet-provider.tsx"));
if (walletProvider) {
  const importsQueryProvider = walletProvider.imports.some((entry) => (
    !entry.typeOnly && entry.specifier === "@/providers/query-provider"
  ));
  if (!importsQueryProvider || !/<QueryProvider>/.test(walletProvider.source)) {
    fail(
      walletProvider.repoPath,
      "WalletProvider must own QueryProvider because Wagmi and RainbowKit require TanStack Query",
    );
  }
}
const publicPagePrefix = "src/app/(public-site)/";
for (const record of records.values()) {
  if (!record.repoPath.startsWith(publicPagePrefix) || !/\/page\.(?:tsx|jsx)$/.test(record.repoPath)) {
    continue;
  }
  const routePath = publicRoutePath(record.absolutePath);
  const reachable = collectReachableRecords(record.absolutePath);
  const requiresQuery = reachable.some((candidate) => importsPackage(
    candidate,
    (specifier) => specifier === "@tanstack/react-query" || specifier.startsWith("@tanstack/react-query/"),
  ));
  const requiresWallet = reachable.some((candidate) => importsPackage(
    candidate,
    (specifier) => (
      specifier === "wagmi"
      || specifier.startsWith("wagmi/")
      || specifier === "@rainbow-me/rainbowkit"
      || specifier.startsWith("@rainbow-me/rainbowkit/")
    ),
  ));
  const requiresSession = reachable.some((candidate) => (
    /\buseSession\s*\(/.test(candidate.source)
    && importsPackage(
      candidate,
      (specifier) => specifier === "next-auth/react" || specifier.startsWith("next-auth/react/"),
    )
  ));
  const hasWalletScope = pathMatchesRouteScope(routePath, publicProviderScope.wallet);
  if (requiresWallet && !hasWalletScope) {
    fail(record.repoPath, `public route ${routePath} uses Wagmi/RainbowKit without wallet scope`);
  }
  if (requiresQuery && !hasWalletScope && !pathMatchesRouteScope(routePath, publicProviderScope.query)) {
    fail(record.repoPath, `public route ${routePath} uses TanStack Query without query scope`);
  }
  if (requiresSession && !pathMatchesRouteScope(routePath, publicProviderScope.session)) {
    fail(record.repoPath, `public route ${routePath} uses useSession without session scope`);
  }
}
const rootLayout = records.get(path.join(srcRoot, "app/layout.tsx"));
if (rootLayout) {
  const dynamicImports = rootLayout.imports
    .map((entry) => entry.specifier)
    .filter((specifier) => ["next/headers", "next/cache", "next/server"].includes(specifier));
  if (dynamicImports.length > 0 || /\b(?:headers|cookies|draftMode)\s*\(/.test(rootLayout.source)) {
    fail(rootLayout.repoPath, "root layout uses a request Dynamic API; move the read to the narrow route that owns it");
  }
}
for (const record of records.values()) {
  for (const symbol of ["RequestHostProvider", "useRequestHost", "x-pathname"]) {
    if (record.source.includes(symbol)) {
      fail(record.repoPath, `retired ownership symbol ${symbol} is present`);
    }
  }
}
const requiredSecurityMarkers = [
  ["src/app/api/referrals/my-stats/route.ts", "requireLaunchWalletSessionForAddress"],
  ["src/app/api/referrals/set-code/route.ts", "requireLaunchWalletSessionForAddress"],
  ["src/app/api/referrals/track/route.ts", "requireLaunchWalletSessionForAddress"],
  ["src/app/api/agents/star/route.ts", "requireLaunchWalletSessionForAddress"],
  ["src/app/api/profiles/follow/route.ts", "resolveFollowerForRequest"],
  ["src/app/api/profiles/[address]/route.ts", "resolveFollowerForRequest"],
  ["src/app/api/agent-launch/launches/[launchId]/profile/route.ts", "assertAgentLaunchDraftAccess"],
  ["src/app/(public-site)/tokens/[mint]/edit/page.tsx", "assertAgentLaunchDraftAccess"],
];
for (const [repoPath, marker] of requiredSecurityMarkers) {
  const record = [...records.values()].find((candidate) => candidate.repoPath === repoPath);
  if (!record || !record.source.includes(marker)) {
    fail(repoPath, `security-sensitive route must enforce ${marker}`);
  }
}
const unstakeReport = [...records.values()].find(
  (candidate) => candidate.repoPath === "src/app/api/token/staking/report-unstake/route.ts",
);
if (
  !unstakeReport
  || !unstakeReport.source.includes("ONCHAIN_RECONCILIATION_REQUIRED")
  || unstakeReport.source.includes("@/lib/db")
) {
  fail(
    "src/app/api/token/staking/report-unstake/route.ts",
    "caller-reported unstake state must remain disabled in favour of authoritative on-chain reconciliation",
  );
}
const readOnlyProfileModules = [
  "src/lib/app-account-summary.ts",
  "src/lib/dashboard/access.ts",
  "src/lib/dashboard/account-settings.server.ts",
  "src/lib/dashboard/account-subscription.server.ts",
  "src/lib/dashboard/account-support.server.ts",
  "src/lib/referral-dashboard.ts",
  "src/lib/agent-directory/compare.server.ts",
  "src/lib/agent-detail-server.ts",
  "src/features/agent-chat/server/access.ts",
  "src/lib/dashboard/agent-mcp-access.ts",
  "src/lib/account-security/mfa-challenge.server.ts",
  "src/lib/metaplex-launch/attempt-store.server.ts",
];
for (const repoPath of readOnlyProfileModules) {
  const record = [...records.values()].find((candidate) => candidate.repoPath === repoPath);
  if (record?.source.includes("ensureMinimalUserProfile")) {
    fail(repoPath, "read path must not create a UserProfile");
  }
}
const legacyMemoryPage = path.join(
  srcRoot,
  "app/dashboard/agents/[agentDbId]/memory/page.tsx",
);
if (fs.existsSync(legacyMemoryPage)) {
  fail(
    toRepoPath(legacyMemoryPage),
    "memory page must live inside dashboard/(workspace) so it receives the authenticated shell and scoped providers",
  );
}
const workspaceMemoryPagePath = path.join(
  srcRoot,
  "app/dashboard/(workspace)/agents/[agentDbId]/memory/page.tsx",
);
const workspaceMemoryPage = records.get(workspaceMemoryPagePath);
if (
  !workspaceMemoryPage ||
  workspaceMemoryPage.client ||
  !workspaceMemoryPage.source.includes("requireDashboardAgentPage") ||
  !workspaceMemoryPage.source.includes("readAgentMemoryPageData")
) {
  fail(
    toRepoPath(workspaceMemoryPagePath),
    "memory page must be a server-led workspace route with owner authorisation and initial memory data",
  );
}
const memoryClientPath = path.join(
  srcRoot,
  "components/dashboard/agent-memory-page.tsx",
);
const memoryClient = records.get(memoryClientPath);
if (!memoryClient?.client || /\buseEffect\s*\(/.test(memoryClient.source)) {
  fail(
    toRepoPath(memoryClientPath),
    "memory client must consume server initialData and must not load primary data from a mount effect",
  );
}
const memoryRepositoryPath = path.join(
  srcRoot,
  "features/agent-memory/server/repository.ts",
);
const memoryRepository = records.get(memoryRepositoryPath);
if (
  !memoryRepository?.source.includes("readAgentMemorySettings") ||
  memoryRepository.source.includes("ensureAgentMemorySettings") ||
  !memoryRepository.source.includes("agentDbId_appAccountId_contentHash") ||
  !memoryRepository.source.includes("upsertExtractedAgentMemory") ||
  !memoryRepository.source.includes("forgetAgentMemoryByKey") ||
  !memoryRepository.source.includes("validateMemoryKey") ||
  !memoryRepository.source.includes("newManualMemoryKey") ||
  !memoryRepository.source.includes("randomUUID") ||
  !memoryRepository.source.includes('fact.status === "pending" && row.status === "pending"') ||
  !memoryRepository.source.includes("isSafeMemoryContent")
) {
  fail(
    toRepoPath(memoryRepositoryPath),
    "memory repository must keep reads mutation-free, account-scoped, and support keyed upsert/forget semantics",
  );
}
const memoryAccessPath = path.join(
  srcRoot,
  "features/agent-memory/server/access.ts",
);
const memoryAccess = records.get(memoryAccessPath);
if (
  !memoryAccess?.source.includes("getDashboardUserProfile") ||
  !memoryAccess.source.includes("buildOwnedAgentsWhere") ||
  !memoryAccess.source.includes("appAccount.findUnique") ||
  !memoryAccess.source.includes("ownerAccountId") ||
  !memoryAccess.source.includes("appAccountId") ||
  memoryAccess.source.includes("ensureMinimalUserProfile") ||
  memoryAccess.source.includes("ensureAppAccountForProfile") ||
  memoryAccess.source.includes('from "@/features/agent-chat/server/access"')
) {
  fail(
    toRepoPath(memoryAccessPath),
    "memory access must be read-only, owner-authorised, account-scoped, and independent of chat/account provisioning",
  );
}
const memoryExtractPath = path.join(
  srcRoot,
  "features/agent-memory/server/extract.ts",
);
const memoryExtract = records.get(memoryExtractPath);
for (const marker of [
  "deliveryGenerationRunId = payload.sourceRunId",
  'status: "COMPLETED"',
  'settlementStatus: "SETTLED"',
  "responseMessageId: finalResponse.id",
  "appAccountId: payload.appAccountId",
  "conversationId: payload.conversationId",
  "id: payload.sourceMessageId",
  'role: "assistant"',
  "sequence: { gt: source.sequence }",
  "messageRequiresContinuation",
  "parkExtractionUntilStableTurn",
  "buildOwnedAgentsWhere(ownerProfile)",
  "AGENT_MEMORY_MAX_EXTRACT_INPUT_CHARS",
  "validatePersistedAgentChatMessage",
  "Output.object",
  "upsertExtractedAgentMemory",
  "forgetAgentMemoryByKey",
  "rankMemoryCandidatesLocally",
  "redactSensitiveText",
]) {
  if (!memoryExtract?.source.includes(marker)) {
    fail(
      toRepoPath(memoryExtractPath),
      `memory extraction must retain turn-scoped structured mutation marker ${marker}`,
    );
  }
}
if (
  memoryExtract?.source.includes("semantic-ranking") ||
  memoryExtract?.source.includes("rankCandidatesSemantically")
) {
  fail(
    toRepoPath(memoryExtractPath),
    "memory extraction must not depend on the platform embedding lane",
  );
}
if (memoryExtract?.source.includes("isLikelyDurableMemoryCandidate")) {
  fail(
    toRepoPath(memoryExtractPath),
    "memory extraction must not use an English regex as its durable-memory recall gate",
  );
}
const memoryEnqueuePath = path.join(
  srcRoot,
  "features/agent-memory/server/enqueue.ts",
);
const memoryEnqueue = records.get(memoryEnqueuePath);
if (
  !memoryEnqueue?.source.includes("database outbox owns logical turn delivery") ||
  !memoryEnqueue.source.includes("input.sourceMessageId}:${input.sourceRunId}") ||
  !memoryEnqueue.source.includes("MEMORY_EXTRACT_GENERATION_DEDUPE_SECONDS") ||
  memoryEnqueue.source.includes("`memory-extract:${input.sourceMessageId}`")
) {
  fail(
    toRepoPath(memoryEnqueuePath),
    "memory extraction queue dedupe must be run-generation-scoped while the database outbox owns logical turn delivery",
  );
}
const memoryLocalRankingPath = path.join(
  srcRoot,
  "features/agent-memory/server/local-ranking.ts",
);
const memoryLocalRanking = records.get(memoryLocalRankingPath);
if (
  !memoryLocalRanking?.source.includes("rankMemoryCandidatesLocally") ||
  memoryLocalRanking.source.includes("openrouter") ||
  memoryLocalRanking.source.includes("embedMany") ||
  memoryLocalRanking.source.includes("generateText")
) {
  fail(
    toRepoPath(memoryLocalRankingPath),
    "prompt-time memory ranking must remain local and provider-independent",
  );
}

const memoryPromptPath = path.join(
  srcRoot,
  "features/agent-memory/server/prompt-memory.ts",
);
const memoryPrompt = records.get(memoryPromptPath);
if (
  !memoryPrompt?.source.includes("readAgentMemorySettings") ||
  !memoryPrompt.source.includes("AGENT_MEMORY_MAX_PROMPT_CHARS") ||
  !memoryPrompt.source.includes("AGENT_MEMORY_MAX_LIVE_FACTS") ||
  !memoryPrompt.source.includes("MAX_NONRELEVANT_FALLBACK_FACTS") ||
  !memoryPrompt.source.includes("query") ||
  !memoryPrompt.source.includes("salience") ||
  !memoryPrompt.source.includes("pinned") ||
  !memoryPrompt.source.includes("rankMemoryCandidatesLocally") ||
  memoryPrompt.source.includes("semantic-ranking") ||
  memoryPrompt.source.includes("rankCandidatesSemantically") ||
  !memoryPrompt.source.includes("redactSensitiveText") ||
  memoryPrompt.source.includes("ensureAgentMemorySettings")
) {
  fail(
    toRepoPath(memoryPromptPath),
    "prompt memory must remain read-oriented and rank account-scoped memories locally against the current query",
  );
}
const memoryStreamPath = path.join(
  srcRoot,
  "features/agent-chat/server/run/stream-run.ts",
);
const memoryStream = records.get(memoryStreamPath);
if (memoryStream?.source.includes("enqueueMemoryExtract")) {
  fail(
    toRepoPath(memoryStreamPath),
    "chat stream teardown must not bypass the durable memory extraction outbox",
  );
}
for (const marker of [
  "getCanonicalUserMessage",
  'body.triggerKind === "REGENERATE"',
  "messageAlreadyPersisted: true",
  "throughMessageId: message.id",
]) {
  if (!memoryStream?.source.includes(marker)) {
    fail(
      toRepoPath(memoryStreamPath),
      `regeneration must resolve canonical server history before model-facing decisions (${marker})`,
    );
  }
}

const startRunPath = path.join(
  srcRoot,
  "features/agent-chat/server/run/start-run.ts",
);
const startRun = records.get(startRunPath);
for (const marker of [
  "responseMessageIdForRun",
  'triggerKind === "REGENERATE" && !existingUser',
  'role: "user"',
  'sequence: { gt: existingUser.sequence }',
  'triggerKind !== "REGENERATE" && existingUser',
]) {
  if (!startRun?.source.includes(marker)) {
    fail(
      toRepoPath(startRunPath),
      `chat run creation must keep deterministic response ids and canonical latest-turn regeneration (${marker})`,
    );
  }
}

const historyPath = path.join(
  srcRoot,
  "features/agent-chat/server/history.ts",
);
const history = records.get(historyPath);
if (
  !history?.source.includes("throughMessageId") ||
  !history.source.includes("summaryThroughSequence") ||
  !history.source.includes("lte: throughMessage.sequence")
) {
  fail(
    toRepoPath(historyPath),
    "regeneration history must stop at the canonical source turn and reject compacted history",
  );
}

const summaryPath = path.join(
  srcRoot,
  "features/agent-chat/server/conversation-summary.ts",
);
const summary = records.get(summaryPath);
if (
  !summary?.source.includes("messages.some(messageRequiresContinuation)") ||
  !summary.source.includes("redactSensitiveText")
) {
  fail(
    toRepoPath(summaryPath),
    "conversation compaction must preserve unresolved approval/MCP state verbatim and redact sensitive text before auxiliary summarization",
  );
}
const settleRunPath = path.join(
  srcRoot,
  "features/agent-chat/server/run/settle-run.ts",
);
const settleRun = records.get(settleRunPath);
if (
  !settleRun?.source.includes("agentMemoryExtractionOutbox.upsert") ||
  !settleRun.source.includes("resolveMemorySourceMessageId") ||
  !settleRun.source.includes("resolveAgentChatInitiatingTurn") ||
  !settleRun.source.includes("messageRequiresContinuation") ||
  !settleRun.source.includes('initiating.triggerKind !== "USER_MESSAGE"') ||
  !settleRun.source.includes('initiating.triggerKind !== "REGENERATE"')
) {
  fail(
    toRepoPath(settleRunPath),
    "stable interactive turns must resolve their canonical user source through explicit run lineage, exclude non-user roots, and create one durable extraction outbox item keyed by source message",
  );
}

const turnLineagePath = path.join(
  srcRoot,
  "features/agent-chat/server/run/turn-lineage.ts",
);
const turnLineage = records.get(turnLineagePath);
if (
  !turnLineage?.source.includes("parentRunId") ||
  !turnLineage.source.includes('role: "user"') ||
  turnLineage.source.includes("precedingUser") ||
  turnLineage.source.includes("sequence: { lt:")
) {
  fail(
    toRepoPath(turnLineagePath),
    "continuations must resolve their initiating turn from explicit run-parent lineage rather than transcript proximity",
  );
}

const persistedMessagePath = path.join(
  srcRoot,
  "features/agent-chat/server/persisted-ui-message.ts",
);
const persistedMessage = records.get(persistedMessagePath);
if (
  !persistedMessage?.source.includes("validateAgentChatUIMessages") ||
  !persistedMessage.source.includes("validatePersistedAgentChatMessages") ||
  persistedMessage.source.includes("toUiRole")
) {
  fail(
    toRepoPath(persistedMessagePath),
    "persisted transcript rows must cross one UIMessage validation boundary without a legacy role mapper",
  );
}
for (const filePath of [historyPath, summaryPath]) {
  const record = records.get(filePath);
  if (
    !record?.source.includes("validatePersistedAgentChatMessages") ||
    record.source.includes("toUiRole")
  ) {
    fail(
      toRepoPath(filePath),
      "canonical transcript readers must use the shared persisted UIMessage validator",
    );
  }
}

const inboundMessagePath = path.join(
  srcRoot,
  "features/agent-chat/server/inbound-user-message.ts",
);
const inboundMessage = records.get(inboundMessagePath);
if (
  !inboundMessage?.source.includes("validateAgentChatUIMessages") ||
  !inboundMessage.source.includes('message.role !== "user"') ||
  !inboundMessage.source.includes('part.type === "file"') ||
  !inboundMessage.source.includes("isTextUIPart")
) {
  fail(
    toRepoPath(inboundMessagePath),
    "browser-authored messages must be AI-SDK-validated first and then canonicalized through the narrow user text/image policy",
  );
}
const sharedChatSchemasPath = path.join(
  srcRoot,
  "features/agent-chat/shared/schemas.ts",
);
const sharedChatSchemas = records.get(sharedChatSchemasPath);
if (
  !sharedChatSchemas?.source.includes("inboundUserMessageSchema") ||
  sharedChatSchemas.source.includes("textPartSchema") ||
  sharedChatSchemas.source.includes("filePartSchema")
) {
  fail(
    toRepoPath(sharedChatSchemasPath),
    "HTTP request envelopes must not maintain a second hand-written AI SDK text/file part schema",
  );
}
const memoryDefaultsPath = path.join(
  srcRoot,
  "features/agent-memory/shared/types.ts",
);
const memoryDefaults = records.get(memoryDefaultsPath);
if (
  !memoryDefaults?.source.includes("AGENT_MEMORY_MAX_PROMPT_CHARS") ||
  !memoryDefaults.source.includes("AGENT_MEMORY_MAX_LIVE_FACTS") ||
  !memoryDefaults.source.includes("AGENT_MEMORY_MAX_STORED_FACTS") ||
  !/requireApproval:\s*true/.test(memoryDefaults.source)
) {
  fail(
    toRepoPath(memoryDefaultsPath),
    "memory must separate live, retained-history, and prompt limits while keeping approval-safe defaults",
  );
}
const schemaSource = fs.readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
if (
  !schemaSource.includes("summaryThroughSequence") ||
  !schemaSource.includes("triggerMessageId") ||
  !schemaSource.includes("responseMessageId") ||
  !schemaSource.includes("SCHEDULE") ||
  !schemaSource.includes("sourceMessageId String") ||
  /sourceRunId\s+String\?\s+@unique/.test(schemaSource) ||
  !/pinned\s+Boolean\s+@default\(false\)/.test(schemaSource) ||
  !schemaSource.includes("enum AgentChatMessageRole {\n  user\n  assistant\n  system\n}") ||
  !schemaSource.includes("@@unique([agentDbId, appAccountId, contentHash])") ||
  !/requireApproval\s+Boolean\s+@default\(true\)/.test(schemaSource)
) {
  fail(
    "prisma/schema.prisma",
    "chat and memory schema must persist UIMessage-native transcript state, summary checkpoints, run lineage, account-scoped memory, and source-message-owned extraction",
  );
}
const publicSiteRoutesPath = path.join(srcRoot, "lib/public-site/routes.ts");
const publicSiteRoutes = records.get(publicSiteRoutesPath);
if (
  !publicSiteRoutes?.source.includes('launchAgent: appLoginUrl("/dashboard/agents/new")')
  || publicSiteRoutes.source.includes("appAbsoluteUrl(appLoginUrl(")
  || publicSiteRoutes.source.includes("https://app.agentranking.io/auth/login")
) {
  fail(
    toRepoPath(publicSiteRoutesPath),
    "same-application public CTAs must remain root-relative so localhost and preview hosts do not link to production",
  );
}
const packageJson = readJson(path.join(repoRoot, "package.json"));
if (!packageJson.scripts?.["verify:agent-memory"]) {
  fail(
    "package.json",
    "database-backed memory verification must be exposed as verify:agent-memory",
  );
}
if (failures.length > 0) {
  console.error("Client/server ownership verification failed:\n");
  for (const failure of failures.sort()) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Client/server ownership verification passed (${records.size} source modules).`);
