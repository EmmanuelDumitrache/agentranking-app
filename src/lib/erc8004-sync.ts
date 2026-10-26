import { createPublicClient, fallback, http, defineChain } from "viem";
import { HttpStatusError, parseRetryAfterMs, retryHttpOperation } from "@/lib/timing/retry";
import type { Chain, PublicClient } from "viem";
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
import { prisma } from "@/lib/db";
import { getChainByChainId, CHAINS } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { sanitizeForPostgres } from "@/lib/utils";
import { computeAgentScore } from "@/lib/agent-score";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { registrationFingerprint } from "@/lib/registration-fingerprint";
import { isLowSignalAgentListing } from "@/lib/agent-listing-quality";
import { assertNotBlocklisted, AgentBlocklistError } from "@/lib/agent-blocklist";
import { fetchRegistrationDocument } from "@/lib/registration-document";
import {
  mergeMetadataEntriesForChainSync,
  mergeServicesForChainSync,
} from "@/lib/agent-chain-sync-merge";
// Mapping chainId -> env var name. Only chains with explicit RPC env are synced (avoids public fallback rate limits).
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
// Build Infura URL helper. Chains Infura supports get an Infura endpoint; others use public RPCs.
const INFURA_KEYS = [
  process.env.INFURA_API_KEY,
  process.env.INFURA_API_KEY_2,
  process.env.INFURA_API_KEY_3,
  process.env.INFURA_API_KEY_4,
  process.env.INFURA_API_KEY_5,
  process.env.INFURA_API_KEY_6,
  process.env.INFURA_API_KEY_7,
  process.env.INFURA_API_KEY_8,
].map((key) => key?.trim()).filter(Boolean) as string[];
function getCurrentInfuraKey(): string {
  if (INFURA_KEYS.length === 0) return "";
  const switchMins = Number.parseFloat(process.env.INFURA_PRIMARY_SWITCH_MINUTES ?? "");
  const rotationMs = Number.isFinite(switchMins) && switchMins > 0
    ? switchMins * 60 * 1000
    : 6 * 60 * 60 * 1000;
  const idx = Math.floor(Date.now() / rotationMs) % INFURA_KEYS.length;
  return INFURA_KEYS[idx] ?? INFURA_KEYS[0] ?? "";
}
function infura(network: string, fallback: string): string {
  const key = getCurrentInfuraKey();
  if (key) return `https://${network}.infura.io/v3/${key}`;
  return fallback;
}
// RPC URLs: prefer INFURA_API_KEY (large getLogs, no block range limit), fall back to per-chain env or public.
export const RPC_URLS: Record<number, string> = {
  1: process.env.ETHEREUM_RPC_URL || infura("mainnet", "https://eth.llamarpc.com"),
  8453: process.env.BASE_RPC_URL || infura("base-mainnet", "https://mainnet.base.org"),
  137: process.env.POLYGON_RPC_URL || infura("polygon-mainnet", "https://polygon-rpc.com"),
  56: process.env.BSC_RPC_URL || infura("bsc-mainnet", "https://bsc-dataseed.bnbchain.org"),
  100: process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com",
  42161: process.env.ARBITRUM_RPC_URL || infura("arbitrum-mainnet", "https://arb1.arbitrum.io/rpc"),
  42220: process.env.CELO_RPC_URL || infura("celo-mainnet", "https://forno.celo.org"),
  534352: process.env.SCROLL_RPC_URL || "https://rpc.scroll.io",
  59144: process.env.LINEA_RPC_URL || infura("linea-mainnet", "https://rpc.linea.build"),
  43114: process.env.AVALANCHE_RPC_URL || infura("avalanche-mainnet", "https://api.avax.network/ext/bc/C/rpc"),
  10: process.env.OPTIMISM_RPC_URL || infura("optimism-mainnet", "https://mainnet.optimism.io"),
  5000: process.env.MANTLE_RPC_URL || infura("mantle-mainnet", "https://rpc.mantle.xyz"),
  143: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
  167000: process.env.TAIKO_RPC_URL || "https://rpc.mainnet.taiko.xyz",
  9745: process.env.PLASMA_RPC_URL || "https://rpc.plasma.to",
  4326: process.env.MEGAETH_RPC_URL || "https://mainnet.megaeth.com/rpc",
  2741: process.env.ABSTRACT_RPC_URL || "https://api.mainnet.abs.xyz",
  2046399126: process.env.SKALE_EUROPA_RPC_URL || "https://mainnet.skalenodes.com/v1/elated-tan-skat",
  360: process.env.SHAPE_RPC_URL || "https://mainnet.shape.network",
  196: process.env.X_LAYER_RPC_URL || "https://rpc.xlayer.tech",
  2345: process.env.GOAT_RPC_URL || "https://rpc.goat.network",
  1088: process.env.METIS_RPC_URL || "https://andromeda.metis.io/?owner=1088",
  1187947933: process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base",
  1868: process.env.SONEIUM_RPC_URL || "https://rpc.soneium.org",
  45056: process.env.BILLIONS_RPC_URL || "",
  1776: process.env.INJECTIVE_RPC_URL || "https://sentry.evm-rpc.injective.network/",
  4217: process.env.TEMPO_RPC_URL || "https://rpc.tempo.xyz",
  42: process.env.LUKSO_RPC_URL || "https://42.rpc.thirdweb.com",
  10088: process.env.GATE_LAYER_RPC_URL || "https://gatelayer-mainnet.gatenode.cc",
  5042002: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
};
/** Public RPCs tried after the primary URL (Infura 402/429, Alchemy limits, etc.). Aligned with worker `RPC_FALLBACKS`. */
const EVM_RPC_PUBLIC_FALLBACKS: Record<number, string[]> = {
  1: [
    "https://eth.llamarpc.com",
    "https://ethereum.publicnode.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
  ],
  8453: ["https://base.llamarpc.com", "https://mainnet.base.org", "https://base.publicnode.com"],
  137: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "https://polygon.llamarpc.com"],
  56: ["https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.bnbchain.org", "https://bsc.publicnode.com"],
  100: ["https://rpc.gnosischain.com", "https://gnosis.drpc.org"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one.publicnode.com", "https://arbitrum.llamarpc.com"],
  42220: ["https://forno.celo.org", "https://celo.drpc.org"],
  534352: ["https://rpc.scroll.io", "https://scroll.drpc.org"],
  59144: ["https://rpc.linea.build", "https://linea.drpc.org"],
  43114: ["https://api.avax.network/ext/bc/C/rpc", "https://avax.meowrpc.com"],
  10: ["https://mainnet.optimism.io", "https://optimism.publicnode.com", "https://optimism.llamarpc.com"],
  5000: ["https://rpc.mantle.xyz"],
  143: ["https://rpc.monad.xyz", "https://rpc1.monad.xyz", "https://rpc2.monad.xyz", "https://rpc3.monad.xyz"],
  167000: ["https://rpc.mainnet.taiko.xyz"],
  4326: ["https://mainnet.megaeth.com/rpc"],
  2741: ["https://api.mainnet.abs.xyz"],
  2046399126: ["https://mainnet.skalenodes.com/v1/elated-tan-skat"],
  360: ["https://mainnet.shape.network"],
  196: ["https://rpc.xlayer.tech"],
  2345: ["https://rpc.goat.network"],
  1088: ["https://andromeda.metis.io/?owner=1088"],
  1187947933: ["https://skale-base.skalenodes.com/v1/base"],
  1868: ["https://rpc.soneium.org", "https://soneium.drpc.org"],
  1776: ["https://sentry.evm-rpc.injective.network/"],
  4217: ["https://rpc.tempo.xyz"],
  // Envio HyperSync requires an API token and is not a drop-in unauthenticated JSON-RPC fallback.
  42: ["https://42.rpc.thirdweb.com"],
  10088: ["https://gatelayer-mainnet.gatenode.cc"],
  5042002: [
    "https://rpc.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
  ],
};
function dedupeRpcUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const u = raw.trim();
    if (!u) continue;
    const n = u.replace(/\/+$/, "");
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(u);
  }
  return out;
}
/** Primary (env / Infura / project default) plus free fallbacks for viem `fallback` transport. */
function rpcUrlsWithPublicFallbacks(chainId: number, primaryUrl: string): string[] {
  const primary = primaryUrl.trim();
  if (!primary) return [];
  const extras = EVM_RPC_PUBLIC_FALLBACKS[chainId] ?? [];
  return dedupeRpcUrls([primary, ...extras]);
}
// Machine-verified Identity Registry proxy creation blocks. Chains omitted from
// this map must not substitute a guessed genesis or block-1 floor. The worker
// proves their registry-specific boundaries with archival eth_getCode searches.
/** Verified Identity Registry deployment blocks used by bounded application-side history reads. */
export const ERC8004_IDENTITY_DEPLOY_BLOCKS: Record<number, bigint> = {
  1: 24_339_871n,
  56: 79_027_268n,
  100: 44_505_010n,
  137: 82_458_484n,
  8453: 41_663_783n,
  42161: 428_895_443n,
  42220: 58_396_724n,
  10: 147_514_947n,
  5000: 91_333_846n,
  143: 52_952_790n,
  167000: 4_305_747n,
  4326: 7_833_805n,
  2741: 39_596_871n,
  1868: 18_879_198n,
};
/** Service/endpoint from registration JSON - supports MCP, A2A, OASF, agentWallet, etc. */
interface ServiceEntry {
  name?: string;
  endpoint?: string;
  version?: string;
  skills?: string[];
  domains?: string[];
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  a2aSkills?: string[];
  capabilities?: unknown[];
}
interface RegistrationJson {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceEntry[];
  endpoints?: ServiceEntry[];
  x402Support?: boolean;
  supportedTrust?: string[];
  active?: boolean;
  updatedAt?: number;
  registrations?: Array<{ agentId?: number; agentRegistry?: string }>;
  supportsERC8211?: boolean;
  medusaPassportSupported?: boolean;
  medusaPassportUseCase?: string;
  medusaMinTier?: string;
}
function normalizeServiceEntries(reg: RegistrationJson): ServiceEntry[] {
  const tryOne = (raw: unknown): ServiceEntry[] => {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      const t = raw.trim();
      if (!t) return [];
      try {
        return tryOne(JSON.parse(t) as unknown);
      } catch {
        return [];
      }
    }
    if (typeof raw === "object" && !Array.isArray(raw)) return [raw as ServiceEntry];
    return [];
  };
  const fromS = tryOne(reg.services as unknown);
  if (fromS.length > 0) return fromS;
  return tryOne(reg.endpoints as unknown);
}
const REGISTRATION_FETCH_TIMEOUT_MS = Math.min(
  45_000,
  Math.max(
    8_000,
    Number.parseInt(process.env.REGISTRATION_JSON_FETCH_TIMEOUT_MS ?? "22000", 10) || 22_000,
  ),
);
async function fetchRegistrationJson(uri: string): Promise<RegistrationJson | null> {
  return fetchRegistrationDocument<RegistrationJson>(uri, {
    httpsTimeoutMs: REGISTRATION_FETCH_TIMEOUT_MS,
    ipfsTimeoutMs: REGISTRATION_FETCH_TIMEOUT_MS,
  });
}
function parseServices(reg: RegistrationJson): { name: string; endpoint: string; version: string }[] {
  const services = normalizeServiceEntries(reg);
  return services.map((s) => ({
    name: sanitizeForPostgres((s.name ?? "WEB").toUpperCase().slice(0, 20)),
    endpoint: sanitizeForPostgres(s.endpoint ?? ""),
    version: sanitizeForPostgres(s.version ?? "1.0"),
  }));
}
/** Extract metadata key-value pairs from registration JSON for AgentMetadata table */
function extractMetadataFromRegistration(
  reg: RegistrationJson | null,
  onChainAgentWallet: string | null
): Array<{ key: string; value: string }> {
  if (!reg) return [];
  const entries: Array<{ key: string; value: string }> = [];
  const services = normalizeServiceEntries(reg);
  // On-chain agentWallet is authoritative (set via setAgentWallet); off-chain is discovery-only
  const wallet = onChainAgentWallet && onChainAgentWallet !== "0x0000000000000000000000000000000000000000"
    ? onChainAgentWallet
    : services.find((s) => (s.name?.toLowerCase() ?? "") === "agentwallet")?.endpoint ?? "";
  if (wallet) {
    const addr = wallet.startsWith("eip155:") ? wallet.split(":").pop() ?? wallet : wallet;
    entries.push({ key: "agentWallet", value: addr });
  }
  for (const s of services) {
    const name = (s.name ?? "").toLowerCase();
    const ep = s.endpoint ?? "";
    if (!ep) continue;
    if (name === "web" || name === "website") entries.push({ key: "website", value: ep });
    else if (name === "email") entries.push({ key: "email", value: ep });
    else if (name === "ens") entries.push({ key: "ens", value: ep });
  }
  if (reg.updatedAt != null) entries.push({ key: "updatedAt", value: String(reg.updatedAt) });
  if (reg.active != null) entries.push({ key: "active", value: reg.active ? "true" : "false" });
  if (reg.supportsERC8211 === true) entries.push({ key: "supportsERC8211", value: "true" });
  if (reg.medusaPassportSupported === true) {
    entries.push({ key: "medusaPassportSupported", value: "true" });
  }
  if (reg.medusaPassportUseCase?.trim()) {
    entries.push({ key: "medusaPassportUseCase", value: reg.medusaPassportUseCase.trim() });
  }
  if (reg.medusaMinTier?.trim()) {
    entries.push({ key: "medusaMinTier", value: reg.medusaMinTier.trim() });
  }
  const oasf = services.find((s) => (s.name?.toLowerCase() ?? "") === "oasf");
  if (oasf?.skills?.length) entries.push({ key: "oasfSkills", value: JSON.stringify(oasf.skills) });
  if (oasf?.domains?.length) entries.push({ key: "oasfDomains", value: JSON.stringify(oasf.domains) });
  const mcp = services.find((s) => (s.name?.toLowerCase() ?? "") === "mcp");
  if (mcp?.mcpTools?.length) entries.push({ key: "mcpTools", value: JSON.stringify(mcp.mcpTools) });
  const a2a = services.find((s) => (s.name?.toLowerCase() ?? "") === "a2a");
  if (a2a?.a2aSkills?.length) entries.push({ key: "a2aSkills", value: JSON.stringify(a2a.a2aSkills) });
  if (reg.registrations?.length) entries.push({ key: "registrations", value: JSON.stringify(reg.registrations) });
  if (reg.type) entries.push({ key: "type", value: reg.type });
  return entries;
}
/** getLogs chunk size for Infura (allows larger ranges than Alchemy). Adaptive retry halves on error. */
/** Fetch that retries transient RPC responses with bounded randomized backoff. */
function createRetryFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input, init) =>
    retryHttpOperation(
      async () => {
        const response = await fetch(input, init);
        if (response.status === 429 || response.status === 503) {
          throw new HttpStatusError(
            response.status,
            `RPC request failed with status ${response.status}`,
            parseRetryAfterMs(response.headers.get("retry-after")),
          );
        }
        return response;
      },
      { retries: 3, minTimeout: 2_000, maxTimeout: 12_000, signal: init?.signal ?? undefined },
    );
}
const REGISTRY_READ_ABI = [
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "getAgentWallet", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
function buildErc8004SyncClient(
  chainId: number,
  rpcUrl: string
): { client: PublicClient; identityRegistry: `0x${string}` } | null {
  const chainConfig = getChainByChainId(chainId);
  if (!chainConfig) return null;
  const chainMap: Record<number, Chain> = {
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
    5000: defineChain({ id: 5000, name: "Mantle", nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" }, rpcUrls: { default: { http: [RPC_URLS[5000]] } } }),
    143: defineChain({ id: 143, name: "Monad", nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" }, rpcUrls: { default: { http: [RPC_URLS[143]] } } }),
    167000: defineChain({ id: 167000, name: "Taiko", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[167000]] } } }),
    9745: defineChain({ id: 9745, name: "Plasma Mainnet Beta", nativeCurrency: { decimals: 18, name: "Plasma", symbol: "XPL" }, rpcUrls: { default: { http: [RPC_URLS[9745] || "https://rpc.plasma.to"] } }, blockExplorers: { default: { name: "PlasmaScan", url: "https://plasmascan.to" } } }),
    4326: defineChain({ id: 4326, name: "MegaETH", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[4326]] } } }),
    2741: defineChain({ id: 2741, name: "Abstract", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[2741]] } } }),
    2046399126: defineChain({ id: 2046399126, name: "Skale Europa", nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" }, rpcUrls: { default: { http: [RPC_URLS[2046399126]] } } }),
    360: defineChain({ id: 360, name: "Shape", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[360]] } } }),
    196: defineChain({ id: 196, name: "X Layer", nativeCurrency: { decimals: 18, name: "OKB", symbol: "OKB" }, rpcUrls: { default: { http: [RPC_URLS[196]] } } }),
    2345: defineChain({ id: 2345, name: "GOAT Network", nativeCurrency: { decimals: 18, name: "Bitcoin", symbol: "BTC" }, rpcUrls: { default: { http: [RPC_URLS[2345]] } } }),
    1088: defineChain({ id: 1088, name: "Metis", nativeCurrency: { decimals: 18, name: "Metis", symbol: "METIS" }, rpcUrls: { default: { http: [RPC_URLS[1088]] } } }),
    1187947933: defineChain({
      id: 1187947933,
      name: "SKALE Base",
      nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" },
      rpcUrls: { default: { http: [RPC_URLS[1187947933]] } },
    }),
    1868: defineChain({
      ...soneium,
      rpcUrls: { default: { http: [RPC_URLS[1868] || "https://rpc.soneium.org"] } },
    }),
    45056: defineChain({ id: 45056, name: "Billions", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [RPC_URLS[45056] || ""] } } }),
    1776: defineChain({ id: 1776, name: "Injective", nativeCurrency: { decimals: 18, name: "Injective", symbol: "INJ" }, rpcUrls: { default: { http: [RPC_URLS[1776]] } } }),
    4217: defineChain({ id: 4217, name: "Tempo", nativeCurrency: { decimals: 18, name: "USD", symbol: "USD" }, rpcUrls: { default: { http: [RPC_URLS[4217]] } } }),
    42: defineChain({ id: 42, name: "LUKSO", nativeCurrency: { decimals: 18, name: "LYX", symbol: "LYX" }, rpcUrls: { default: { http: [RPC_URLS[42]] } } }),
    10088: defineChain({ id: 10088, name: "Gate Layer Mainnet", nativeCurrency: { decimals: 18, name: "GT", symbol: "GT" }, rpcUrls: { default: { http: [RPC_URLS[10088]] } } }),
    5042002: defineChain({
      id: 5042002,
      name: "Arc",
      nativeCurrency: { decimals: 18, name: "USD Coin", symbol: "USDC" },
      rpcUrls: { default: { http: [RPC_URLS[5042002] || "https://rpc.testnet.arc.io"] } },
      blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
      testnet: true,
    }),
  };
  const chain = chainMap[chainId] ?? mainnet;
  const urls = rpcUrlsWithPublicFallbacks(chainId, rpcUrl);
  const first = urls[0];
  if (!first) return null;
  const httpOpts = { fetchFn: createRetryFetch(), timeout: 60_000 } as const;
  const transport =
    urls.length > 1 ? fallback(urls.map((u) => http(u, httpOpts))) : http(first, httpOpts);
  const client = createPublicClient({
    chain,
    transport,
  });
  return { client, identityRegistry: chainConfig.identityRegistry as `0x${string}` };
}
export type UpsertAgentFromRegistryResult =
  | { ok: true; internalId: number; created: boolean }
  | { ok: false; error: string };
