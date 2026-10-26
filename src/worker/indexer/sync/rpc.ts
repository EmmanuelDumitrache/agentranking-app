import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getChainByChainId, isErc8004IndexingEnabled } from "../chains.js";
import { logger } from "../logger.js";
import { classifyRpcError, type RpcErrorClass } from "../lib/rpc-error-classification.js";
import { classifyDatabaseError } from "../lib/database-errors.js";
import { parseData32, parseRpcQuantity } from "../lib/exact-protocol.js";
import { throwIfAborted } from "../lib/abort.js";
import { DistributedWeightedRateBudget } from "../resources/distributed-rate-budget.js";
import { currentJobRuntime, currentRetryBudget, RetryBudgetExceededError } from "../queue/retry-budget.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import { parseOptionalStrictUnsignedInteger, parseStrictUnsignedInteger } from "../lib/strict-integer.js";
import { createResourceProfile } from "../resources/resource-profile.js";
import { getOrCreateResourceScheduler, type ResourceScheduler } from "../resources/resource-scheduler.js";
import { evmRpcResourceKey } from "../resources/resource-key.js";
import { forEachWithConcurrency } from "@/lib/async-pool";
import {
  PUBLIC_EVM_RPC_PROVIDERS,
  publicRpcProviderDefinition,
  type PublicRpcProviderDefinition,
} from "./public-rpc-providers.js";
import {
  mainnet,
  base,
  polygon,
  bsc,
  gnosis,
  arbitrum,
  scroll,
  avalanche,
  optimism,
  celo,
  linea,
  soneium,
} from "viem/chains";
export type RpcDeferredReason =
  | "rpc_finality_quorum_unavailable"
  | "rpc_provider_lag"
  | "rpc_block_unavailable"
  | "rpc_archive_unavailable"
  | "rpc_rate_limited"
  | "rpc_retry_budget_exhausted"
  | "rpc_transport_unavailable"
  | "job_timeout";
export class RpcFinalityUnavailableError extends Error {
  readonly reason: RpcDeferredReason;
  constructor(reason: RpcDeferredReason, message: string) {
    super(message);
    this.name = "RpcFinalityUnavailableError";
    this.reason = reason;
  }
}
export function isJobTimeoutError(error: unknown): boolean {
  if (error == null) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "TimeoutError" ||
    /operation was aborted due to timeout|job deadline exceeded|job stalled without meaningful progress|timed? out|timeout/i.test(message);
}
export function rpcDeferredReason(error: unknown): RpcDeferredReason | null {
  if (error instanceof RpcFinalityUnavailableError) return error.reason;
  if (isJobTimeoutError(error)) return "job_timeout";
  if (error instanceof RetryBudgetExceededError) return "rpc_retry_budget_exhausted";
  if (classifyDatabaseError(error) !== "unknown") return null;
  switch (classifyRpcError(error)) {
    case "provider_lag": return "rpc_provider_lag";
    case "unknown_block": return "rpc_block_unavailable";
    case "pruned_history": return "rpc_archive_unavailable";
    case "rate_limit": return "rpc_rate_limited";
    case "transport_failure": return "rpc_transport_unavailable";
    case "method_not_found": return "rpc_transport_unavailable";
    case "method_restricted": return "rpc_transport_unavailable";
    case "provider_retired": return "rpc_transport_unavailable";
    default: return null;
  }
}
export function rpcDeferredDetail(error: unknown): string | undefined {
  if (!(error instanceof RetryBudgetExceededError)) return undefined;
  const snapshot = error.snapshot;
  return [
    error.dimension,
    `attempts=${snapshot.totalAttempts}`,
    `switches=${snapshot.providerSwitches}`,
    `elapsedMs=${snapshot.elapsedMs}`,
    `delayMs=${snapshot.cumulativeDelayMs}`,
    `rpcWeight=${snapshot.cumulativeRpcWeight}`,
  ].join(" ");
}
/** Keys here are the deployable EVM chains and their primary RPC environment variables. */
export const CHAIN_RPC_ENV: Record<number, string> = {
  1: "ETHEREUM_RPC_URL",
  8453: "BASE_RPC_URL",
  137: "POLYGON_RPC_URL",
  56: "BSC_RPC_URL",
  100: "GNOSIS_RPC_URL",
  42161: "ARBITRUM_RPC_URL",
  42220: "CELO_RPC_URL",
  534352: "SCROLL_RPC_URL",
  59144: "LINEA_RPC_URL",
  43114: "AVALANCHE_RPC_URL",
  10: "OPTIMISM_RPC_URL",
  5000: "MANTLE_RPC_URL",
  143: "MONAD_RPC_URL",
  167000: "TAIKO_RPC_URL",
  9745: "PLASMA_RPC_URL",
  4326: "MEGAETH_RPC_URL",
  2741: "ABSTRACT_RPC_URL",
  2046399126: "SKALE_EUROPA_RPC_URL",
  360: "SHAPE_RPC_URL",
  196: "X_LAYER_RPC_URL",
  2345: "GOAT_RPC_URL",
  1088: "METIS_RPC_URL",
  1187947933: "SKALE_BASE_RPC_URL",
  1868: "SONEIUM_RPC_URL",
  45056: "BILLIONS_RPC_URL",
  1776: "INJECTIVE_RPC_URL",
  4217: "TEMPO_RPC_URL",
  42: "LUKSO_RPC_URL",
  10088: "GATE_LAYER_RPC_URL",
  5042002: "ARC_RPC_URL",
};
const INFURA_KEY = process.env.INFURA_API_KEY ?? "";
const INFURA_KEY_2 = process.env.INFURA_API_KEY_2 ?? "";
const INFURA_KEY_3 = process.env.INFURA_API_KEY_3 ?? "";
const INFURA_KEY_4 = process.env.INFURA_API_KEY_4 ?? "";
const INFURA_KEY_5 = process.env.INFURA_API_KEY_5 ?? "";
const INFURA_KEY_6 = process.env.INFURA_API_KEY_6 ?? "";
const INFURA_KEY_7 = process.env.INFURA_API_KEY_7 ?? "";
const INFURA_KEY_8 = process.env.INFURA_API_KEY_8 ?? "";
const INFURA_KEYS = [
  INFURA_KEY,
  INFURA_KEY_2,
  INFURA_KEY_3,
  INFURA_KEY_4,
  INFURA_KEY_5,
  INFURA_KEY_6,
  INFURA_KEY_7,
  INFURA_KEY_8,
].filter(Boolean);
/** Prefer INFURA_PRIMARY_SWITCH_MINUTES when set (faster key cycling). Else INFURA_ROTATION_HOURS (default 6h). */
const INFURA_ROTATION_MS = (() => {
  const switchMins = Number.parseFloat(process.env.INFURA_PRIMARY_SWITCH_MINUTES ?? "");
  if (Number.isFinite(switchMins) && switchMins > 0) {
    return switchMins * 60 * 1000;
  }
  const hours = Number.parseFloat(process.env.INFURA_ROTATION_HOURS ?? "6");
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
})();
/** Chains that use Infura when INFURA_API_KEY is set (used for throttling). */
export const INFURA_CHAIN_IDS = new Set([1, 8453, 137, 56, 42161, 42220, 59144, 43114, 10, 5000]);
const FORCE_PUBLIC_RPC = process.env.FORCE_PUBLIC_RPC === "true";
function infuraUrl(network: string, key: string): string {
  return `https://${network}.infura.io/v3/${key}`;
}
const RPC_REPLICA_SALT = process.env.WORKER_REPLICA_ID?.trim() || hostname();
function rotatedIndex(label: string, count: number, epochMs: number): number {
  if (count <= 1) return 0;
  const epoch = Math.floor(Date.now() / epochMs);
  const digest = createHash("sha256").update(`${RPC_REPLICA_SALT}\0${label}\0${epoch}`).digest();
  return digest.readUInt32BE(0) % count;
}
function rotateStable<T>(values: readonly T[], label: string, epochMs: number): T[] {
  if (values.length <= 1) return [...values];
  const index = rotatedIndex(label, values.length, epochMs);
  return [...values.slice(index), ...values.slice(0, index)];
}
/** Solana mainnet JSON-RPC URLs (one per configured Infura key). Same key pool as EVM rotation. */
export function getInfuraSolanaRpcUrls(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of INFURA_KEYS) {
    const u = `https://solana-mainnet.infura.io/v3/${key}`.replace(/\/+$/, "");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return rotateStable(out, "solana-infura", INFURA_ROTATION_MS);
}
function splitRpcUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}
function configuredChainRpcUrls(chainId: number): string[] {
  const envKey = CHAIN_RPC_ENV[chainId];
  if (!envKey) return [];
  return [
    ...splitRpcUrls(process.env[envKey]),
    ...splitRpcUrls(process.env[`${envKey}S`]),
    ...splitRpcUrls(process.env[`EVM_RPC_URLS_${chainId}`]),
  ];
}
/** Infura network names per chain. */
const INFURA_NETWORKS: Readonly<Record<number, string>> = {
  1: "mainnet",
  8453: "base-mainnet",
  137: "polygon-mainnet",
  56: "bsc-mainnet",
  42161: "arbitrum-mainnet",
  42220: "celo-mainnet",
  59144: "linea-mainnet",
  43114: "avalanche-mainnet",
  10: "optimism-mainnet",
  5000: "mantle-mainnet",
};
function infuraRpcUrls(chainId: number): string[] {
  const network = INFURA_NETWORKS[chainId];
  if (!network) return [];
  return rotateStable(
    INFURA_KEYS.map((key) => infuraUrl(network, key)),
    `infura:${chainId}`,
    INFURA_ROTATION_MS,
  );
}
function publicRpcDefinitions(chainId: number): readonly PublicRpcProviderDefinition[] {
  if (!config.publicRpcProvidersEnabled) return [];
  const values = PUBLIC_EVM_RPC_PROVIDERS[chainId] ?? [];
  if (config.publicRpcMaxPerChain <= 0) return values;
  return values.slice(0, config.publicRpcMaxPerChain);
}
function primaryRpcForChain(chainId: number): string {
  const explicit = configuredChainRpcUrls(chainId);
  const infura = infuraRpcUrls(chainId);
  const publicUrls = publicRpcDefinitions(chainId).map((provider) => provider.url);
  const ordered = FORCE_PUBLIC_RPC
    ? [...publicUrls, ...explicit, ...infura]
    : [...explicit, ...infura, ...publicUrls];
  return ordered.find((value) => value.trim().length > 0) ?? "";
}
export const RPC_URLS: Record<number, string> = Object.fromEntries(
  Object.keys(CHAIN_RPC_ENV).map((rawChainId) => {
    const chainId = parseStrictUnsignedInteger(rawChainId, "configured chain id", { maximum: 2_147_483_647 });
    return [chainId, primaryRpcForChain(chainId)];
  }),
);
const rpcUrlsCache = new Map<number, string[]>();
/**
 * Returns the complete provider pool for a chain. Explicit operator URLs and Infura keys are
 * retained alongside the supplied public endpoints, rather than replacing one another.
 */
