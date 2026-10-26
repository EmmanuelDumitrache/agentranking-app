import { createHash } from "node:crypto";
import { z } from "zod";
import { timeoutSignal } from "@/lib/timing/abort";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import "server-only";
import {
  readExternalProviderCache,
  writeExternalProviderCache,
} from "@/lib/external-provider-cache";

const EtherscanNftTxSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
  result: z.union([
    z.array(z.object({
      hash: z.string(),
      blockNumber: z.string(),
      timeStamp: z.string(),
      to: z.string().optional().default(""),
      from: z.string().optional().default(""),
    })),
    z.string(),
  ]),
});

const EtherscanAddressTagSchema = z.object({
  status: z.string(),
  result: z.string(),
});
/** Why NFT transfer stats may be missing or zero — drives honest UI copy. */
export type EtherscanEnrichmentStatus =
  | "ok"
  | "no_api_key"
  | "no_onchain_transfer_data"
  | "explorer_api_error";
export interface EtherscanEnrichment {
  mintTx: string | null;
  mintBlock: string | null;
  mintDate: string | null;
  transferCount: number;
  explorerUrl: string;
  explorerName: string;
  ensName: string | null;
  ownerAddress: string | null;
  enrichmentStatus: EtherscanEnrichmentStatus;
}
const ETHERSCAN_CACHE_FRESH_SECONDS = 60 * 60;
const ETHERSCAN_CACHE_STALE_SECONDS = 24 * 60 * 60;
const ETHERSCAN_CACHE_MAX_BYTES = 16 * 1_024;
const CHAIN_EXPLORER_MAP: Record<number, { apiBase: string; explorerBase: string; name: string }> = {
  1:      { apiBase: "https://api.etherscan.io/api",              explorerBase: "https://etherscan.io",             name: "Etherscan" },
  8453:   { apiBase: "https://api.basescan.org/api",              explorerBase: "https://basescan.org",             name: "Basescan" },
  56:     { apiBase: "https://api.bscscan.com/api",               explorerBase: "https://bscscan.com",              name: "BscScan" },
  137:    { apiBase: "https://api.polygonscan.com/api",           explorerBase: "https://polygonscan.com",          name: "PolygonScan" },
  42161:  { apiBase: "https://api.arbiscan.io/api",               explorerBase: "https://arbiscan.io",              name: "Arbiscan" },
  10:     { apiBase: "https://api-optimistic.etherscan.io/api",   explorerBase: "https://optimistic.etherscan.io",  name: "Optimistic Etherscan" },
  43114:  { apiBase: "https://api.snowtrace.io/api",              explorerBase: "https://snowtrace.io",             name: "Snowtrace" },
  59144:  { apiBase: "https://api.lineascan.build/api",           explorerBase: "https://lineascan.build",          name: "LineaScan" },
  534352: { apiBase: "https://api.scrollscan.com/api",            explorerBase: "https://scrollscan.com",           name: "ScrollScan" },
  100:    { apiBase: "https://api.gnosisscan.io/api",             explorerBase: "https://gnosisscan.io",            name: "GnosisScan" },
  42220:  { apiBase: "https://api.celoscan.io/api",               explorerBase: "https://celoscan.io",              name: "CeloScan" },
  5000:   { apiBase: "https://api.mantlescan.xyz/api",            explorerBase: "https://mantlescan.xyz",           name: "MantleScan" },
  /* Blockscout / Etherscan-clone APIs — enrichment may be empty if the host differs from Etherscan v1. */
  360:    { apiBase: "https://api.shapescan.xyz/api",               explorerBase: "https://shapescan.xyz",            name: "ShapeScan" },
  2345:   { apiBase: "https://explorer.goat.network/api",         explorerBase: "https://explorer.goat.network",    name: "GOAT Explorer" },
  1088:   { apiBase: "https://andromeda-explorer.metis.io/api",   explorerBase: "https://andromeda-explorer.metis.io", name: "Metis Explorer" },
  1187947933: {
    apiBase: "https://skale-base-explorer.skalenodes.com/api",
    explorerBase: "https://skale-base-explorer.skalenodes.com",
    name: "SKALE Base Explorer",
  },
  143:    { apiBase: "https://monadscan.com/api",                 explorerBase: "https://monadscan.com",            name: "Monadscan" },
  167000: { apiBase: "https://api.taikoscan.io/api",             explorerBase: "https://taikoscan.io",             name: "TaikoScan" },
  9745:  { apiBase: "https://plasmascan.to/api",                explorerBase: "https://plasmascan.to",            name: "PlasmaScan" },
  4326:   { apiBase: "https://explorer.megaeth.com/api",         explorerBase: "https://explorer.megaeth.com",     name: "MegaETH Explorer" },
  2741:   { apiBase: "https://api.abscan.org/api",               explorerBase: "https://abscan.org",               name: "Abstract Explorer" },
  2046399126: {
    apiBase: "https://elated-tan-skat.explorer.mainnet.skalenodes.com/api",
    explorerBase: "https://elated-tan-skat.explorer.mainnet.skalenodes.com",
    name: "SKALE Europa Explorer",
  },
  1868: {
    apiBase: "https://soneium.blockscout.com/api",
    explorerBase: "https://soneium.blockscout.com",
    name: "Soneium Blockscout",
  },
  45056: {
    apiBase: "https://billions-blockscout.eu-north-2.gateway.fm/api",
    explorerBase: "https://billions-blockscout.eu-north-2.gateway.fm",
    name: "Billions Blockscout",
  },
  1776: {
    apiBase: "https://blockscout.injective.network/api",
    explorerBase: "https://blockscout.injective.network",
    name: "Injective Blockscout",
  },
  4217: {
    apiBase: "https://explore.tempo.xyz/api",
    explorerBase: "https://explore.tempo.xyz",
    name: "Tempo Explorer",
  },
  42: {
    apiBase: "https://explorer.execution.mainnet.lukso.network/api",
    explorerBase: "https://explorer.execution.mainnet.lukso.network",
    name: "LUKSO Explorer",
  },
  10088: {
    apiBase: "https://www.gatescan.org/gatelayer/api",
    explorerBase: "https://www.gatescan.org/gatelayer",
    name: "GateScan",
  },
};
export function getExplorerConfig(chainId: number) {
  return CHAIN_EXPLORER_MAP[chainId] ?? null;
}
async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<Response> {
  return fetch(url, { signal: timeoutSignal(timeoutMs) });
}
type NftTransferFetchStatus = "ok" | "no_rows" | "api_rejected" | "http_error" | "exception";
async function fetchNftTransfers(
  apiBase: string,
  contractAddress: string,
  tokenId: number,
  apiKey: string
): Promise<{
  mintTx: string | null;
  mintBlock: string | null;
  mintDate: string | null;
  transferCount: number;
  ownerAddress: string | null;
  fetchStatus: NftTransferFetchStatus;
}> {
  const params = new URLSearchParams({
    module: "account",
    action: "tokennfttx",
    contractaddress: contractAddress,
    tokenid: String(tokenId),
    page: "1",
    offset: "50",
    sort: "asc",
    apikey: apiKey,
  });
  const empty = {
    mintTx: null as string | null,
    mintBlock: null as string | null,
    mintDate: null as string | null,
    transferCount: 0,
    ownerAddress: null as string | null,
    fetchStatus: "no_rows" as NftTransferFetchStatus,
  };
  try {
    const res = await fetchWithTimeout(`${apiBase}?${params}`);
    if (!res.ok) return { ...empty, fetchStatus: "http_error" };
    const json = await parseBoundedJsonBody(res, EtherscanNftTxSchema, 2 * 1024 * 1024);
    if (json.status !== "1") {
      const resultStr = typeof json.result === "string" ? json.result : "";
      const combined = `${json.message ?? ""} ${resultStr}`.toLowerCase();
      const noRecords =
        combined.includes("no record") ||
        combined.includes("no transactions") ||
        combined.includes("no token transfer");
      return { ...empty, fetchStatus: noRecords ? "no_rows" : "api_rejected" };
    }
    if (!Array.isArray(json.result) || json.result.length === 0) {
      return { ...empty, fetchStatus: "no_rows" };
    }
    const firstTx = json.result[0];
    const lastTx = json.result.at(-1);
    const mintDate = firstTx.timeStamp
      ? new Date(Number.parseInt(firstTx.timeStamp, 10) * 1000).toISOString()
      : null;
    return {
      mintTx: firstTx.hash,
      mintBlock: firstTx.blockNumber,
      mintDate,
      transferCount: json.result.length,
      ownerAddress: lastTx?.to || null,
      fetchStatus: "ok",
    };
  } catch {
    return { ...empty, fetchStatus: "exception" };
  }
}
async function fetchEnsName(address: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    module: "account",
    action: "addresstag",
    address,
    apikey: apiKey,
  });
  try {
    const res = await fetchWithTimeout(`https://api.etherscan.io/api?${params}`);
    if (!res.ok) return null;
    const json = await parseBoundedJsonBody(
      res,
      EtherscanAddressTagSchema,
      256 * 1024,
    );
    if (json.status === "1" && json.result && json.result !== "0") {
      return json.result;
    }
    return null;
  } catch {
    return null;
  }
}
function resolveEnrichmentStatus(
  usingPlaceholderKey: boolean,
  fetchStatus: "ok" | "no_rows" | "api_rejected" | "http_error" | "exception",
  hasTransferSignal: boolean
): EtherscanEnrichmentStatus {
  if (!usingPlaceholderKey && fetchStatus === "ok" && hasTransferSignal) return "ok";
  if (usingPlaceholderKey) return "no_api_key";
  if (fetchStatus === "no_rows" || (fetchStatus === "ok" && !hasTransferSignal)) {
    return "no_onchain_transfer_data";
  }
  return "explorer_api_error";
}
async function fetchEnrichmentImpl(
  chainId: number,
  contractAddress: string,
  tokenId: number
): Promise<EtherscanEnrichment | null> {
  const cfg = CHAIN_EXPLORER_MAP[chainId];
  if (!cfg) return null;
  const apiKeyRaw = process.env.ETHERSCAN_API_KEY?.trim() ?? "";
  const usingPlaceholderKey = !apiKeyRaw || apiKeyRaw === "YourApiKeyToken";
  const apiKey = apiKeyRaw || "YourApiKeyToken";
  const explorerUrl = `${cfg.explorerBase}/nft/${contractAddress}/${tokenId}`;
  const transferData = await fetchNftTransfers(cfg.apiBase, contractAddress, tokenId, apiKey);
  let ensName: string | null = null;
  if (transferData.ownerAddress && !usingPlaceholderKey) {
    ensName = await fetchEnsName(transferData.ownerAddress, apiKey);
  }
  const hasTransferSignal =
    Boolean(transferData.mintTx) || transferData.transferCount > 0 || Boolean(transferData.mintDate);
  const enrichmentStatus = resolveEnrichmentStatus(
    usingPlaceholderKey,
    transferData.fetchStatus,
    hasTransferSignal,
  );
  return {
    mintTx: transferData.mintTx,
    mintBlock: transferData.mintBlock,
    mintDate: transferData.mintDate,
    transferCount: transferData.transferCount,
    explorerUrl,
    explorerName: cfg.name,
    ensName,
    ownerAddress: transferData.ownerAddress,
    enrichmentStatus,
  };
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function isEtherscanEnrichment(value: unknown): value is EtherscanEnrichment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Partial<EtherscanEnrichment>;
  return (
    isNullableString(row.mintTx) &&
    isNullableString(row.mintBlock) &&
    isNullableString(row.mintDate) &&
    typeof row.transferCount === "number" &&
    Number.isSafeInteger(row.transferCount) &&
    row.transferCount >= 0 &&
    typeof row.explorerUrl === "string" &&
    typeof row.explorerName === "string" &&
    isNullableString(row.ensName) &&
    isNullableString(row.ownerAddress) &&
    ["ok", "no_api_key", "no_onchain_transfer_data", "explorer_api_error"].includes(
      row.enrichmentStatus ?? "",
    )
  );
}
function etherscanCacheKey(
  chainId: number,
  contractAddress: string,
  tokenId: number,
): string {
  const apiKeyFingerprint = createHash("sha256")
    .update(process.env.ETHERSCAN_API_KEY?.trim() ?? "")
    .digest("hex")
    .slice(0, 12);
  const identity = `${chainId}:${contractAddress.toLowerCase()}:${tokenId}:${apiKeyFingerprint}`;
  return `etherscan:enrichment:${createHash("sha256").update(identity).digest("hex")}`;
}
export async function getEtherscanEnrichment(
  chainId: number,
  contractAddress: string,
  tokenId: number,
): Promise<EtherscanEnrichment | null> {
  if (!CHAIN_EXPLORER_MAP[chainId]) return null;
  const key = etherscanCacheKey(chainId, contractAddress, tokenId);
  const cached = await readExternalProviderCache({
    key,
    validate: isEtherscanEnrichment,
    freshTtlSeconds: ETHERSCAN_CACHE_FRESH_SECONDS,
    staleTtlSeconds: ETHERSCAN_CACHE_STALE_SECONDS,
    maxPayloadBytes: ETHERSCAN_CACHE_MAX_BYTES,
  });
  if (cached?.status === "fresh") return cached.value;
  const enrichment = await fetchEnrichmentImpl(chainId, contractAddress, tokenId);
  if (enrichment) {
    await writeExternalProviderCache({
      key,
      value: enrichment,
      validate: isEtherscanEnrichment,
      freshTtlSeconds: ETHERSCAN_CACHE_FRESH_SECONDS,
      staleTtlSeconds: ETHERSCAN_CACHE_STALE_SECONDS,
      maxPayloadBytes: ETHERSCAN_CACHE_MAX_BYTES,
    });
    return enrichment;
  }
  return cached?.value ?? null;
}