/**
 * Single-agent upsert using the same registry reads + DB logic as batch sync (for admin import / backfill).
 */
export async function upsertAgentFromRegistryCore(
  chainId: number,
  agentId: number,
  client: PublicClient,
  identityRegistry: `0x${string}`
): Promise<UpsertAgentFromRegistryResult> {
  const abi = REGISTRY_READ_ABI;
  try {
    const [uri, owner, agentWallet] = await Promise.all([
      client.readContract({ address: identityRegistry, abi, functionName: "tokenURI", args: [BigInt(agentId)] }),
      client.readContract({ address: identityRegistry, abi, functionName: "ownerOf", args: [BigInt(agentId)] }),
      client.readContract({ address: identityRegistry, abi, functionName: "getAgentWallet", args: [BigInt(agentId)] }).catch(() => null as string | null),
    ]);
    const reg = uri ? await fetchRegistrationJson(uri) : null;
    const name = sanitizeForPostgres(reg?.name ?? "Unnamed Agent");
    const description = sanitizeForPostgres(reg?.description ?? "");
    const image = sanitizeForPostgres(reg?.image ?? "");
    const services = reg ? parseServices(reg) : [];
    const hasAgentWallet = !!(agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000")
      || (reg && (reg.services ?? reg.endpoints ?? []).some((s) => (s.name?.toLowerCase() ?? "") === "agentwallet"));
    const x402Support = reg?.x402Support === true;
    const supportedTrust = sanitizeForPostgres(Array.isArray(reg?.supportedTrust) ? reg.supportedTrust.join(", ") : "reputation");
    const isActiveFromReg = reg?.active ?? true;
    const rawMetadata = extractMetadataFromRegistration(reg, agentWallet);
    const metadataEntries = rawMetadata.map((e) => ({ key: sanitizeForPostgres(e.key), value: sanitizeForPostgres(e.value) }));
    const svcForFpEarly = services.map((s) => ({ name: s.name, endpoint: s.endpoint }));
    const regFp = registrationFingerprint(name, description, image, svcForFpEarly, x402Support);
    const metadataWithFingerprint = [
      ...metadataEntries.filter((e) => e.key !== "registrationFingerprint"),
      { key: "registrationFingerprint", value: regFp },
    ];
    const scoreWallet = hasAgentWallet ? 100 : 0;
    const isJunk = isLowSignalAgentListing(name, description, services);
    const existing = await prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      include: { services: true, metadata: true },
    });
    const created = !existing;
    const isKyaVerified = existing?.isPremiumVerified ?? false;
    const now = new Date();
    const svcForFp = services.map((s) => ({ name: s.name, endpoint: s.endpoint }));
    const lastActiveAnchor =
      existing
        ? registrationFingerprint(
            existing.name,
            existing.description,
            existing.image,
            existing.services.map((s) => ({ name: s.name, endpoint: s.endpoint })),
            existing.x402Support
          ) === registrationFingerprint(name, description, image, svcForFp, x402Support)
          ? existing.lastActiveAt
          : now
        : now;
    const existingMetaRows = (existing?.metadata ?? []).map((m) => ({ key: m.key, value: m.value }));
    const mergedMetadata = mergeMetadataEntriesForChainSync(existingMetaRows, metadataWithFingerprint);
    const mergedServices = mergeServicesForChainSync(
      (existing?.services ?? []).map((s) => ({
        name: s.name,
        endpoint: s.endpoint,
        version: s.version,
      })),
      services,
    );
    const metaForScoring = existing
      ? isKyaVerified
        ? existingMetaRows
        : mergedMetadata
      : metadataWithFingerprint;
    const svcForScoring = existing ? mergedServices : services;
    const metadataUpdate =
      mergedMetadata.length > 0
        ? { deleteMany: {} as const, create: mergedMetadata.map((e) => ({ key: e.key, value: e.value })) }
        : ({ deleteMany: {} as const } as const);
    const scored = computeAgentScore({
      name,
      description,
      image,
      metadata: metaForScoring,
      services: svcForScoring,
      scoreWallet,
      x402Support,
      binanceCompatible: existing?.binanceCompatible ?? false,
      totalFeedback: existing?.totalFeedback ?? 0,
      scoreQuality: existing?.scoreQuality ?? 0,
      lastActiveAt: lastActiveAnchor,
    });
    const agentData = {
      agentId, chainId, name, description, image,
      agentURI: sanitizeForPostgres(uri ?? ""), owner: sanitizeForPostgres(owner as string),
      isActive: isJunk ? false : isActiveFromReg, isVerified: false, score: scored.score, rank: 0,
      hotScore: scored.hotScore,
      x402Support, stars: 0, totalFeedback: 0,
      scoreWallet,
      scoreMetadata: scored.scoreMetadata,
      scoreServices: scored.scoreEndpoints,
      scoreFreshness: scored.scoreFreshness,
      scorePopularity: scored.scorePopularity,
      supportedTrust,
      lastActiveAt: lastActiveAnchor,
      listedAt: now,
      services: { create: services.map((s) => ({ name: s.name, endpoint: s.endpoint, version: s.version })) },
      ...(metadataWithFingerprint.length > 0 && {
        metadata: { create: metadataWithFingerprint.map((e) => ({ key: e.key, value: e.value })) },
      }),
    };
    const nextIsActive = isJunk ? false : isActiveFromReg;
    const relisted = Boolean(existing && !existing.isActive && nextIsActive);
    try {
      await assertNotBlocklisted({
        name,
        agentURI: sanitizeForPostgres(uri ?? ""),
        owner: sanitizeForPostgres(owner as string),
        chainId,
        agentId,
      });
    } catch (e) {
      if (e instanceof AgentBlocklistError) {
        return { ok: false, error: e.message };
      }
      throw e;
    }
    const agentScoreSelect = {
      id: true,
      name: true,
      description: true,
      image: true,
      x402Support: true,
      binanceCompatible: true,
      totalFeedback: true,
      scoreQuality: true,
      lastActiveAt: true,
    } as const;
    const updated = existing
      ? await prisma.agent.update({
          where: { agentId_chainId: { agentId, chainId } },
          data: {
            name,
            ...(isKyaVerified ? {} : { description, image }),
            agentURI: sanitizeForPostgres(uri ?? ""), owner: sanitizeForPostgres(owner as string),
            isActive: nextIsActive,
            ...(relisted ? { listedAt: new Date() } : {}),
            x402Support,
            scoreWallet,
            scoreMetadata: scored.scoreMetadata,
            scoreServices: scored.scoreEndpoints,
            score: scored.score,
            hotScore: scored.hotScore,
            scoreFreshness: scored.scoreFreshness,
            scorePopularity: scored.scorePopularity,
            supportedTrust,
            lastActiveAt: lastActiveAnchor,
            services: {
              deleteMany: {},
              create: mergedServices.map((s) => ({ name: s.name, endpoint: s.endpoint, version: s.version })),
            },
            ...(isKyaVerified ? {} : { metadata: metadataUpdate }),
          },
          select: agentScoreSelect,
        })
      : await prisma.agent.create({ data: agentData, select: agentScoreSelect });
    const finalMeta = isKyaVerified
      ? await prisma.agentMetadata.findMany({ where: { agentId: updated.id } })
      : mergedMetadata;
    const recomputed = computeAgentScore({
      name: updated.name,
      description: updated.description,
      image: updated.image,
      metadata: finalMeta,
      services: mergedServices,
      scoreWallet,
      x402Support: updated.x402Support,
      binanceCompatible: updated.binanceCompatible,
      totalFeedback: updated.totalFeedback,
      scoreQuality: updated.scoreQuality ?? 0,
      lastActiveAt: updated.lastActiveAt,
    });
    await prisma.agent.update({
      where: { id: updated.id },
      data: {
        hotScore: recomputed.hotScore,
        scoreMetadata: recomputed.scoreMetadata,
        scoreServices: recomputed.scoreEndpoints,
        scoreFreshness: recomputed.scoreFreshness,
        scorePopularity: recomputed.scorePopularity,
      },
      select: { id: true },
    });
    await persistAgentScoresById(prisma, updated.id);
    return { ok: true, internalId: updated.id, created };
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
/** Ensure chain row exists, upsert one agent from registry, refresh chain.agentCount. */
export async function upsertAgentFromRegistry(chainId: number, agentId: number): Promise<UpsertAgentFromRegistryResult> {
  if (chainId === SOLANA_CHAIN_ID) {
    return { ok: false, error: "Solana agents are synced via the worker indexer (solana-indexer-sync), not EVM RPC." };
  }
  const chainConfig = getChainByChainId(chainId);
  const rpcUrl = RPC_URLS[chainId];
  if (!chainConfig || !rpcUrl?.trim()) {
    return { ok: false, error: `No RPC configured for chain ${chainId}` };
  }
  const built = buildErc8004SyncClient(chainId, rpcUrl.trim());
  if (!built) {
    return { ok: false, error: `Could not build RPC client for chain ${chainId}` };
  }
  await prisma.chain.upsert({
    where: { chainId },
    create: {
      chainId,
      name: chainConfig.name,
      shortName: chainConfig.shortName,
      icon: chainConfig.icon,
      color: chainConfig.color,
      identityRegistry: chainConfig.identityRegistry,
      reputationRegistry: chainConfig.reputationRegistry,
      agentCount: 0,
      feedbackCount: 0,
      isActive: chainConfig.isActive,
    },
    update: {},
  });
  const result = await upsertAgentFromRegistryCore(chainId, agentId, built.client, built.identityRegistry);
  if (result.ok) {
    const agentCount = await prisma.agent.count({ where: { chainId } });
    await prisma.chain.update({ where: { chainId }, data: { agentCount } });
  }
  return result;
}
/** Chain IDs Infura supports – these are syncable when INFURA_API_KEY is set (even without per-chain env vars). */
const INFURA_CHAIN_IDS = new Set([1, 8453, 137, 56, 42161, 42220, 59144, 43114, 10, 5000]);
/** Parse optional SYNC_CHAIN_IDS env (e.g. "1,8453,56"). When set, app and worker show the same syncable set. */
function getSyncChainIdsAllowList(): Set<number> | null {
  const raw = process.env.SYNC_CHAIN_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? new Set(ids) : null;
}
const CHAIN_IDS_IN_APP = new Set(CHAINS.map((c) => c.chainId));
const ERC8004_INDEXING_DISABLED_CHAIN_IDS = new Set<number>([9745]);
/** Chain IDs we sync: per-chain env, INFURA-covered chains, or any CHAINS id with a non-empty RPC_URLS entry (public fallback). Solana is indexed directly from finalized Solana JSON-RPC program accounts and MPL Core state. If SYNC_CHAIN_IDS is set, only those ids in CHAINS (operator override). */
export function getSyncableChainIds(): number[] {
  const allowList = getSyncChainIdsAllowList();
  if (allowList) {
    return [...allowList].filter((id) => CHAIN_IDS_IN_APP.has(id) && !ERC8004_INDEXING_DISABLED_CHAIN_IDS.has(id));
  }
  return CHAINS.map((c) => c.chainId).filter((id) => {
    if (ERC8004_INDEXING_DISABLED_CHAIN_IDS.has(id)) return false;
    if (id === SOLANA_CHAIN_ID) {
      return true;
    }
    const envVar = CHAIN_RPC_ENV[id];
    const url = envVar ? process.env[envVar] : null;
    if (url && String(url).trim().length > 0) return true;
    if (INFURA_KEYS.length > 0 && INFURA_CHAIN_IDS.has(id)) return true;
    const rpc = RPC_URLS[id];
    return Boolean(rpc && String(rpc).trim().length > 0);
  });
}