export function getRpcUrls(chainId: number): string[] {
  const cached = rpcUrlsCache.get(chainId);
  if (cached) return cached;
  const explicit = configuredChainRpcUrls(chainId);
  const infura = infuraRpcUrls(chainId);
  const publicUrls = publicRpcDefinitions(chainId).map((provider) => provider.url);
  const ordered = FORCE_PUBLIC_RPC
    ? [...publicUrls, ...explicit, ...infura]
    : [...explicit, ...infura, ...publicUrls];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ordered) {
    try {
      const normalized = normalizeRpcUrl(raw);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(raw);
    } catch {
      // Invalid operator or catalog URLs are ignored before a client is constructed.
    }
  }
  rpcUrlsCache.set(chainId, out);
  return out;
}
/** Parse optional SYNC_CHAIN_IDS env (e.g. "1,8453,56"). When set, only these chains are syncable. */
function getSyncChainIdsAllowList(): Set<number> | null {
  const raw = process.env.SYNC_CHAIN_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((token) => parseStrictUnsignedInteger(token.trim(), "SYNC_CHAIN_IDS entry", { maximum: 2_147_483_647 }));
  return ids.length > 0 ? new Set(ids) : null;
}
let syncableChainIdsCache: number[] | null = null;
export function getSyncableChainIds(): number[] {
  if (syncableChainIdsCache) return syncableChainIdsCache;
  const base = Object.keys(CHAIN_RPC_ENV)
    .map((value) => parseStrictUnsignedInteger(value, "configured chain id", { maximum: 2_147_483_647 }))
    .filter((id) => {
      const chain = getChainByChainId(id);
      return chain != null && isErc8004IndexingEnabled(chain) && getRpcUrls(id).length > 0;
    });
  const allowList = getSyncChainIdsAllowList();
  syncableChainIdsCache = allowList ? base.filter((id) => allowList.has(id)) : base;
  return syncableChainIdsCache;
}
export const chainMap: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  137: polygon,
  56: bsc,
  100: gnosis,
  42161: arbitrum,
  42220: celo,
  534352: scroll,
  59144: linea,
  43114: avalanche,
  10: optimism,
  5000: defineChain({ id: 5000, name: "Mantle", nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" }, rpcUrls: { default: { http: [RPC_URLS[5000] || "https://rpc.mantle.xyz"] } } }),
  143: defineChain({ id: 143, name: "Monad", nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" }, rpcUrls: { default: { http: [RPC_URLS[143] || "https://rpc.monad.xyz"] } } }),
  167000: defineChain({ id: 167000, name: "Taiko", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[167000] || "https://rpc.mainnet.taiko.xyz"] } } }),
  9745: defineChain({ id: 9745, name: "Plasma Mainnet Beta", nativeCurrency: { decimals: 18, name: "Plasma", symbol: "XPL" }, rpcUrls: { default: { http: [RPC_URLS[9745] || "https://rpc.plasma.to"] } }, blockExplorers: { default: { name: "PlasmaScan", url: "https://plasmascan.to" } } }),
  4326: defineChain({ id: 4326, name: "MegaETH", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[4326] || "https://mainnet.megaeth.com/rpc"] } } }),
  2741: defineChain({ id: 2741, name: "Abstract", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[2741] || "https://api.mainnet.abs.xyz"] } } }),
  2046399126: defineChain({ id: 2046399126, name: "Skale Europa", nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" }, rpcUrls: { default: { http: [RPC_URLS[2046399126] || "https://mainnet.skalenodes.com/v1/elated-tan-skat"] } } }),
  360: defineChain({ id: 360, name: "Shape", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[360] || "https://mainnet.shape.network"] } } }),
  196: defineChain({ id: 196, name: "X Layer", nativeCurrency: { decimals: 18, name: "OKB", symbol: "OKB" }, rpcUrls: { default: { http: [RPC_URLS[196] || "https://rpc.xlayer.tech"] } } }),
  2345: defineChain({ id: 2345, name: "GOAT Network", nativeCurrency: { decimals: 18, name: "Bitcoin", symbol: "BTC" }, rpcUrls: { default: { http: [RPC_URLS[2345] || "https://rpc.goat.network"] } } }),
  1088: defineChain({ id: 1088, name: "Metis", nativeCurrency: { decimals: 18, name: "Metis", symbol: "METIS" }, rpcUrls: { default: { http: [RPC_URLS[1088] || "https://andromeda.metis.io/?owner=1088"] } } }),
  1187947933: defineChain({
    id: 1187947933,
    name: "SKALE Base",
    nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" },
    rpcUrls: { default: { http: [RPC_URLS[1187947933] || "https://skale-base.skalenodes.com/v1/base"] } },
  }),
  1868: defineChain({
    ...soneium,
    rpcUrls: { default: { http: [RPC_URLS[1868] || "https://rpc.soneium.org"] } },
  }),
  45056: defineChain({ id: 45056, name: "Billions", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[45056] || "https://billions-rpc.eu-north-2.gateway.fm"] } } }),
  1776: defineChain({ id: 1776, name: "Injective", nativeCurrency: { decimals: 18, name: "Injective", symbol: "INJ" }, rpcUrls: { default: { http: [RPC_URLS[1776] || "https://sentry.evm-rpc.injective.network/"] } } }),
  4217: defineChain({ id: 4217, name: "Tempo", nativeCurrency: { decimals: 18, name: "USD", symbol: "USD" }, rpcUrls: { default: { http: [RPC_URLS[4217] || "https://rpc.mainnet.tempo.xyz"] } } }),
  42: defineChain({ id: 42, name: "LUKSO", nativeCurrency: { decimals: 18, name: "LYX", symbol: "LYX" }, rpcUrls: { default: { http: [RPC_URLS[42] || "https://rpc.mainnet.lukso.network"] } } }),
  10088: defineChain({ id: 10088, name: "Gate Layer Mainnet", nativeCurrency: { decimals: 18, name: "GT", symbol: "GT" }, rpcUrls: { default: { http: [RPC_URLS[10088] || "https://gatelayer-mainnet.gatenode.cc"] } } }),
  5042002: defineChain({
    id: 5042002,
    name: "Arc",
    nativeCurrency: { decimals: 18, name: "USD Coin", symbol: "USDC" },
    rpcUrls: { default: { http: [RPC_URLS[5042002] || "https://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
    testnet: true,
  }),
};
export { classifyRpcError };
export type { RpcErrorClass };
export type RpcPinnedContext = {
  blockNumber?: bigint;
  blockHash?: `0x${string}`;
  finality?: "latest" | "safe" | "finalized";
  signal?: AbortSignal;
  requiresArchive?: boolean;
  requiresLogs?: boolean;
  requiresCalls?: boolean;
};
type EndpointRuntime = {
  key: string;
  normalizedUrl: string;
  redactedUrl: string;
  credentialKey: string;
  credentialHash: string;
  configuredChainId: number;
  configurationGeneration: string;
  providerName: string;
  selectionWeight: number;
  staticMaxLogRange: number | null;
  client: PublicClient;
  scheduler: ResourceScheduler;
  verifiedChainId: boolean;
  hydratedState: boolean;
  disabledReason: string | null;
  cooldownUntil: number;
  failureCount: number;
  successCount: number;
  latencyEwmaMs: number | null;
  inFlight: number;
  selectionCount: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  lastProbeAt: number;
  latestHead: bigint | null;
  safeHead: bigint | null;
  finalizedHead: bigint | null;
  boundaryHashes: Map<string, string>;
  supportsSafeTag: boolean | null;
  supportsFinalizedTag: boolean | null;
  supportsEip1898: boolean | null;
  supportsRequireCanonical: boolean | null;
  supportsLogs: boolean | null;
  supportsCalls: boolean | null;
  archiveCapable: boolean | null;
  learnedLogRanges: Record<string, number>;
};
const endpointRuntimes = new Map<string, EndpointRuntime>();
const endpointRuntimeAliases = new Map<string, EndpointRuntime>();
const endpointRuntimeByClient = new WeakMap<PublicClient, EndpointRuntime>();
const rpcSchedulers = new Map<string, ResourceScheduler>();
const weightedBudgets = new Map<string, DistributedWeightedRateBudget>();
const requestBudgets = new Map<string, DistributedWeightedRateBudget>();
// Success health is advisory and reconstructed continuously. Failures plus
// explicit probes, finality snapshots, and learned limits persist immediately.
const ROUTINE_ENDPOINT_PERSIST_INTERVAL_MS = 30_000;
type EndpointPersistenceState = {
  lastSnapshotStartedAt: number;
  pending: Promise<void> | null;
  dirty: boolean;
};
const endpointPersistenceStates = new Map<string, EndpointPersistenceState>();
const endpointHydrationLoads = new Map<string, Promise<void>>();
const endpointVerificationLoads = new Map<string, Promise<void>>();
const boundaryHashLoads = new Map<string, Promise<string>>();
type CredentialHealth = {
  cooldownUntil: number;
  probeRequired: boolean;
  probeInFlight: Promise<void> | null;
  failureCount: number;
  disabledReason: string | null;
};
const credentialHealth = new Map<string, CredentialHealth>();
class RpcCredentialDisabledError extends Error {
  readonly status = 401;
  constructor(reason: string) {
    super(reason);
    this.name = "RpcCredentialDisabledError";
  }
}
class RpcCredentialCooldownError extends Error {
  readonly status = 429;
  constructor(until: number) {
    super(`RPC credential is cooling down until ${new Date(until).toISOString()}`);
    this.name = "RpcCredentialCooldownError";
  }
}
class RpcCredentialProbeRequiredError extends Error {
  readonly status = 429;
  constructor() {
    super("RPC credential requires a low-cost half-open probe");
    this.name = "RpcCredentialProbeRequiredError";
  }
}
function healthForCredential(key: string): CredentialHealth {
  const existing = credentialHealth.get(key);
  if (existing) return existing;
  const created: CredentialHealth = {
    cooldownUntil: 0,
    probeRequired: false,
    probeInFlight: null,
    failureCount: 0,
    disabledReason: null,
  };
  credentialHealth.set(key, created);
  return created;
}
function normalizeRpcUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString();
}
export function redactRpcUrl(raw: string): string {
  const url = new URL(raw);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/key|token|secret|auth|project/i.test(key)) url.searchParams.set(key, "[redacted]");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const providerPathSecret = /(?:infura\.io|alchemy\.com|ankr\.com)$/i.test(url.hostname);
  if (parts.length > 0 && (providerPathSecret || /^[A-Za-z0-9_-]{20,}$/.test(parts.at(-1) ?? ""))) {
    parts[parts.length - 1] = "[redacted]";
    url.pathname = `/${parts.join("/")}`;
  }
  if (url.hostname.endsWith(".quiknode.pro")) {
    const labels = url.hostname.split(".");
    labels[0] = "redacted";
    url.hostname = labels.join(".");
  }
  return url.toString();
}
export function redactRpcErrorText(value: string): string {
  let redacted = value;
  for (const runtime of endpointRuntimes.values()) {
    if (redacted.includes(runtime.normalizedUrl)) {
      redacted = redacted.split(runtime.normalizedUrl).join(runtime.redactedUrl);
    }
  }
  redacted = redacted
    .replace(/https?:\/\/[^\s"']+/g, (candidate) => {
      try { return redactRpcUrl(candidate); } catch { return "[redacted-rpc-url]"; }
    })
    .replace(/([?&](?:key|token|secret|auth|project)=)[^&\s]+/gi, "$1[redacted]");
  return redactSensitiveText(redacted);
}
function endpointConfigurationGeneration(chainId: number, normalizedUrl: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ chainId, normalizedUrl, timeout: config.rpcRequestTimeoutMs }))
    .digest("hex");
}
function endpointKey(chainId: number, normalizedUrl: string, generation: string): string {
  return createHash("sha256").update(`${chainId}\0${normalizedUrl}\0${generation}`).digest("hex");
}
function credentialKey(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const likelySecret = pathParts.at(-1) ?? "";
    if (parsed.hostname.includes("infura.io") && likelySecret) return `infura:${likelySecret}`;
    if (parsed.hostname.includes("alchemy.com") && likelySecret) return `alchemy:${likelySecret}`;
    if (parsed.hostname.endsWith(".quiknode.pro")) return `quicknode:${parsed.hostname.split(".")[0] ?? parsed.hostname}`;
    const sensitiveQuery = [...parsed.searchParams.entries()]
      .filter(([key]) => /key|token|secret|auth|project/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right));
    if (parsed.username || parsed.password || sensitiveQuery.length > 0) {
      return `credential:${parsed.origin}:${JSON.stringify({
        username: parsed.username,
        password: parsed.password,
        query: sensitiveQuery,
      })}`;
    }
    return `origin:${parsed.origin}`;
  } catch {
    return `url:${url}`;
  }
}
function rpcSchedulerForUrl(url: string): ResourceScheduler {
  const normalized = normalizeRpcUrl(url);
  const physicalKey = credentialKey(normalized);
  const existing = rpcSchedulers.get(physicalKey);
  if (existing) return existing;
  const isInfura = normalized.includes("infura.io");
  const interval = isInfura ? config.infuraRpcIntervalMs : config.publicRpcIntervalMs;
  const resourceKey = evmRpcResourceKey(physicalKey);
  const scheduler = getOrCreateResourceScheduler(
    resourceKey,
    createResourceProfile({
      minCapacity: config.rpcAdaptiveMinInflight,
      maxCapacity: config.evmRpcDefaultMaxInflight,
      successWindow: config.rpcAimdSuccessWindow,
      decreaseFactor: config.rpcAimdDecreaseFactor,
      leaseTtlMs: config.resourceLeaseTtlMs,
      leaseHeartbeatMs: config.resourceLeaseHeartbeatMs,
      leaseAcquirePollMs: config.resourceLeaseAcquirePollMs,
    }),
  );
  rpcSchedulers.set(physicalKey, scheduler);
  weightedBudgets.set(physicalKey, new DistributedWeightedRateBudget({
    resourceKey,
    dimension: "weighted-cost",
    capacity: config.rpcWeightedIntervalCap,
    intervalMs: Math.max(1, interval),
  }));
  const intervalCap = isInfura ? config.infuraRpcIntervalCap : config.publicRpcIntervalCap;
  if (intervalCap > 0) {
    requestBudgets.set(physicalKey, new DistributedWeightedRateBudget({
      resourceKey,
      dimension: "requests",
      capacity: intervalCap,
      intervalMs: Math.max(1, interval),
    }));
  }
  return scheduler;
}
function retryableRpcClass(value: RpcErrorClass): boolean {
  return value === "rate_limit" || value === "transport_failure" || value === "provider_lag" || value === "unknown_block" || value === "unsupported_tag" || value === "method_not_found" || value === "method_restricted" || value === "pruned_history" || value === "authentication" || value === "provider_retired";
}
function cooldownDuration(failureCount: number, classification: RpcErrorClass): number {
  const base = classification === "rate_limit" ? 5_000 : 1_000;
  const deterministic = Math.min(5 * 60_000, base * 2 ** Math.min(8, Math.max(0, failureCount - 1)));
  return Math.max(250, Math.round(deterministic * (0.8 + Math.random() * 0.4)));
}
function isCredentialProbeMethod(method: string): boolean {
  return method === "eth_chainId" || method === "eth_blockNumber";
}
function rpcMethodWeight(method: string, params: unknown): number {
  if (method === "eth_chainId" || method === "eth_blockNumber" || method === "net_version") return 1;
  if (method === "eth_getLogs") {
    const filter = Array.isArray(params) && params[0] && typeof params[0] === "object" ? params[0] as Record<string, unknown> : {};
    const from = typeof filter.fromBlock === "string" && /^0x[0-9a-f]+$/i.test(filter.fromBlock) ? BigInt(filter.fromBlock) : null;
    const to = typeof filter.toBlock === "string" && /^0x[0-9a-f]+$/i.test(filter.toBlock) ? BigInt(filter.toBlock) : null;
    const span = from != null && to != null && to >= from ? to - from + 1n : 1n;
    return Math.min(32, 2 + Number((span + 1_999n) / 2_000n));
  }
  if (method === "eth_call") {
    const call = Array.isArray(params) && params[0] && typeof params[0] === "object" ? params[0] as Record<string, unknown> : {};
    const data = typeof call.data === "string" ? call.data : "0x";
    const bytes = Math.max(0, Math.floor((data.length - 2) / 2));
    return Math.min(16, Math.max(1, 1 + Math.ceil(bytes / 4_096)));
  }
  if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash" || method === "eth_getTransactionReceipt") return 2;
  return 1;
}
function makeRateLimitedTransport(chainId: number, url: string, scheduler: ResourceScheduler): ReturnType<typeof http> {
  const transport = http(url, { timeout: config.rpcRequestTimeoutMs, retryCount: 0 });
  const budgetKey = credentialKey(normalizeRpcUrl(url));
  const weightedBudget = weightedBudgets.get(budgetKey)!;
  const requestBudget = requestBudgets.get(budgetKey);
  return (parameters) => {
    const base = transport(parameters);
    return {
      ...base,
      async request(args: Parameters<typeof base.request>[0]): Promise<unknown> {
        const runtimeContext = currentJobRuntime();
        const signal = runtimeContext?.signal;
        throwIfAborted(signal);
        const method = String(args.method);
        const credential = healthForCredential(budgetKey);
        const now = Date.now();
        if (credential.disabledReason) throw new RpcCredentialDisabledError(credential.disabledReason);
        if (credential.cooldownUntil > now) throw new RpcCredentialCooldownError(credential.cooldownUntil);
        if (credential.probeRequired && !isCredentialProbeMethod(method)) throw new RpcCredentialProbeRequiredError();
        const weight = rpcMethodWeight(method, args.params);
        await requestBudget?.acquire(1, signal);
        await weightedBudget.acquire(weight, signal);
        try {
          const result = await scheduler.run(
            async () => base.request(args),
            {
              priority: runtimeContext?.rpcPriority ?? 0,
              signal,
              classifyFailure(error) {
                const classification = classifyRpcError(error);
                if (classification === "rate_limit") return { kind: "rate_limit" };
                if (classification === "transport_failure" || classification === "provider_lag" || classification === "unknown_block") {
                  return { kind: "transient" };
                }
                return { kind: "fatal" };
              },
            },
          );
          runtimeContext?.touchProgress?.();
          return result;
        } catch (error) {
          currentRetryBudget()?.consumeRpcWeight(weight);
          throw error;
        }
      },
    } as typeof base;
  };
}
function endpointDefinition(chainId: number, normalizedUrl: string): PublicRpcProviderDefinition {
  const supplied = publicRpcProviderDefinition(chainId, normalizedUrl);
  if (supplied) return supplied;
  const explicit = configuredChainRpcUrls(chainId).some((value) => {
    try { return normalizeRpcUrl(value) === normalizedUrl; } catch { return false; }
  });
  if (explicit) return { url: normalizedUrl, provider: "operator-configured", weight: 8 };
  if (normalizedUrl.includes("infura.io")) return { url: normalizedUrl, provider: "Infura", weight: 6 };
  try { return { url: normalizedUrl, provider: new URL(normalizedUrl).hostname, weight: 4 }; }
  catch { return { url: normalizedUrl, provider: "unknown", weight: 1 }; }
}
function updateEndpointLatency(runtime: EndpointRuntime, elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const alpha = 0.2;
  runtime.latencyEwmaMs = runtime.latencyEwmaMs == null
    ? elapsedMs
    : runtime.latencyEwmaMs * (1 - alpha) + elapsedMs * alpha;
}
function markEndpointSuccess(runtime: EndpointRuntime, elapsedMs: number): void {
  updateEndpointLatency(runtime, elapsedMs);
  runtime.successCount += 1;
  runtime.failureCount = 0;
  runtime.lastSuccessAt = Date.now();
  runtime.cooldownUntil = 0;
}
function markEndpointFailure(runtime: EndpointRuntime, elapsedMs: number): void {
  updateEndpointLatency(runtime, elapsedMs);
  runtime.failureCount += 1;
  runtime.lastFailureAt = Date.now();
}
function createEndpointRuntime(chainId: number, rawUrl: string): EndpointRuntime {
  const aliasKey = `${chainId}\0${rawUrl}`;
  const aliased = endpointRuntimeAliases.get(aliasKey);
  if (aliased) return aliased;
  const normalizedUrl = normalizeRpcUrl(rawUrl);
  const configurationGeneration = endpointConfigurationGeneration(chainId, normalizedUrl);
  const key = endpointKey(chainId, normalizedUrl, configurationGeneration);
  const existing = endpointRuntimes.get(key);
  if (existing) {
    endpointRuntimeAliases.set(aliasKey, existing);
    return existing;
  }
  const chain = chainMap[chainId];
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  const definition = endpointDefinition(chainId, normalizedUrl);
  const runtimeCredentialKey = credentialKey(normalizedUrl);
  const scheduler = rpcSchedulerForUrl(normalizedUrl);
  const client = createPublicClient({ chain, transport: makeRateLimitedTransport(chainId, normalizedUrl, scheduler) });
  const runtime: EndpointRuntime = {
    key,
    normalizedUrl,
    redactedUrl: redactRpcUrl(normalizedUrl),
    credentialKey: runtimeCredentialKey,
    credentialHash: createHash("sha256").update(runtimeCredentialKey).digest("hex"),
    configuredChainId: chainId,
    configurationGeneration,
    providerName: definition.provider,
    selectionWeight: Math.max(1, definition.weight),
    staticMaxLogRange: definition.maxLogRange ?? null,
    client,
    scheduler,
    verifiedChainId: false,
    hydratedState: false,
    disabledReason: null,
    cooldownUntil: 0,
    failureCount: 0,
    successCount: 0,
    latencyEwmaMs: null,
    inFlight: 0,
    selectionCount: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    lastProbeAt: 0,
    latestHead: null,
    safeHead: null,
    finalizedHead: null,
    boundaryHashes: new Map(),
    supportsSafeTag: null,
    supportsFinalizedTag: null,
    supportsEip1898: null,
    supportsRequireCanonical: null,
    supportsLogs: definition.supportsLogs ?? null,
    supportsCalls: definition.supportsCalls ?? null,
    archiveCapable: definition.archiveCapable ?? null,
    learnedLogRanges: Object.create(null) as Record<string, number>,
  };
  endpointRuntimes.set(key, runtime);
  endpointRuntimeAliases.set(aliasKey, runtime);
  endpointRuntimeAliases.set(`${chainId}\0${normalizedUrl}`, runtime);
  endpointRuntimeByClient.set(client, runtime);
  return runtime;
}
async function writeEndpointSnapshot(runtime: EndpointRuntime): Promise<void> {
  const credential = healthForCredential(runtime.credentialKey);
  const capabilities = {
    learnedLogRanges: runtime.learnedLogRanges,
  };
  const mutableSnapshot = {
    observedNetwork: runtime.verifiedChainId ? String(runtime.configuredChainId) : null,
    latestHead: runtime.latestHead,
    safeHead: runtime.safeHead,
    finalizedHead: runtime.finalizedHead,
    capabilities,
    safeTag: runtime.supportsSafeTag,
    finalizedTag: runtime.supportsFinalizedTag,
    eip1898: runtime.supportsEip1898,
    requireCanonical: runtime.supportsRequireCanonical,
    supportsLogs: runtime.supportsLogs,
    supportsCalls: runtime.supportsCalls,
    archiveCapable: runtime.archiveCapable,
    providerName: runtime.providerName,
    selectionWeight: runtime.selectionWeight,
    staticMaxLogRange: runtime.staticMaxLogRange,
    healthSuccessCount: runtime.successCount,
    healthFailureCount: runtime.failureCount,
    healthLatencyEwmaMs: runtime.latencyEwmaMs,
    healthCooldownUntil: runtime.cooldownUntil != null && runtime.cooldownUntil > 0 ? new Date(runtime.cooldownUntil) : null,
    healthLastSuccessAt: runtime.lastSuccessAt != null && runtime.lastSuccessAt > 0 ? new Date(runtime.lastSuccessAt) : null,
    healthLastFailureAt: runtime.lastFailureAt != null && runtime.lastFailureAt > 0 ? new Date(runtime.lastFailureAt) : null,
    healthLastProbeAt: runtime.lastProbeAt != null && runtime.lastProbeAt > 0 ? new Date(runtime.lastProbeAt) : null,
    disabledReason: runtime.disabledReason,
    credentialKeyHash: runtime.credentialHash,
    credentialDisabledReason: credential.disabledReason,
    credentialCooldownUntil: credential.cooldownUntil > 0 ? new Date(credential.cooldownUntil) : null,
    credentialFailureCount: credential.failureCount,
    verifiedAt: runtime.verifiedChainId ? new Date() : null,
  };
  await prisma.indexerEndpointState.upsert({
    where: { endpointKey: runtime.key },
    create: {
      endpointKey: runtime.key,
      protocol: "evm-json-rpc",
      endpointUrl: runtime.redactedUrl,
      configuredNetwork: String(runtime.configuredChainId),
      configurationGeneration: runtime.configurationGeneration,
      ...mutableSnapshot,
    },
    update: mutableSnapshot,
  });
}
async function persistEndpoint(
  runtime: EndpointRuntime,
  options: { routine?: boolean } = {},
): Promise<void> {
  let state = endpointPersistenceStates.get(runtime.key);
  if (!state) {
    state = { lastSnapshotStartedAt: 0, pending: null, dirty: false };
    endpointPersistenceStates.set(runtime.key, state);
  }
  const snapshotStartedAt = Date.now();
  if (
    options.routine &&
    snapshotStartedAt - state.lastSnapshotStartedAt < ROUTINE_ENDPOINT_PERSIST_INTERVAL_MS
  ) {
    return;
  }
  // An immediate probe/failure snapshot also satisfies the next routine health
  // checkpoint and avoids a duplicate write when a wrapped RPC returns.
  state.lastSnapshotStartedAt = snapshotStartedAt;

  if (state.pending) {
    // Every caller mutates the shared runtime before reaching persistence. One
    // trailing snapshot captures all concurrent mutations without N serialized
    // upserts during a provider incident.
    state.dirty = true;
    await state.pending;
    return;
  }

  const operation = (async () => {
    do {
      state.dirty = false;
      await writeEndpointSnapshot(runtime);
    } while (state.dirty);
  })();
  state.pending = operation;
  try {
    await operation;
  } catch (error) {
    // Every request coalesced into this drain failed with the same operation.
    // Permit the next routine observation to retry immediately.
    state.lastSnapshotStartedAt = 0;
    throw error;
  } finally {
    if (state.pending === operation) state.pending = null;
  }
}
async function loadEndpointState(runtime: EndpointRuntime): Promise<void> {
  if (runtime.hydratedState) return;
  const credentialHash = runtime.credentialHash;
  const [stored, storedCredential] = await Promise.all([
    prisma.indexerEndpointState.findUnique({ where: { endpointKey: runtime.key } }),
    prisma.indexerEndpointState.findFirst({
      where: { protocol: "evm-json-rpc", credentialKeyHash: credentialHash },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const credential = healthForCredential(runtime.credentialKey);
  if (storedCredential) {
    credential.disabledReason = storedCredential.credentialDisabledReason;
    credential.failureCount = storedCredential.credentialFailureCount;
    credential.cooldownUntil = storedCredential.credentialCooldownUntil?.getTime() ?? 0;
    credential.probeRequired = credential.cooldownUntil > 0 || credential.failureCount > 0;
  }
  if (!stored) {
    runtime.hydratedState = true;
    return;
  }
  runtime.disabledReason = stored.disabledReason;
  runtime.verifiedChainId = stored.observedNetwork === String(runtime.configuredChainId);
  runtime.latestHead = stored.latestHead;
  runtime.safeHead = stored.safeHead;
  runtime.finalizedHead = stored.finalizedHead;
  if (stored.safeTag != null) runtime.supportsSafeTag = stored.safeTag;
  if (stored.finalizedTag != null) runtime.supportsFinalizedTag = stored.finalizedTag;
  if (stored.eip1898 != null) runtime.supportsEip1898 = stored.eip1898;
  if (stored.requireCanonical != null) runtime.supportsRequireCanonical = stored.requireCanonical;
  if (runtime.supportsLogs == null && stored.supportsLogs != null) runtime.supportsLogs = stored.supportsLogs;
  if (runtime.supportsCalls == null && stored.supportsCalls != null) runtime.supportsCalls = stored.supportsCalls;
  if (runtime.archiveCapable == null && stored.archiveCapable != null) runtime.archiveCapable = stored.archiveCapable;
  if (stored.healthSuccessCount != null && stored.healthSuccessCount >= 0) runtime.successCount = stored.healthSuccessCount;
  if (stored.healthFailureCount != null && stored.healthFailureCount >= 0) runtime.failureCount = stored.healthFailureCount;
  if (stored.healthLatencyEwmaMs != null && stored.healthLatencyEwmaMs >= 0) runtime.latencyEwmaMs = stored.healthLatencyEwmaMs;
  if (stored.healthCooldownUntil != null && stored.healthCooldownUntil.getTime() > Date.now()) runtime.cooldownUntil = stored.healthCooldownUntil.getTime();
  if (stored.healthLastSuccessAt != null && stored.healthLastSuccessAt.getTime() >= 0) runtime.lastSuccessAt = stored.healthLastSuccessAt.getTime();
  if (stored.healthLastFailureAt != null && stored.healthLastFailureAt.getTime() >= 0) runtime.lastFailureAt = stored.healthLastFailureAt.getTime();
  if (stored.healthLastProbeAt != null && stored.healthLastProbeAt.getTime() >= 0) runtime.lastProbeAt = stored.healthLastProbeAt.getTime();
  const caps = stored.capabilities && typeof stored.capabilities === "object" && !Array.isArray(stored.capabilities)
    ? stored.capabilities as Record<string, unknown>
    : {};
  if (caps.learnedLogRanges && typeof caps.learnedLogRanges === "object" && !Array.isArray(caps.learnedLogRanges)) {
    for (const [domain, value] of Object.entries(caps.learnedLogRanges as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) runtime.learnedLogRanges[domain] = value;
    }
  }
  runtime.hydratedState = true;
}
async function hydrateEndpointState(runtime: EndpointRuntime): Promise<void> {
  if (runtime.hydratedState) return;
  const existing = endpointHydrationLoads.get(runtime.key);
  if (existing) return existing;
  const pending = loadEndpointState(runtime).finally(() => {
    if (endpointHydrationLoads.get(runtime.key) === pending) {
      endpointHydrationLoads.delete(runtime.key);
    }
  });
  endpointHydrationLoads.set(runtime.key, pending);
  return pending;
}
async function verifyEndpointUncoalesced(runtime: EndpointRuntime): Promise<void> {
  await hydrateEndpointState(runtime);
  if (runtime.disabledReason) throw new Error(runtime.disabledReason);
  if (runtime.verifiedChainId) return;
  const raw = await runtime.client.request({ method: "eth_chainId" });
  const observed = parseRpcQuantity(raw, "eth_chainId");
  if (observed !== BigInt(runtime.configuredChainId)) {
    runtime.disabledReason = `RPC chain id mismatch: configured ${runtime.configuredChainId}, observed ${observed}`;
    await persistEndpoint(runtime);
    throw new Error(runtime.disabledReason);
  }
  runtime.verifiedChainId = true;
  await persistEndpoint(runtime);
}
async function verifyEndpoint(runtime: EndpointRuntime): Promise<void> {
  if (runtime.verifiedChainId) return;
  const existing = endpointVerificationLoads.get(runtime.key);
  if (existing) return existing;
  const pending = verifyEndpointUncoalesced(runtime).finally(() => {
    if (endpointVerificationLoads.get(runtime.key) === pending) {
      endpointVerificationLoads.delete(runtime.key);
    }
  });
  endpointVerificationLoads.set(runtime.key, pending);
  return pending;
}
async function blockHashAt(runtime: EndpointRuntime, blockNumber: bigint): Promise<string> {
  const key = blockNumber.toString(10);
  const cached = runtime.boundaryHashes.get(key);
  if (cached) return cached;
  const loadKey = `${runtime.key}\u0000${key}`;
  const existing = boundaryHashLoads.get(loadKey);
  if (existing) return existing;
  const pending = (async () => {
    const block = await runtime.client.getBlock({ blockNumber, includeTransactions: false });
    if (!block.hash) throw new Error(`RPC block ${blockNumber} has no hash`);
    const hash = parseData32(block.hash, "block hash");
    runtime.boundaryHashes.set(key, hash);
    if (runtime.boundaryHashes.size > 256) {
      runtime.boundaryHashes.delete(runtime.boundaryHashes.keys().next().value as string);
    }
    return hash;
  })().finally(() => {
    if (boundaryHashLoads.get(loadKey) === pending) boundaryHashLoads.delete(loadKey);
  });
  boundaryHashLoads.set(loadKey, pending);
  return pending;
}
async function ensureCredentialRecovered(runtime: EndpointRuntime, signal?: AbortSignal): Promise<boolean> {
  await hydrateEndpointState(runtime);
  const key = runtime.credentialKey;
  const health = healthForCredential(key);
  if (health.disabledReason) throw new RpcCredentialDisabledError(health.disabledReason);
  const now = Date.now();
  if (health.cooldownUntil > now) return false;
  if (!health.probeRequired) return true;
  if (!health.probeInFlight) {
    health.probeInFlight = (async () => {
      throwIfAborted(signal);
      const raw = await runtime.client.request({ method: "eth_chainId" });
      const observed = parseRpcQuantity(raw, "eth_chainId");
      if (observed !== BigInt(runtime.configuredChainId)) {
        throw new Error(`RPC chain id mismatch: configured ${runtime.configuredChainId}, observed ${observed}`);
      }
      health.cooldownUntil = 0;
      health.probeRequired = false;
      health.failureCount = 0;
      await persistEndpoint(runtime);
    })().finally(() => { health.probeInFlight = null; });
  }
  await health.probeInFlight;
  return true;
}
async function endpointEligibleForContext(runtime: EndpointRuntime, context?: RpcPinnedContext): Promise<boolean> {
  throwIfAborted(context?.signal);
  if (!(await ensureCredentialRecovered(runtime, context?.signal))) return false;
  await verifyEndpoint(runtime);
  throwIfAborted(context?.signal);
  if (!context) return true;
  if (context.requiresLogs && runtime.supportsLogs === false) return false;
  if (context.requiresCalls && runtime.supportsCalls === false) return false;
  if (context.requiresArchive && runtime.archiveCapable === false) return false;
  if (context.blockNumber != null) {
    const head = runtime.latestHead != null && runtime.latestHead >= context.blockNumber
      ? runtime.latestHead
      : await runtime.client.getBlockNumber();
    if (runtime.latestHead == null || head > runtime.latestHead) runtime.latestHead = head;
    if (head < context.blockNumber) return false;
    const observedHash = await blockHashAt(runtime, context.blockNumber);
    if (context.blockHash && observedHash.toLowerCase() !== context.blockHash.toLowerCase()) return false;
  }
  return true;
}
const chainSelectionCounters = new Map<number, number>();
function endpointSelectionScore(runtime: EndpointRuntime): number {
  const fairness = (runtime.selectionCount / Math.max(1, runtime.selectionWeight)) * 1_000;
  const latency = runtime.latencyEwmaMs ?? 750;
  const inFlight = runtime.inFlight * 5_000;
  const failures = runtime.failureCount * 10_000;
  const unverified = runtime.verifiedChainId ? 0 : 250;
  const quality = Math.max(0, 8 - runtime.selectionWeight) * 200;
  return fairness + latency + inFlight + failures + unverified + quality;
}
function orderedRpcRuntimes(chainId: number, urls = getRpcUrls(chainId)): EndpointRuntime[] {
  if (urls.length === 0) return [];
  const counter = chainSelectionCounters.get(chainId) ?? 0;
  chainSelectionCounters.set(chainId, counter + 1);
  const offset = counter % urls.length;
  const runtimes: EndpointRuntime[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    runtimes.push(createEndpointRuntime(chainId, urls[(offset + index) % urls.length]!));
  }
  // Modern ECMAScript specifies stable Array sorting, so the rotated insertion
  // order remains the deterministic tie-breaker without decorating every RPC
  // candidate with another temporary object.
  runtimes.sort((left, right) => endpointSelectionScore(left) - endpointSelectionScore(right));
  return runtimes;
}
export function rotateRpcUrlsForAttempt(urls: string[], chainId: number): string[] {
  return orderedRpcRuntimes(chainId, urls).map((runtime) => runtime.normalizedUrl);
}
/** Cached public client for one chain-specific endpoint. */
export function createClientForUrl(chainId: number, url: string): PublicClient {
  return createEndpointRuntime(chainId, url).client;
}
const DEFAULT_CONFIRMATION_DEPTHS: Readonly<Record<number, number>> = {
  // SKALE sChains have deterministic instant finality but their JSON-RPC nodes do not
  // consistently implement the standardized safe/finalized block tags. Retain one
  // committed block of headroom so the cursor never targets a concurrently published tip.
  1187947933: 1,
  2046399126: 1,
  // Older Polygon RPC gateways may reject the safe/finalized tags. A checkpoint-sized
  // fallback is deliberately conservative; modern gateways continue to use the tag.
  137: 256,
};
const confirmationDepthCache = new Map<number, bigint>();
function configuredConfirmationDepth(chainId: number): bigint {
  const cached = confirmationDepthCache.get(chainId);
  if (cached != null) return cached;
  const specific = process.env[`EVM_FINALITY_CONFIRMATIONS_${chainId}`];
  const fallback = process.env.EVM_FINALITY_CONFIRMATIONS;
  const raw = specific ?? fallback;
  const depth = raw
    ? BigInt(parseStrictUnsignedInteger(raw, `EVM finality confirmation depth for chain ${chainId}`, { maximum: 10_000_000 }))
    : BigInt(DEFAULT_CONFIRMATION_DEPTHS[chainId] ?? 64);
  confirmationDepthCache.set(chainId, depth);
  return depth;
}
async function verifyFinalizedBoundaryQuorum(
  chainId: number,
  blockNumber: bigint,
  expectedHash: `0x${string}`,
  sourceEndpointKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const runtimes = orderedRpcRuntimes(chainId)
    .filter((runtime) => runtime.key !== sourceEndpointKey)
    .slice(0, Math.max(0, config.rpcFinalityMaxProviders - 1));
  const configured = parseOptionalStrictUnsignedInteger(process.env.EVM_FINALITY_QUORUM, "EVM_FINALITY_QUORUM", 0, { allowZero: true, maximum: 1024 });
  const totalPotentialVotes = runtimes.length + 1;
  const required = configured > 0 ? Math.min(configured, totalPotentialVotes) : 1;
  // The endpoint that produced the finalized block object is already one valid vote.
  // Query the bounded independent-provider set concurrently so finality verification does not
  // serialize five network round trips on every indexed range.
  let agreed = 1;
  const votes = await Promise.all(runtimes.map(async (runtime): Promise<{ endpoint: string; observedHash: string } | null> => {
    throwIfAborted(signal);
    const credential = healthForCredential(runtime.credentialKey);
    const now = Date.now();
    if (runtime.disabledReason || runtime.cooldownUntil > now || credential.cooldownUntil > now) return null;
    runtime.selectionCount += 1;
    runtime.inFlight += 1;
    const startedAt = performance.now();
    try {
      if (!(await ensureCredentialRecovered(runtime, signal))) return null;
      await verifyEndpoint(runtime);
      const head = await runtime.client.getBlockNumber();
      runtime.latestHead = head;
      if (head < blockNumber) return null;
      const observedHash = await blockHashAt(runtime, blockNumber);
      markEndpointSuccess(runtime, performance.now() - startedAt);
      await persistEndpoint(runtime, { routine: true });
      if (observedHash.toLowerCase() === expectedHash.toLowerCase()) {
        agreed += 1;
        return null;
      }
      return { endpoint: runtime.redactedUrl, observedHash };
    } catch (error) {
      const classification = classifyRpcError(error);
      markEndpointFailure(runtime, performance.now() - startedAt);
      if (classification === "chain_mismatch" || classification === "authentication" || classification === "provider_retired") {
        const reason = classification === "authentication"
          ? `RPC credential authentication or subscription failure for ${runtime.redactedUrl}`
          : (error instanceof Error ? error.message : String(error));
        runtime.disabledReason = reason;
        if (classification === "authentication") credential.disabledReason = reason;
      } else if (retryableRpcClass(classification)) {
        runtime.cooldownUntil = Date.now() + cooldownDuration(runtime.failureCount, classification);
      }
      await persistEndpoint(runtime);
      // Lagging, cooling, unavailable, and incompatible endpoints do not vote. A returned
      // conflicting hash is represented above and remains a hard consistency failure.
      return null;
    } finally {
      runtime.inFlight = Math.max(0, runtime.inFlight - 1);
    }
  }));
  const disagreements = votes.filter((vote): vote is { endpoint: string; observedHash: string } => vote != null);
  if (disagreements.length > 0) {
    throw new Error(`RPC providers disagree on finalized block ${blockNumber}: ${JSON.stringify(disagreements)}`);
  }
  if (agreed < required) {
    throw new RpcFinalityUnavailableError(
      "rpc_finality_quorum_unavailable",
      `Finalized boundary ${blockNumber} lacks RPC quorum: ${agreed}/${required} providers agreed`,
    );
  }
}
export async function getRpcFinalitySnapshot(chainId: number, signal?: AbortSignal): Promise<{
  latest: bigint;
  safe: bigint;
  finalized: bigint;
  finalizedHash: `0x${string}`;
  policy: string;
}> {
  throwIfAborted(signal);
  return withRpcFallback(chainId, async (client, endpoint) => {
    throwIfAborted(signal);
    const runtime = endpointRuntimeByClient.get(client);
    const latest = await client.getBlockNumber();
    let safe: bigint;
    let finalized: bigint;
    let finalizedHash: `0x${string}` | null = null;
    let policy = "rpc-finalized";
    let safeTagUnavailable = runtime?.supportsSafeTag === false;
    if (safeTagUnavailable) {
      safe = latest;
    } else {
      try {
        safe = (await client.getBlock({ blockTag: "safe", includeTransactions: false })).number ?? latest;
        if (runtime) runtime.supportsSafeTag = true;
      } catch (error) {
        const classification = classifyRpcError(error);
        if (classification !== "unsupported_tag") throw error;
        if (runtime) runtime.supportsSafeTag = false;
        safeTagUnavailable = true;
        safe = latest;
      }
    }
    if (runtime?.supportsFinalizedTag === false) {
      const confirmations = configuredConfirmationDepth(chainId);
      finalized = latest > confirmations ? latest - confirmations : 0n;
      policy = `confirmation-depth:${confirmations}`;
    } else {
      try {
        const finalizedBlock = await client.getBlock({ blockTag: "finalized", includeTransactions: false });
        if (finalizedBlock.number == null) throw new Error("finalized block response is missing its block number");
        finalized = finalizedBlock.number;
        if (!finalizedBlock.hash) throw new Error(`finalized block ${finalized} is missing its hash`);
        finalizedHash = parseData32(finalizedBlock.hash, "finalized block hash");
        if (runtime) runtime.supportsFinalizedTag = true;
      } catch (error) {
        const classification = classifyRpcError(error);
        if (classification !== "unsupported_tag") throw error;
        if (runtime) runtime.supportsFinalizedTag = false;
        const confirmations = configuredConfirmationDepth(chainId);
        finalized = latest > confirmations ? latest - confirmations : 0n;
        policy = `confirmation-depth:${confirmations}`;
      }
    }
    if (safeTagUnavailable || safe > finalized) safe = finalized;
    if (finalizedHash == null) {
      const block = await client.getBlock({ blockNumber: finalized, includeTransactions: false });
      if (!block.hash) throw new Error(`finalized block ${finalized} is missing its hash`);
      finalizedHash = parseData32(block.hash, "finalized block hash");
    }
    if (runtime) {
      runtime.latestHead = latest;
      runtime.safeHead = safe;
      runtime.finalizedHead = finalized;
      try {
        await client.request({
          method: "eth_getCode",
          params: ["0x0000000000000000000000000000000000000000", { blockHash: finalizedHash, requireCanonical: true }],
        } as never);
        runtime.supportsEip1898 = true;
        runtime.supportsRequireCanonical = true;
      } catch (error) {
        if (classifyRpcError(error) === "invalid_parameter" || classifyRpcError(error) === "unsupported_tag") {
          runtime.supportsEip1898 = false;
          runtime.supportsRequireCanonical = false;
        }
      }
      await persistEndpoint(runtime);
    }
    return { latest, safe, finalized, finalizedHash, policy, sourceEndpointKey: endpoint.endpointKey };
  }, { signal }).then(async (snapshot) => {
    await verifyFinalizedBoundaryQuorum(chainId, snapshot.finalized, snapshot.finalizedHash, snapshot.sourceEndpointKey, signal);
    const { sourceEndpointKey: _sourceEndpointKey, ...publicSnapshot } = snapshot;
    return publicSnapshot;
  });
}
const RPC_HEALTH_TOPIC = `0x${"f".repeat(64)}` as `0x${string}`;
function rpcQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}
type HealthRpcError = Error & { status?: number; code?: number };
async function healthRpcRequest(
  runtime: EndpointRuntime,
  method: string,
  params: unknown[] = [],
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new Error("RPC health sweep stopped"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`RPC health probe ${method} timed out`)), config.rpcHealthProbeTimeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(runtime.normalizedUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_048);
      const error = new Error(`RPC health probe HTTP ${response.status}: ${body}`) as HealthRpcError;
      error.status = response.status;
      throw error;
    }
    const payload = await response.json() as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    if (payload.error) {
      const error = new Error(`RPC health probe ${method} failed: ${payload.error.message ?? "unknown JSON-RPC error"}`) as HealthRpcError;
      error.code = payload.error.code;
      throw error;
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function healthLogFilter(runtime: EndpointRuntime, blockNumber: bigint): Record<string, unknown> {
  const chain = getChainByChainId(runtime.configuredChainId);
  return {
    ...(chain?.identityRegistry ? { address: chain.identityRegistry } : {}),
    fromBlock: rpcQuantity(blockNumber),
    toBlock: rpcQuantity(blockNumber),
    topics: [RPC_HEALTH_TOPIC],
  };
}
async function probeLogCapability(runtime: EndpointRuntime, blockNumber: bigint, signal?: AbortSignal): Promise<void> {
  if (publicRpcProviderDefinition(runtime.configuredChainId, runtime.normalizedUrl)?.supportsLogs === false) return;
  try {
    await healthRpcRequest(runtime, "eth_getLogs", [healthLogFilter(runtime, blockNumber)], signal);
    runtime.supportsLogs = true;
  } catch (error) {
    const classification = classifyRpcError(error);
    if (classification === "method_not_found" || classification === "method_restricted" || classification === "unsupported_tag") {
      runtime.supportsLogs = false;
      return;
    }
    throw error;
  }
}
async function probeCallCapability(runtime: EndpointRuntime, signal?: AbortSignal): Promise<void> {
  if (publicRpcProviderDefinition(runtime.configuredChainId, runtime.normalizedUrl)?.supportsCalls === false) {
    runtime.supportsCalls = false;
    return;
  }
  try {
    await healthRpcRequest(runtime, "eth_call", [{ to: "0x0000000000000000000000000000000000000000", data: "0x" }, "latest"], signal);
    runtime.supportsCalls = true;
  } catch (error) {
    const classification = classifyRpcError(error);
    if (classification === "method_not_found" || classification === "method_restricted") {
      runtime.supportsCalls = false;
      return;
    }
    // A JSON-RPC execution or argument error proves that eth_call reached the method handler.
    // Keep the endpoint eligible for real contract calls; only explicit method absence or plan
    // restriction is a negative capability result.
    if (classification === "contract_revert" || classification === "invalid_parameter") {
      runtime.supportsCalls = true;
      return;
    }
    throw error;
  }
}
async function probeArchiveCapability(runtime: EndpointRuntime, latest: bigint, signal?: AbortSignal): Promise<void> {
  if (!config.rpcHealthProbeArchive || runtime.supportsLogs === false || runtime.archiveCapable === true) return;
  if (publicRpcProviderDefinition(runtime.configuredChainId, runtime.normalizedUrl)?.archiveCapable === false) return;
  const chain = getChainByChainId(runtime.configuredChainId);
  const historicalBlock = chain?.deploymentSearchHint;
  if (historicalBlock == null || historicalBlock >= latest) return;
  try {
    await healthRpcRequest(runtime, "eth_getLogs", [healthLogFilter(runtime, historicalBlock)], signal);
    runtime.archiveCapable = true;
    runtime.supportsLogs = true;
  } catch (error) {
    const classification = classifyRpcError(error);
    if (classification === "pruned_history") {
      runtime.archiveCapable = false;
      return;
    }
    if (classification === "method_not_found") {
      runtime.supportsLogs = false;
      runtime.archiveCapable = false;
      return;
    }
    throw error;
  }
}
async function probeEndpointRuntime(
  runtime: EndpointRuntime,
  signal?: AbortSignal,
): Promise<"healthy" | "cooling" | "disabled" | "failed"> {
  await hydrateEndpointState(runtime);
  const credential = healthForCredential(runtime.credentialKey);
  if (runtime.disabledReason || credential.disabledReason) return "disabled";
  const now = Date.now();
  if (runtime.cooldownUntil > now || credential.cooldownUntil > now) return "cooling";
  const startedAt = performance.now();
  runtime.lastProbeAt = Date.now();
  try {
    const observed = parseRpcQuantity(await healthRpcRequest(runtime, "eth_chainId", [], signal), "eth_chainId");
    if (observed !== BigInt(runtime.configuredChainId)) {
      runtime.disabledReason = `RPC chain id mismatch: configured ${runtime.configuredChainId}, observed ${observed}`;
      await persistEndpoint(runtime);
      return "disabled";
    }
    runtime.verifiedChainId = true;
    const latest = parseRpcQuantity(await healthRpcRequest(runtime, "eth_blockNumber", [], signal), "eth_blockNumber");
    runtime.latestHead = latest;
    if (runtime.supportsLogs !== true) await probeLogCapability(runtime, latest, signal);
    if (runtime.supportsCalls !== true) await probeCallCapability(runtime, signal);
    await probeArchiveCapability(runtime, latest, signal);
    markEndpointSuccess(runtime, performance.now() - startedAt);
    credential.cooldownUntil = 0;
    credential.failureCount = 0;
    credential.probeRequired = false;
    await persistEndpoint(runtime);
    return "healthy";
  } catch (error) {
    if (signal?.aborted) return "failed";
    const classification = classifyRpcError(error);
    markEndpointFailure(runtime, performance.now() - startedAt);
    if (classification === "chain_mismatch" || classification === "authentication" || classification === "provider_retired") {
      const reason = classification === "authentication"
        ? `RPC credential authentication or subscription failure for ${runtime.redactedUrl}`
        : (error instanceof Error ? error.message : String(error));
      runtime.disabledReason = reason;
      if (classification === "authentication") credential.disabledReason = reason;
    } else {
      runtime.cooldownUntil = Date.now() + cooldownDuration(runtime.failureCount, classification);
    }
    await persistEndpoint(runtime);
    return runtime.disabledReason ? "disabled" : "failed";
  }
}
let rpcHealthTimer: NodeJS.Timeout | null = null;
let rpcHealthSweepPromise: Promise<void> | null = null;
let rpcHealthAbortController: AbortController | null = null;
let rpcHealthMonitorStopped = true;
export async function runRpcHealthSweep(): Promise<void> {
  if (rpcHealthSweepPromise) return rpcHealthSweepPromise;
  const controller = new AbortController();
  rpcHealthAbortController = controller;
  rpcHealthSweepPromise = (async () => {
    const counts = { healthy: 0, cooling: 0, disabled: 0, failed: 0 };
    const runtimes = getSyncableChainIds().flatMap((chainId) => getRpcUrls(chainId).map((url) => createEndpointRuntime(chainId, url)));
    const byChain = new Map<number, { endpoints: number; healthy: number; cooling: number; disabled: number; failed: number }>();
    for (const runtime of runtimes) {
      const existing = byChain.get(runtime.configuredChainId) ?? { endpoints: 0, healthy: 0, cooling: 0, disabled: 0, failed: 0 };
      existing.endpoints += 1;
      byChain.set(runtime.configuredChainId, existing);
    }
    try {
      await forEachWithConcurrency(runtimes, 8, async (runtime) => {
        if (controller.signal.aborted) return;
        const status = await runtime.scheduler.run(
          (signal) => probeEndpointRuntime(runtime, signal ?? controller.signal),
          { priority: -100, signal: controller.signal },
        );
        if (!status) return;
        counts[status] += 1;
        const chainCounts = byChain.get(runtime.configuredChainId);
        if (chainCounts) chainCounts[status] += 1;
      });
    } catch (error) {
      if (controller.signal.aborted && rpcHealthMonitorStopped) return;
      throw error;
    }
    if (controller.signal.aborted) return;
    logger.info(
      "RPC provider health sweep completed",
      {
        endpoints: runtimes.length,
        ...counts,
        logCapable: runtimes.filter((runtime) => runtime.supportsLogs === true).length,
        callCapable: runtimes.filter((runtime) => runtime.supportsCalls === true).length,
        archiveCapable: runtimes.filter((runtime) => runtime.archiveCapable === true).length,
        chains: Object.fromEntries([...byChain.entries()].sort(([left], [right]) => left - right)),
      },
      "rpc",
    );
  })().finally(() => {
    if (rpcHealthAbortController === controller) rpcHealthAbortController = null;
    rpcHealthSweepPromise = null;
  });
  return rpcHealthSweepPromise;
}
function nextRpcHealthSweepDelay(): number {
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.max(1_000, Math.round(config.rpcHealthProbeIntervalMs * jitter));
}
function scheduleRpcHealthSweep(delayMs: number): void {
  if (rpcHealthMonitorStopped) return;
  rpcHealthTimer = setTimeout(() => {
    void runRpcHealthSweep()
      .catch((error) => logger.warn("RPC provider health sweep failed", { error: redactRpcErrorText(error instanceof Error ? error.message : String(error)) }, "rpc"))
      .finally(() => scheduleRpcHealthSweep(nextRpcHealthSweepDelay()));
  }, delayMs);
  rpcHealthTimer.unref?.();
}
export function startRpcHealthMonitor(): void {
  if (!rpcHealthMonitorStopped) return;
  rpcHealthMonitorStopped = false;
  const startupWindow = Math.min(30_000, Math.max(1_000, Math.floor(config.rpcHealthProbeIntervalMs / 10)));
  scheduleRpcHealthSweep(rotatedIndex("rpc-health-startup", startupWindow, config.rpcHealthProbeIntervalMs));
}
export async function stopRpcHealthMonitor(): Promise<void> {
  rpcHealthMonitorStopped = true;
  if (rpcHealthTimer) clearTimeout(rpcHealthTimer);
  rpcHealthTimer = null;
  rpcHealthAbortController?.abort(new DOMException("RPC health monitor stopped", "AbortError"));
  const sweep = rpcHealthSweepPromise;
  if (!sweep) return;
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      timer.unref?.();
    }),
  ]);
}
export async function drainRpcQueues(): Promise<void> {
  await Promise.all([...rpcSchedulers.values()].map((scheduler) => scheduler.onIdle()));
}
/**
 * Execute a logical operation through an endpoint that has passed chain identity and optional
 * pinned-block eligibility checks. Every underlying JSON-RPC request is rate-limited by the
 * transport wrapper; fallback never changes the requested snapshot.
 */
export type RpcExecutionContext = {
  endpointKey: string;
  endpointUrl: string;
  learnedLogRange(domain: string, fallback: number): number;
  recordLearnedLogRange(domain: string, value: number): Promise<void>;
};
function rpcExecutionContext(runtime: EndpointRuntime): RpcExecutionContext {
  return {
    endpointKey: runtime.key,
    endpointUrl: runtime.redactedUrl,
    learnedLogRange(domain, fallback) {
      const learned = runtime.learnedLogRanges[domain] ?? fallback;
      return runtime.staticMaxLogRange == null ? learned : Math.min(learned, runtime.staticMaxLogRange);
    },
    async recordLearnedLogRange(domain, value) {
      if (!Number.isSafeInteger(value) || value <= 0) return;
      runtime.learnedLogRanges[domain] = value;
      await persistEndpoint(runtime);
    },
  };
}
let rpcFallbackOperationSequence = 0;
export async function withRpcFallback<T>(
  chainId: number,
  fn: (client: PublicClient, endpoint: RpcExecutionContext) => Promise<T>,
  context?: RpcPinnedContext,
): Promise<T> {
  throwIfAborted(context?.signal);
  const runtimes = orderedRpcRuntimes(chainId);
  if (runtimes.length === 0) {
    throw new RpcFinalityUnavailableError("rpc_transport_unavailable", `No RPC URLs for chain ${chainId}`);
  }
  const providerSwitchScope = `${chainId}:${++rpcFallbackOperationSequence}`;
  let lastError: unknown;
  let eligible = 0;
  const failureClasses: RpcErrorClass[] = [];
  for (const runtime of runtimes) {
    throwIfAborted(context?.signal);
    const credential = runtime.credentialKey;
    const credentialState = healthForCredential(credential);
    const now = Date.now();
    if (runtime.disabledReason || runtime.cooldownUntil > now || credentialState.cooldownUntil > now) continue;
    runtime.selectionCount += 1;
    runtime.inFlight += 1;
    const startedAt = performance.now();
    try {
      if (!(await endpointEligibleForContext(runtime, context))) continue;
      eligible += 1;
      throwIfAborted(context?.signal);
      const result = await fn(runtime.client, rpcExecutionContext(runtime));
      throwIfAborted(context?.signal);
      if (context?.requiresLogs) runtime.supportsLogs = true;
      if (context?.requiresCalls) runtime.supportsCalls = true;
      if (context?.requiresArchive && context.blockNumber != null && runtime.latestHead != null && context.blockNumber < runtime.latestHead) {
        runtime.archiveCapable = true;
      }
      markEndpointSuccess(runtime, performance.now() - startedAt);
      await persistEndpoint(runtime, { routine: true });
      return result;
    } catch (error) {
      lastError = error;
      const classification = classifyRpcError(error);
      failureClasses.push(classification);
      markEndpointFailure(runtime, performance.now() - startedAt);
      let attemptBudgetError: RetryBudgetExceededError | null = null;
      try {
        currentRetryBudget()?.consumeAttempt(
          classification === "pruned_history" ? "archive_unavailable" : classification,
          providerSwitchScope,
          runtimes.length,
        );
      } catch (budgetError) {
        if (!(budgetError instanceof RetryBudgetExceededError)) throw budgetError;
        attemptBudgetError = budgetError;
      }
      if (context?.requiresLogs && (classification === "method_not_found" || classification === "method_restricted")) runtime.supportsLogs = false;
      if (context?.requiresCalls && (classification === "method_not_found" || classification === "method_restricted")) runtime.supportsCalls = false;
      if (classification === "pruned_history") runtime.archiveCapable = false;
      if (classification === "chain_mismatch" || classification === "provider_retired") {
        runtime.disabledReason = error instanceof Error ? error.message : String(error);
      } else if (classification === "invalid_parameter" || classification === "contract_decode" || classification === "contract_revert" || classification === "noncanonical_block") {
        await persistEndpoint(runtime);
        throw error;
      }
      runtime.cooldownUntil = Date.now() + cooldownDuration(runtime.failureCount, classification);
      if (classification === "authentication") {
        const reason = `RPC credential authentication or subscription failure for ${runtime.redactedUrl}`;
        runtime.disabledReason = reason;
        credentialState.disabledReason = reason;
        credentialState.cooldownUntil = 0;
        credentialState.probeRequired = false;
      }
      if (classification === "rate_limit") {
        credentialState.failureCount += 1;
        credentialState.cooldownUntil = Date.now() + cooldownDuration(credentialState.failureCount, classification);
        credentialState.probeRequired = true;
      }
      await persistEndpoint(runtime);
      if (classification !== "chain_mismatch" && classification !== "provider_retired" && !retryableRpcClass(classification)) throw error;
      if (attemptBudgetError) throw attemptBudgetError;
      currentRetryBudget()?.consumeProviderSwitch(providerSwitchScope, runtimes.length);
    } finally {
      runtime.inFlight = Math.max(0, runtime.inFlight - 1);
    }
  }
  if (eligible === 0 && !lastError) {
    if (context?.requiresArchive) {
      throw new RpcFinalityUnavailableError(
        "rpc_archive_unavailable",
        `No configured RPC endpoint can serve historical state for chain ${chainId}`,
      );
    }
    throw new RpcFinalityUnavailableError(
      "rpc_transport_unavailable",
      `No RPC endpoint can serve the requested snapshot for chain ${chainId}`,
    );
  }
  if (
    context?.requiresArchive &&
    failureClasses.length > 0 &&
    failureClasses.every((classification) =>
      classification === "pruned_history" ||
      classification === "method_not_found" ||
      classification === "method_restricted"
    )
  ) {
    throw new RpcFinalityUnavailableError(
      "rpc_archive_unavailable",
      `Every eligible RPC endpoint lacks the required historical state for chain ${chainId}`,
    );
  }
  throw lastError ?? new Error(`Every RPC endpoint is cooling down for chain ${chainId}`);
}
