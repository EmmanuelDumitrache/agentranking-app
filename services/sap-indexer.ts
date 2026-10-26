/**
 * Synapse Agent Protocol (SAP) read-only indexer — upserts OOBE SAP agents into Postgres via Prisma.
 *
 * - RPC: `agentAccount.all()` + per-account stats (primary).
 * - HTTP: `GET https://explorer.oobeprotocol.ai/api/v1/agents` mirrors any PDAs missing from the RPC snapshot
 *   so agents still become normal `Agent` rows (`sapVerified`, Solana chain) when Explorer lists agents the RPC batch skipped.
 *
 * RPC (see src/lib/sap-rpc-config.ts, src/lib/sap-rpc-client.ts):
 * - SYNAPSE_RPC_URL — primary Synapse / OOBE JSON-RPC
 * - SYNAPSE_API_KEY — optional; appended as api_key= when not already in URL
 * - SAP_RPC_FALLBACK_URL / SOLANA_RPC_FALLBACK_URL — optional generic Solana fallback
 * - SAP_PROGRAM_ID — optional override (defaults to SDK mainnet id).
 */
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import type { SapClient } from "@oobe-protocol-labs/synapse-sap-sdk/core";
import { deriveAgentStats } from "@oobe-protocol-labs/synapse-sap-sdk/pda";
import type {
  AgentAccountData,
  AgentStatsData,
  Capability,
  PricingTier,
} from "@oobe-protocol-labs/synapse-sap-sdk/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { computeAgentScore } from "@/lib/agent-score";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { capabilityKey } from "@/lib/sap-ecosystem-shared";
import { queueSapNewAgentNotifications } from "@/lib/sap-new-agent-notify";
import { listOobeExplorerAgents, type OobeExplorerAgentRow } from "@/lib/oobe-explorer-client";
import { resolveUniqueRegistryRowForSapIdentity } from "@/lib/sap-registry-twin-resolve";
import { collectUrlKeysForTwinMatch } from "@/lib/sap-twin-url-keys";
import { resolveImageUrl } from "@/lib/image-utils";
import { fetchRegistrationDocument } from "@/lib/registration-document";
import {
  createSapClientWithFallback,
  resolveSapProgramId,
} from "@/lib/sap-rpc-client";
import { redactRpcUrlForLogs } from "@/lib/sap-rpc-config";
import { mergeCovenantProtocols } from "@/lib/covenant/detect";
import {
  COVENANT_DETECTED_AT_KEY,
  COVENANT_RUNTIME_PROTOCOL,
} from "@/lib/covenant/config";
import { touchCovenantDetectionMetadata } from "./covenant-verification";
import { forEachWithConcurrency, mapWithConcurrency } from "@/lib/async-pool";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";
import {
  updateAgentServicesInBulk,
  type AgentServiceUpdate,
} from "@/worker/indexer/sync/relation-diff";
import {
  acquireSolanaAgentIdentityLocks,
  acquireSolanaCompatibilityIdAllocatorLock,
  acquireSolanaSnapshotWriterFence,
} from "@/worker/indexer/sync/solana-agent-locks";
/** Default Prisma interactive tx is 5s; under Explorer reconcile parallelism, twin-resolution scans exceed that. */
const SAP_INDEXER_PRISMA_TX = { maxWait: 20_000, timeout: 120_000 } as const;
const SAP_EXISTING_LOOKUP_BATCH_SIZE = 5_000;
const SAP_URI_REFRESH_WINDOW_MS = 4 * 60 * 60 * 1_000;
const SAP_URI_REFRESH_SHARDS = 6;
const SAP_URI_FETCHED_AT_KEY = "sapUriFetchedAt";
const SAP_PROJECTION_DIGEST_KEY = "sapProjectionDigest";
const SAP_ERROR_DETAIL_LIMIT = 250;
const SAP_NEW_AGENT_LOG_LIMIT = 250;
const SAP_PROCESS_PAGE_SIZE = 2_000;
const SAP_STABLE_TOUCH_INTERVAL_MS = 20 * 60 * 60 * 1_000;
const SAP_STATS_RPC_BATCH_SIZE = 99;
const SAP_STATS_RPC_CONCURRENCY = 4;
type SapIndexerError = { pda?: string; message: string };
function appendSapError(errors: SapIndexerError[], error: SapIndexerError): void {
  if (errors.length < SAP_ERROR_DETAIL_LIMIT) errors.push(error);
}
function getSapIndexerConcurrency(): number {
  const raw = process.env.SAP_INDEXER_CONCURRENCY?.trim();
  if (raw === "" || raw === "0") return 1;
  const n = raw ? Number.parseInt(raw, 10) : 8;
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(32, n);
}
function sanitizePg(s: string): string {
  return s.replace(/\0/g, "");
}
function bnToString(v: { toString(base?: number): string } | bigint | number): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.trunc(v)) : "0";
  return v.toString(10);
}
function serializeTier(t: PricingTier): Record<string, unknown> {
  return {
    tierId: t.tierId,
    pricePerCall: bnToString(t.pricePerCall),
    minPricePerCall: t.minPricePerCall ? bnToString(t.minPricePerCall) : "",
    maxPricePerCall: t.maxPricePerCall ? bnToString(t.maxPricePerCall) : "",
    rateLimit: t.rateLimit,
    maxCallsPerSession: t.maxCallsPerSession,
    burstLimit: t.burstLimit,
    tokenType: t.tokenType,
    tokenMint: t.tokenMint?.toBase58() ?? null,
    tokenDecimals: t.tokenDecimals,
    settlementMode:
      t.settlementMode == null
        ? null
        : typeof t.settlementMode === "object"
          ? { ...(t.settlementMode as object) }
          : t.settlementMode,
    minEscrowDeposit: t.minEscrowDeposit ? bnToString(t.minEscrowDeposit) : null,
    batchIntervalSec: t.batchIntervalSec,
    volumeCurve: t.volumeCurve?.map((b) => ({
      afterCalls: b.afterCalls,
      pricePerCall: bnToString(b.pricePerCall),
    })) ?? null,
  };
}
function serializeCapability(c: Capability): Record<string, unknown> {
  return {
    id: c.id,
    protocol: c.protocolId ?? "",
    version: c.version ?? "",
    description: c.description ?? "",
  };
}
function serializeStats(s: AgentStatsData): Record<string, unknown> {
  return {
    bump: s.bump,
    agent: s.agent.toBase58(),
    wallet: s.wallet.toBase58(),
    totalCallsServed: bnToString(s.totalCallsServed),
    isActive: s.isActive,
    updatedAt: bnToString(s.updatedAt),
  };
}
/** Combined payload: raw stats account + identity fields useful for profile UI. */
function buildSapStatsJson(
  stats: AgentStatsData | null,
  identity: AgentAccountData,
): Prisma.InputJsonValue {
  const base: Record<string, unknown> = {
    identityName: sanitizePg(String(identity.name ?? "")),
    identityDescription: sanitizePg(String(identity.description ?? "")),
    identityAgentUri: sanitizePg(String(identity.agentUri ?? "")),
    identityIsActive: identity.isActive,
    identityReputationScore: identity.reputationScore,
    identityTotalCallsServed: bnToString(identity.totalCallsServed),
    identityTotalFeedbacks: identity.totalFeedbacks,
  };
  if (stats) base.agentStatsPda = serializeStats(stats);
  return base as Prisma.InputJsonValue;
}

// --- Relational projections (AgentSapCapability child table + native columns) ---

type SapCapabilityProjection = {
  ordinal: number;
  capabilityKey: string;
  capabilityId: string;
  protocol: string;
  version: string;
  description: string;
};

/** Concrete create/update-compatible native projection fields. */
type SapNativeProjections = {
  sapCapabilityCount: number;
  sapMinPricePerCall: string | null;
  sapPricingTierCount: number;
  sapPrimaryTierId: string | null;
  sapIdentityName: string;
  sapIdentityIsActive: boolean;
  sapReputationScore: number;
  sapIdentityTotalCallsServed: string | null;
  sapIdentityTotalFeedbacks: number;
  sapStatsTotalCallsServed: string | null;
  sapStatsActive: boolean | null;
  sapStatsUpdatedAt: Date | null;
};

function capabilityProjectionRows(capabilities: Capability[]): SapCapabilityProjection[] {
  return capabilities.map((c, ordinal) => ({
    ordinal,
    capabilityKey: capabilityKey({
      id: c.id,
      protocol: c.protocolId ?? "",
      version: c.version ?? "",
    }),
    capabilityId: String(c.id ?? ""),
    protocol: String(c.protocolId ?? ""),
    version: String(c.version ?? ""),
    description: String(c.description ?? ""),
  }));
}

function explorerCapabilityProjectionRows(capabilities: unknown[]): SapCapabilityProjection[] {
  return capabilities.map((c, ordinal) => {
    const x = c as Record<string, unknown>;
    return {
      ordinal,
      capabilityKey: capabilityKey({
        id: String(x.id ?? ""),
        protocol: String(x.protocol ?? x.protocolId ?? ""),
        version: String(x.version ?? ""),
      }),
      capabilityId: String(x.id ?? ""),
      protocol: String(x.protocol ?? x.protocolId ?? ""),
      version: String(x.version ?? ""),
      description: String(x.description ?? ""),
    };
  });
}

async function replaceSapCapabilities(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  capabilities: SapCapabilityProjection[],
): Promise<void> {
  await tx.agentSapCapability.deleteMany({ where: { agentDbId } });
  if (capabilities.length === 0) return;
  await tx.agentSapCapability.createMany({
    data: capabilities.map((c) => ({ agentDbId, ...c })),
  });
}

function sapStatsProjections(
  stats: AgentStatsData | null,
  identity: AgentAccountData,
): Pick<SapNativeProjections,
  "sapIdentityName" | "sapIdentityIsActive" | "sapReputationScore"
  | "sapIdentityTotalCallsServed" | "sapIdentityTotalFeedbacks"
  | "sapStatsTotalCallsServed" | "sapStatsActive" | "sapStatsUpdatedAt"> {
  return {
    sapIdentityName: sanitizePg(String(identity.name ?? "")),
    sapIdentityIsActive: identity.isActive,
    sapReputationScore: identity.reputationScore,
    sapIdentityTotalCallsServed: bnToString(identity.totalCallsServed),
    sapIdentityTotalFeedbacks: identity.totalFeedbacks,
    sapStatsTotalCallsServed: stats ? bnToString(stats.totalCallsServed) : null,
    sapStatsActive: stats?.isActive ?? null,
    sapStatsUpdatedAt: stats?.updatedAt != null ? new Date(Number(stats.updatedAt) * 1000) : null,
  };
}

function sapStatsProjectionsExplorer(
  stats: AgentStatsData | null,
  parsed: ParsedExplorerIdentity,
): Pick<SapNativeProjections,
  "sapIdentityName" | "sapIdentityIsActive" | "sapReputationScore"
  | "sapIdentityTotalCallsServed" | "sapIdentityTotalFeedbacks"
  | "sapStatsTotalCallsServed" | "sapStatsActive" | "sapStatsUpdatedAt"> {
  return {
    sapIdentityName: sanitizePg(parsed.name),
    sapIdentityIsActive: parsed.isActive,
    sapReputationScore: parsed.reputationScore,
    sapIdentityTotalCallsServed: parsed.totalCallsServedStr || null,
    sapIdentityTotalFeedbacks: parsed.totalFeedbacks,
    sapStatsTotalCallsServed: stats ? bnToString(stats.totalCallsServed) : null,
    sapStatsActive: stats?.isActive ?? null,
    sapStatsUpdatedAt: stats?.updatedAt != null ? new Date(Number(stats.updatedAt) * 1000) : null,
  };
}

function sapPricingProjections(pricing: PricingTier[]): Pick<
  SapNativeProjections,
  "sapMinPricePerCall" | "sapPricingTierCount" | "sapPrimaryTierId"
> {
  let minPrice: string | null = null;
  for (const t of pricing) {
    if (t.pricePerCall == null) continue;
    const raw = bnToString(t.pricePerCall);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    if (minPrice == null || parsed < Number(minPrice)) minPrice = raw;
  }
  return {
    sapMinPricePerCall: minPrice,
    sapPricingTierCount: pricing.length,
    sapPrimaryTierId: pricing[0]?.tierId ?? null,
  };
}

function explorerPricingProjections(pricing: unknown): Pick<
  SapNativeProjections,
  "sapMinPricePerCall" | "sapPricingTierCount" | "sapPrimaryTierId"
> {
  if (!Array.isArray(pricing)) {
    return { sapMinPricePerCall: null, sapPricingTierCount: 0, sapPrimaryTierId: null };
  }
  let minPrice: string | null = null;
  for (const t of pricing) {
    const x = t as Record<string, unknown>;
    const raw = typeof x.pricePerCall === "string" ? x.pricePerCall : "";
    if (!raw.trim()) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    if (minPrice == null || parsed < Number(minPrice)) minPrice = raw;
  }
  const primary = pricing[0] as Record<string, unknown> | undefined;
  return {
    sapMinPricePerCall: minPrice,
    sapPricingTierCount: pricing.length,
    sapPrimaryTierId: primary?.tierId != null ? String(primary.tierId) : null,
  };
}
function parseNumericAgentId(raw: string | null): number | null {
  const value = raw?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
async function fetchRegistrationTxSig(connection: Connection, agentPda: PublicKey): Promise<string | null> {
  try {
    let before: string | undefined;
    let earliest: string | null = null;
    while (true) {
      const sigs = await connection.getSignaturesForAddress(agentPda, {
        before,
        limit: 1_000,
      });
      if (sigs.length === 0) return earliest;
      earliest = sigs[sigs.length - 1]?.signature ?? earliest;
      if (sigs.length < 1_000) return earliest;
      before = earliest ?? undefined;
      if (!before) return null;
    }
  } catch {
    return null;
  }
}
function extractImageFromMetadataJson(json: Record<string, unknown>): string {
  for (const key of ["image", "avatar", "icon"] as const) {
    const value = json[key];
    if (typeof value !== "string") continue;
    const resolved = resolveImageUrl(value);
    if (resolved) return resolved;
  }
  return "";
}
type SapUriMetadata = { image?: string; name?: string; description?: string };
async function fetchUriJson(
  uri: string | null,
): Promise<SapUriMetadata | null> {
  if (!uri?.trim()) return null;
  const json = await fetchRegistrationDocument<Record<string, unknown>>(uri, {
    httpsTimeoutMs: 10_000,
    ipfsTimeoutMs: 22_000,
    maxBytes: 1_048_576,
  });
  if (!json) return null;
  const name = typeof json.name === "string" ? json.name : undefined;
  const description =
    typeof json.description === "string" ? json.description : undefined;
  const image = extractImageFromMetadataJson(json);
  return { image, name, description };
}
async function ensureSolanaChainRow(): Promise<void> {
  const chainConfig = getChainByChainId(SOLANA_CHAIN_ID);
  if (!chainConfig) throw new Error("Solana chain config missing");
  await prisma.chain.upsert({
    where: { chainId: SOLANA_CHAIN_ID },
    create: {
      chainId: SOLANA_CHAIN_ID,
      name: chainConfig.name,
      shortName: chainConfig.shortName,
      icon: chainConfig.icon ?? "",
      color: chainConfig.color ?? "#9945FF",
      identityRegistry: chainConfig.identityRegistry ?? "",
      reputationRegistry: chainConfig.reputationRegistry ?? "",
    },
    update: {},
  });
}
async function nextSolanaAgentId(tx: Prisma.TransactionClient): Promise<number> {
  const agg = await tx.agent.aggregate({
    where: { chainId: SOLANA_CHAIN_ID },
    _max: { agentId: true },
  });
  return (agg._max.agentId ?? 0) + 1;
}
type StoredSapAgentState = {
  id: number;
  binanceCompatible: boolean;
  projectionDigest: string | null;
  covenantDetected: boolean;
  sapLastSyncedAt: Date | null;
  sapUriFetchedAtMs: number | null;
  registrationTx: string | null;
  agentURI: string;
  name: string;
  description: string;
  image: string;
};
function sapUriRefreshShard(pda: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < pda.length; index += 1) {
    hash ^= pda.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % SAP_URI_REFRESH_SHARDS;
}
function storedSapUriProfile(
  pda: string,
  agentURI: string | null,
  state: StoredSapAgentState | undefined,
  nowMs = Date.now(),
): SapUriMetadata | null {
  if (!state || state.agentURI.trim() !== (agentURI?.trim() ?? "")) return null;
  const refreshAgeMs = SAP_URI_REFRESH_WINDOW_MS * SAP_URI_REFRESH_SHARDS;
  if (
    state.sapUriFetchedAtMs != null &&
    nowMs - state.sapUriFetchedAtMs < refreshAgeMs
  ) {
    return { name: state.name, description: state.description, image: state.image };
  }
  const currentShard = Math.floor(nowMs / SAP_URI_REFRESH_WINDOW_MS) % SAP_URI_REFRESH_SHARDS;
  if (sapUriRefreshShard(pda) === currentShard) return null;
  return { name: state.name, description: state.description, image: state.image };
}
async function loadStoredSapAgentStates(
  pdas: readonly string[],
): Promise<Map<string, StoredSapAgentState>> {
  const uniquePdas = [...new Set(pdas.filter(Boolean))];
  const states = new Map<string, StoredSapAgentState>();
  for (let offset = 0; offset < uniquePdas.length; offset += SAP_EXISTING_LOOKUP_BATCH_SIZE) {
    const batch = uniquePdas.slice(offset, offset + SAP_EXISTING_LOOKUP_BATCH_SIZE);
    const rows = await prisma.agent.findMany({
      where: {
        sapAgentPda: { in: batch },
      },
      select: {
        id: true,
        binanceCompatible: true,
        sapAgentPda: true,
        sapRegistrationTx: true,
        sapLastSyncedAt: true,
        agentURI: true,
        name: true,
        description: true,
        image: true,
        metadata: {
          where: {
            key: {
              in: [
                SAP_PROJECTION_DIGEST_KEY,
                SAP_URI_FETCHED_AT_KEY,
                COVENANT_DETECTED_AT_KEY,
              ],
            },
          },
          select: { key: true, value: true, sourceKind: true },
        },
      },
    });
    for (const row of rows) {
      const pda = row.sapAgentPda?.trim();
      const registrationTx = row.sapRegistrationTx?.trim() || null;
      if (pda) {
        states.set(pda, {
          id: row.id,
          binanceCompatible: row.binanceCompatible,
          projectionDigest:
            row.metadata.find(
              (entry) =>
                entry.key === SAP_PROJECTION_DIGEST_KEY && entry.sourceKind === "sap",
            )?.value ?? null,
          covenantDetected: row.metadata.some(
            (entry) => entry.key === COVENANT_DETECTED_AT_KEY,
          ),
          sapLastSyncedAt: row.sapLastSyncedAt,
          sapUriFetchedAtMs: (() => {
            const raw = row.metadata.find(
              (entry) =>
                entry.key === SAP_URI_FETCHED_AT_KEY && entry.sourceKind === "sap",
            )?.value;
            const parsed = raw == null ? Number.NaN : Date.parse(raw);
            return Number.isFinite(parsed) ? parsed : null;
          })(),
          registrationTx,
          agentURI: row.agentURI,
          name: row.name,
          description: row.description,
          image: row.image,
        });
      }
    }
  }
  return states;
}

async function touchSapUriFetchMetadata(
  agentIds: readonly number[],
  observedAt: Date,
): Promise<void> {
  const uniqueAgentIds = [...new Set(agentIds)];
  if (uniqueAgentIds.length === 0) return;
  const value = observedAt.toISOString();
  const existing = await prisma.agentMetadata.findMany({
    where: {
      agentId: { in: uniqueAgentIds },
      key: SAP_URI_FETCHED_AT_KEY,
      sourceKind: "sap",
    },
    select: { agentId: true },
    distinct: ["agentId"],
  });
  const existingIds = new Set(existing.map((row) => row.agentId));
  const missingIds = uniqueAgentIds.filter((agentId) => !existingIds.has(agentId));
  const updateExisting = prisma.agentMetadata.updateMany({
    where: {
      agentId: { in: uniqueAgentIds },
      key: SAP_URI_FETCHED_AT_KEY,
      sourceKind: "sap",
    },
    data: { value },
  });
  if (missingIds.length === 0) {
    await updateExisting;
    return;
  }
  await prisma.$transaction([
    updateExisting,
    prisma.agentMetadata.createMany({
      data: missingIds.map((agentId) => ({
        agentId,
        key: SAP_URI_FETCHED_AT_KEY,
        value,
        sourceKind: "sap",
      })),
    }),
  ]);
}
export type SapIndexerResult = {
  ok: boolean;
  agentsFound: number;
  agentsUpserted: number;
  errors: Array<{ pda?: string; message: string }>;
  durationMs: number;
  covenantVerification?: import("./covenant-verification").CovenantVerificationBatchResult;
  message?: string;
  /** Which RPC endpoint served the SAP SDK probe for this run. */
  rpcSource?: "synapse" | "fallback";
  /** Total per-agent and reconcile failures; `errors` retains only a bounded diagnostic sample. */
  agentsFailed?: number;
  /** Agents upserted from `GET /api/v1/agents` that were not in the RPC `agentAccount.all()` snapshot. */
  explorerMirrorUpserted?: number;
  /** OOBE rows not successfully upserted via RPC in this run. */
  oobeReconcileOnlyCount?: number;
  /** Present when `SAP_INDEXER_OOBE_DRIFT_CHECK=true` — B1 Explorer vs DB PDA set comparison. */
  oobeExplorerDrift?: {
    explorerAgentCount: number;
    dbSapAgentCount: number;
    onlyInExplorer: string[];
    onlyInDb: string[];
    driftCheckError?: string;
  };
};
type AgentAccountRow = { publicKey: PublicKey; account: AgentAccountData };
type AgentAccountNamespace = {
  all(): Promise<AgentAccountRow[]>;
};
type AgentStatsAccountNamespace = {
  fetchMultiple(addresses: PublicKey[]): Promise<Array<AgentStatsData | null>>;
};
type SapStatsFetchResult =
  | { stats: AgentStatsData | null }
  | { error: unknown };
function isProviderWideSapRpcError(error: unknown): boolean {
  const message = Error.isError(error) ? error.message : String(error);
  return /(?:\b(?:401|403|429|502|503|504)\b|too many requests|request too fast|rate.?limit|quota|capacity limit|max(?:imum)? usage|usage limit|authentication failed|unauthori[sz]ed|forbidden|service unavailable|gateway timeout)/i.test(message);
}
function isAgentAccountNamespace(value: unknown): value is AgentAccountNamespace {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "all") === "function";
}
async function fetchAllAgentAccounts(client: SapClient): Promise<AgentAccountRow[]> {
  const accountNamespaces = client.program.account as unknown as Record<string, unknown>;
  const namespace = accountNamespaces.agentAccount;
  if (!isAgentAccountNamespace(namespace)) {
    throw new Error("SAP SDK agentAccount.all() unavailable");
  }
  return namespace.all();
}
function agentStatsAccountNamespace(client: SapClient): AgentStatsAccountNamespace | null {
  const accountNamespaces = client.program.account as unknown as Record<string, unknown>;
  const namespace = accountNamespaces.agentStats;
  if (typeof namespace !== "object" || namespace === null) return null;
  return typeof Reflect.get(namespace, "fetchMultiple") === "function"
    ? (namespace as AgentStatsAccountNamespace)
    : null;
}
async function fetchAgentStatsPage(
  client: SapClient,
  programId: PublicKey,
  rows: readonly AgentAccountRow[],
): Promise<SapStatsFetchResult[]> {
  const namespace = agentStatsAccountNamespace(client);
  if (!namespace) {
    return mapWithConcurrency(rows, SAP_STATS_RPC_CONCURRENCY, async (row) => {
      try {
        return { stats: await client.agent.fetchStatsNullable(row.publicKey) };
      } catch (error) {
        return { error };
      }
    });
  }
  const results = new Array<SapStatsFetchResult>(rows.length);
  const batches: Array<{ offset: number; rows: readonly AgentAccountRow[] }> = [];
  for (let offset = 0; offset < rows.length; offset += SAP_STATS_RPC_BATCH_SIZE) {
    batches.push({
      offset,
      rows: rows.slice(offset, offset + SAP_STATS_RPC_BATCH_SIZE),
    });
  }
  await forEachWithConcurrency(
    batches,
    SAP_STATS_RPC_CONCURRENCY,
    async (batch) => {
      try {
        const statsPdas = batch.rows.map(
          (row) => deriveAgentStats(row.publicKey, programId)[0],
        );
        const decoded = await namespace.fetchMultiple(statsPdas);
        for (let index = 0; index < batch.rows.length; index += 1) {
          results[batch.offset + index] = { stats: decoded[index] ?? null };
        }
      } catch (error) {
        if (isProviderWideSapRpcError(error)) {
          // A provider-wide outage/quota failure will fail every single-account
          // retry too. Abort the RPC page so the caller can switch the remaining
          // work to the OOBE HTTP mirror instead of multiplying failed requests.
          throw error;
        }
        // Preserve per-agent isolation for request-shape/size failures where a
        // provider may reject fetchMultiple while accepting individual reads.
        await forEachWithConcurrency(
          batch.rows,
          Math.min(2, SAP_STATS_RPC_CONCURRENCY),
          async (row, index) => {
            try {
              results[batch.offset + index] = {
                stats: await client.agent.fetchStatsNullable(row.publicKey),
              };
            } catch (fallbackError) {
              results[batch.offset + index] = { error: fallbackError };
            }
          },
        );
      }
    },
  );
  return results;
}
type SapUpsertNotice = {
  isNew: true;
  agentDbId: number;
  agentId: number;
  name: string;
  sapAgentPda: string;
  capabilityKeys: string[];
  chainId: number;
};
type SapUpsertOutcome =
  | { kind: "stable"; agentDbId: number; touchDue: boolean }
  | { kind: "upserted"; agentDbId: number; notice: SapUpsertNotice | null };
async function upsertAgentRow(
  programId: PublicKey,
  agentPda: PublicKey,
  identity: AgentAccountData,
  stats: AgentStatsData | null,
  registrationTx: string | null,
  uriMeta: SapUriMetadata | null,
  storedState?: StoredSapAgentState,
  observedAt = new Date(),
): Promise<SapUpsertOutcome> {
  const pdaStr = agentPda.toBase58();
  const [statsPdaPk] = deriveAgentStats(agentPda, programId);
  const statsPdaStr = statsPdaPk.toBase58();
  const walletStr = identity.wallet.toBase58();
  const name = sanitizePg(uriMeta?.name ?? identity.name ?? `SAP Agent ${pdaStr.slice(0, 8)}`);
  const description = sanitizePg(uriMeta?.description ?? identity.description ?? "");
  const image = sanitizePg(uriMeta?.image ?? "");
  const x402Endpoint = identity.x402Endpoint?.trim() || null;
  const x402Support = Boolean(x402Endpoint);
  const agentURI = sanitizePg(identity.agentUri ?? "");
  const capabilitiesJson = identity.capabilities.map((c) => serializeCapability(c)) as unknown as Prisma.InputJsonValue;
  const pricingJson = serializePricing(identity.pricing) as unknown as Prisma.InputJsonValue;
  const protocols = mergeCovenantProtocols(
    identity.protocols.map((p) => sanitizePg(p)),
    identity.capabilities,
  );
  const createdAtSec = identity.createdAt.toNumber();
  const sapRegisteredAt = new Date(createdAtSec * 1000);
  const services: Array<{ name: string; endpoint: string }> = [];
  if (x402Endpoint) services.push({ name: "X402", endpoint: x402Endpoint });
  if (agentURI) services.push({ name: "WEB", endpoint: agentURI });
  const metadataEntries: Array<{ key: string; value: string }> = [
    { key: "sapRegistry", value: "synapse" },
    ...identity.capabilities.slice(0, 5).map((c) => ({
      key: `sap_cap:${c.id}`,
      value: sanitizePg(c.description ?? "").slice(0, 500),
    })),
  ];
  const scoreWallet = walletStr ? 100 : 0;
  const totalFeedback = identity.totalFeedbacks;
  const scoreQuality = Math.min(100, Math.max(0, identity.reputationScore));
  const sapStatsJson = buildSapStatsJson(stats, identity);
  const capabilityRows = capabilityProjectionRows(identity.capabilities);
  const sapProjections: SapNativeProjections = {
    sapCapabilityCount: capabilityRows.length,
    ...sapPricingProjections(identity.pricing),
    ...sapStatsProjections(stats, identity),
  };
  const buildProjection = (binanceCompatible: boolean) => {
    const scores = computeAgentScore({
      name,
      description,
      image,
      metadata: metadataEntries,
      services,
      scoreWallet,
      x402Support,
      binanceCompatible,
      totalFeedback,
      scoreQuality,
      lastActiveAt: observedAt,
    });
    const score = Math.min(100, Math.max(0, scores.score));
    const hotScore = Math.min(100, Math.max(0, scores.hotScore));
    const stableBaseData: Prisma.AgentUncheckedUpdateInput = {
      name,
      description,
      image,
      agentURI,
      owner: sanitizePg(walletStr),
      isActive: identity.isActive && (stats?.isActive ?? identity.isActive),
      x402Support,
      listingRegistrySource: "sap",
      sapVerified: true,
      sapAgentPda: pdaStr,
      sapStatsPda: statsPdaStr,
      sapCapabilities: capabilitiesJson,
      sapPricingTiers: pricingJson,
      sapProtocols: protocols,
      sapX402Endpoint: x402Endpoint,
      sapRegistrationTx: registrationTx,
      sapStats: sapStatsJson,
      sapOwnerWallet: walletStr,
      sapRegisteredAt,
      ...sapProjections,
      score,
      hotScore,
      scoreWallet,
      scoreMetadata: scores.scoreMetadata,
      scoreServices: scores.scoreEndpoints,
      scoreQuality,
      scorePopularity: scores.scorePopularity,
      scoreFreshness: scores.scoreFreshness,
      totalFeedback,
    };
    const projectionDigest = createHash("sha256")
      .update(JSON.stringify({ agent: stableBaseData, services, metadata: metadataEntries }))
      .digest("hex");
    return {
      stableBaseData,
      scores,
      score,
      hotScore,
      projectionDigest,
      managedMetadataEntries: [
        ...metadataEntries,
        { key: SAP_PROJECTION_DIGEST_KEY, value: projectionDigest },
      ],
      baseData: {
        ...stableBaseData,
        sapLastSyncedAt: observedAt,
        lastActiveAt: observedAt,
      } satisfies Prisma.AgentUncheckedUpdateInput,
    };
  };
  type SapProjection = ReturnType<typeof buildProjection>;
  let defaultProjection: SapProjection | undefined;
  let binanceProjection: SapProjection | undefined;
  const projectionFor = (binanceCompatible: boolean): SapProjection => {
    const cached = binanceCompatible ? binanceProjection : defaultProjection;
    if (cached) return cached;
    const projection = buildProjection(binanceCompatible);
    if (binanceCompatible) binanceProjection = projection;
    else defaultProjection = projection;
    return projection;
  };
  if (storedState) {
    const priorProjection = projectionFor(storedState.binanceCompatible);
    const covenantMarkerReady =
      !protocols.includes(COVENANT_RUNTIME_PROTOCOL) || storedState.covenantDetected;
    if (
      storedState.projectionDigest === priorProjection.projectionDigest &&
      covenantMarkerReady
    ) {
      const lastTouchedAt = storedState.sapLastSyncedAt?.getTime() ?? 0;
      return {
        kind: "stable",
        agentDbId: storedState.id,
        touchDue: observedAt.getTime() - lastTouchedAt >= SAP_STABLE_TOUCH_INTERVAL_MS,
      };
    }
  }
  const sapLockIdentities = [
    `sap-pda:${pdaStr}`,
    `wallet:${walletStr}`,
    ...collectUrlKeysForTwinMatch({
      agentURI,
      sapX402Endpoint: x402Endpoint,
      services,
    }).map((key) => `listing:${key}`),
  ];
  const notice = await prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, sapLockIdentities);
    const byPda = await tx.agent.findUnique({
      where: { sapAgentPda: pdaStr },
      select: {
        id: true,
        agentId: true,
        chainId: true,
        sapAgentPda: true,
        binanceCompatible: true,
        metadata: {
          where: { key: SAP_PROJECTION_DIGEST_KEY, sourceKind: "sap" },
          select: { value: true },
          take: 1,
        },
      },
    });
    const candidateId = parseNumericAgentId(identity.agentId);
    const registryResolved =
      !byPda
        ? await resolveUniqueRegistryRowForSapIdentity(tx, {
            displayName: name,
            agentURI,
            sapX402Endpoint: x402Endpoint,
            services,
          })
        : null;
    const registryRow = registryResolved
      ? await tx.agent.findUnique({
        where: { id: registryResolved.id },
        select: { id: true, agentId: true, chainId: true, binanceCompatible: true },
      })
      : null;
    const binanceCompatible = byPda?.binanceCompatible ?? registryRow?.binanceCompatible ?? false;
    const {
      projectionDigest,
      managedMetadataEntries,
      baseData,
      scores,
      score,
      hotScore,
    } =
      projectionFor(binanceCompatible);
    if (byPda) {
      if (byPda.metadata[0]?.value === projectionDigest) {
        await tx.agent.update({
          where: { id: byPda.id },
          data: { sapLastSyncedAt: observedAt, lastActiveAt: observedAt },
        });
        await touchCovenantDetectionMetadata(tx, byPda.id, protocols, identity.capabilities);
        return { agentDbId: byPda.id, notice: null };
      }
      await tx.agent.update({
        where: { id: byPda.id },
        data: {
          ...baseData,
          agentId: byPda.agentId,
          chainId: byPda.chainId,
        },
      });
      await replaceServices(tx, byPda.id, services);
      await replaceSapCapabilities(tx, byPda.id, capabilityRows);
      await replaceSapMetadata(tx, byPda.id, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, byPda.id, protocols, identity.capabilities);
      await persistAgentScoresById(tx, byPda.id);
      return { agentDbId: byPda.id, notice: null };
    }
    if (registryRow) {
      const attachPayload = { ...baseData };
      delete attachPayload.listingRegistrySource;
      await tx.agent.update({
        where: { id: registryRow.id },
        data: {
          ...attachPayload,
          agentId: registryRow.agentId,
          chainId: registryRow.chainId,
        },
      });
      await replaceServices(tx, registryRow.id, services);
      await replaceSapCapabilities(tx, registryRow.id, capabilityRows);
      await replaceSapMetadata(tx, registryRow.id, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, registryRow.id, protocols, identity.capabilities);
      await persistAgentScoresById(tx, registryRow.id);
      return { agentDbId: registryRow.id, notice: null };
    }
    await acquireSolanaCompatibilityIdAllocatorLock(tx);
    let agentIdToUse: number;
    let updateRowId: number | null = null;
    if (candidateId != null) {
      const collision = await tx.agent.findUnique({
        where: { agentId_chainId: { agentId: candidateId, chainId: SOLANA_CHAIN_ID } },
        select: { id: true, agentId: true, sapAgentPda: true },
      });
      if (!collision) {
        agentIdToUse = candidateId;
      } else if (collision.sapAgentPda === pdaStr) {
        updateRowId = collision.id;
        agentIdToUse = collision.agentId;
      } else {
        // Another SAP row already owns this agentId; preserve that association.
        agentIdToUse = await nextSolanaAgentId(tx);
      }
    } else {
      agentIdToUse = await nextSolanaAgentId(tx);
    }
    if (updateRowId != null) {
      await tx.agent.update({
        where: { id: updateRowId },
        data: { ...baseData, agentId: agentIdToUse, chainId: SOLANA_CHAIN_ID },
      });
      await replaceServices(tx, updateRowId, services);
      await replaceSapCapabilities(tx, updateRowId, capabilityRows);
      await replaceSapMetadata(tx, updateRowId, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, updateRowId, protocols, identity.capabilities);
      await persistAgentScoresById(tx, updateRowId);
      return { agentDbId: updateRowId, notice: null };
    }
    const created = await tx.agent.create({
      data: {
        agentId: agentIdToUse,
        chainId: SOLANA_CHAIN_ID,
        name,
        description,
        image,
        agentURI,
        owner: sanitizePg(walletStr),
        isActive: identity.isActive && (stats?.isActive ?? identity.isActive),
        x402Support,
        listingRegistrySource: "sap",
        sapVerified: true,
        sapAgentPda: pdaStr,
        sapStatsPda: statsPdaStr,
        sapCapabilities: capabilitiesJson,
        sapPricingTiers: pricingJson,
        sapProtocols: protocols,
        sapX402Endpoint: x402Endpoint,
        sapRegistrationTx: registrationTx,
        sapLastSyncedAt: observedAt,
        sapStats: sapStatsJson,
        sapOwnerWallet: walletStr,
        sapRegisteredAt: sapRegisteredAt,
        ...sapProjections,
        score,
        hotScore,
        scoreWallet,
        scoreMetadata: scores.scoreMetadata,
        scoreServices: scores.scoreEndpoints,
        scoreQuality,
        scorePopularity: scores.scorePopularity,
        scoreFreshness: scores.scoreFreshness,
        totalFeedback,
        lastActiveAt: observedAt,
      },
    });
    await replaceServices(tx, created.id, services);
    await replaceSapCapabilities(tx, created.id, capabilityRows);
    await replaceSapMetadata(tx, created.id, managedMetadataEntries);
    await touchCovenantDetectionMetadata(tx, created.id, protocols, identity.capabilities);
    await persistAgentScoresById(tx, created.id);
    return {
      agentDbId: created.id,
      notice: {
        isNew: true,
        agentDbId: created.id,
        agentId: created.agentId,
        name,
        sapAgentPda: pdaStr,
        capabilityKeys: identity.capabilities.map((c) =>
          capabilityKey({
            id: c.id,
            protocol: (c as { protocol?: string; protocolId?: string }).protocol ?? (c as { protocolId?: string }).protocolId,
            version: (c as { version?: string }).version,
          }),
        ),
        chainId: SOLANA_CHAIN_ID,
      } satisfies SapUpsertNotice,
    };
  }, SAP_INDEXER_PRISMA_TX);
  return { kind: "upserted", ...notice };
}
function serializePricing(pricing: PricingTier[]): Prisma.InputJsonValue {
  return pricing.map((t) => serializeTier(t)) as unknown as Prisma.InputJsonValue;
}
async function replaceServices(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  services: Array<{ name: string; endpoint: string }>,
): Promise<void> {
  const desired = services.map((service) => {
    const normalized = normalizedAgentServiceData({
      name: sanitizePg(service.name.toUpperCase().slice(0, 20)),
      endpoint: sanitizePg(service.endpoint),
      version: "1.0",
    }, { sourceKind: "sap" });
    return {
      ...normalized,
      sourceDigest: createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32),
    };
  });
  const key = (service: { sourceName?: string | null; name: string; sourceEndpoint?: string | null; endpoint: string; sourceVersion?: string | null; version: string }) =>
    `${service.sourceName ?? service.name}\0${service.sourceEndpoint ?? service.endpoint}\0${service.sourceVersion ?? service.version}`;
  const remaining = new Map(desired.map((service) => [key(service), service]));
  const existing = await tx.agentService.findMany({
    where: { agentId: agentDbId },
    select: { id: true, name: true, endpoint: true, version: true, sourceName: true, sourceEndpoint: true, sourceVersion: true, sourceKind: true, sourceDigest: true },
  });
  const deleteIds: number[] = [];
  const updates: AgentServiceUpdate[] = [];
  for (const row of existing) {
    const rowKey = key(row);
    const next = remaining.get(rowKey);
    const managed = row.sourceKind === "sap" || (row.sourceKind == null && next != null);
    if (!managed) continue;
    if (!next) {
      deleteIds.push(row.id);
      continue;
    }
    remaining.delete(rowKey);
    if (row.sourceKind === "sap" && row.sourceDigest === next.sourceDigest) continue;
    updates.push({
      id: row.id,
      data: {
        ...next,
      },
    });
  }
  await updateAgentServicesInBulk(tx, updates);
  if (deleteIds.length > 0) {
    await tx.agentService.deleteMany({ where: { id: { in: deleteIds } } });
  }
  if (remaining.size === 0) return;
  await tx.agentService.createMany({
    data: [...remaining.values()].map((service) => ({
      agentId: agentDbId,
      ...service,
      extensions: service.extensions as never,
    })),
  });
}
async function replaceSapMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  const desired = entries.map((entry) => {
    const key = entry.key.slice(0, 120);
    const value = entry.value.slice(0, 8000);
    return {
      key,
      value,
      sourceKind: "sap",
      sourceDigest: createHash("sha256")
        .update(key)
        .update("\0")
        .update(value)
        .digest("hex")
        .slice(0, 32),
    };
  });
  const existing = await tx.agentMetadata.findMany({
    where: {
      agentId: agentDbId,
      OR: [
        { key: "sapRegistry" },
        { key: SAP_PROJECTION_DIGEST_KEY },
        { key: { startsWith: "sap_cap:" } },
      ],
    },
    select: { key: true, value: true },
  });
  const canonical = (rows: Array<{ key: string; value: string }>) =>
    rows.map((row) => `${row.key}\0${row.value}`).sort();
  const currentProjection = canonical(existing);
  const desiredProjection = canonical(desired);
  if (
    currentProjection.length === desiredProjection.length &&
    currentProjection.every((value, index) => value === desiredProjection[index])
  ) return;
  await tx.agentMetadata.deleteMany({
    where: {
      agentId: agentDbId,
      OR: [
        { key: "sapRegistry" },
        { key: SAP_PROJECTION_DIGEST_KEY },
        { key: { startsWith: "sap_cap:" } },
      ],
    },
  });
  if (desired.length === 0) return;
  await tx.agentMetadata.createMany({
    data: desired.map((e) => ({
      agentId: agentDbId,
      key: e.key,
      value: e.value,
      sourceKind: e.sourceKind,
      sourceDigest: e.sourceDigest,
    })),
    skipDuplicates: true,
  });
}
type ParsedExplorerIdentity = {
  walletStr: string;
  name: string;
  description: string;
  agentURI: string;
  x402Endpoint: string | null;
  isActive: boolean;
  capabilitiesJson: Prisma.InputJsonValue;
  pricingJson: Prisma.InputJsonValue;
  pricingRaw: unknown;
  protocols: string[];
  capabilitiesRaw: unknown[];
  candidateAgentId: number | null;
  reputationScore: number;
  totalFeedbacks: number;
  totalCallsServedStr: string;
  sapRegisteredAt: Date;
};
function explorerCapabilitiesToJson(arr: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(arr)) return [] as unknown as Prisma.InputJsonValue;
  const out = arr.map((c) => {
    const x = c as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      protocol: String(x.protocol ?? x.protocolId ?? ""),
      version: String(x.version ?? ""),
      description: String(x.description ?? ""),
    };
  });
  return out as unknown as Prisma.InputJsonValue;
}
function explorerPricingToJson(arr: unknown): Prisma.InputJsonValue {
  // Explorer responses are decoded from JSON, so arrays cannot contain BigInt,
  // cycles, functions, or undefined values. Avoid a redundant stringify/parse
  // clone on the indexer event loop.
  if (!Array.isArray(arr)) return [] as unknown as Prisma.InputJsonValue;
  return arr as Prisma.InputJsonValue;
}
function explorerProtocolStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((p) => sanitizePg(p));
}
function looksLikeSolanaPubkey(s: string): boolean {
  const t = s.trim();
  if (t.length < 32 || t.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(t);
}
/** First string in candidates that looks like a Solana address. */
function pickWalletField(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (looksLikeSolanaPubkey(t)) return t;
  }
  return "";
}
function parseExplorerRowIdentity(row: OobeExplorerAgentRow): ParsedExplorerIdentity | null {
  const top = row as Record<string, unknown>;
  const rawId = top.identity;
  const id =
    rawId && typeof rawId === "object" && !Array.isArray(rawId)
      ? (rawId as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const walletStr = pickWalletField(
    id.wallet,
    id.ownerWallet,
    id.authority,
    id.owner,
    top.wallet,
    top.ownerWallet,
    top.authority,
    top.owner,
  );
  if (!walletStr) return null;
  const rawName =
    typeof id.name === "string" ? id.name : typeof top.name === "string" ? top.name : "";
  const name = sanitizePg(rawName);
  const description =
    typeof id.description === "string"
      ? sanitizePg(id.description)
      : typeof top.description === "string"
        ? sanitizePg(top.description)
        : "";
  const agentURI =
    typeof id.agentUri === "string"
      ? sanitizePg(id.agentUri)
      : typeof id.agentURI === "string"
        ? sanitizePg(id.agentURI)
        : typeof top.agentUri === "string"
          ? sanitizePg(top.agentUri)
          : typeof top.agentURI === "string"
            ? sanitizePg(top.agentURI)
            : "";
  const xEp = id.x402Endpoint ?? top.x402Endpoint;
  const x402Endpoint = typeof xEp === "string" && xEp.trim() ? xEp.trim() : null;
  const isActive =
    "isActive" in id ? id.isActive !== false : "isActive" in top ? top.isActive !== false : true;
  const caps = Array.isArray(id.capabilities)
    ? id.capabilities
    : Array.isArray(top.capabilities)
      ? top.capabilities
      : [];
  const capabilitiesJson = explorerCapabilitiesToJson(caps);
  const pricingRaw = id.pricing !== undefined ? id.pricing : top.pricing;
  const pricingJson = explorerPricingToJson(pricingRaw);
  const protocols = mergeCovenantProtocols(
    explorerProtocolStrings(
      Array.isArray(id.protocols)
        ? id.protocols
        : Array.isArray(top.protocols)
          ? top.protocols
          : [],
    ),
    caps,
  );
  let reputationScore = 0;
  const rep = id.reputationScore ?? top.reputationScore;
  if (typeof rep === "number" && Number.isFinite(rep)) reputationScore = Math.min(100, Math.max(0, rep));
  else if (typeof rep === "string") {
    const n = Number.parseFloat(rep);
    if (Number.isFinite(n)) reputationScore = Math.min(100, Math.max(0, n));
  }
  let totalFeedbacks = 0;
  const tf = id.totalFeedbacks ?? top.totalFeedbacks;
  if (typeof tf === "number" && Number.isFinite(tf)) totalFeedbacks = Math.max(0, Math.floor(tf));
  else if (typeof tf === "string") {
    const n = Number.parseInt(tf, 10);
    if (Number.isFinite(n)) totalFeedbacks = Math.max(0, n);
  }
  const tcs = id.totalCallsServed ?? top.totalCallsServed;
  const totalCallsServedStr =
    typeof tcs === "string" ? tcs : typeof tcs === "number" && Number.isFinite(tcs) ? String(Math.trunc(tcs)) : "0";
  const agentIdRaw = id.agentId ?? top.agentId;
  let candidateAgentId: number | null = null;
  if (typeof agentIdRaw === "number" && agentIdRaw > 0) candidateAgentId = Math.floor(agentIdRaw);
  else if (typeof agentIdRaw === "string") {
    const n = Number.parseInt(agentIdRaw.replace(/^\s+|\s+$/g, ""), 10);
    if (Number.isFinite(n) && n > 0) candidateAgentId = n;
  }
  let sapRegisteredAt = new Date();
  const created = id.createdAt ?? top.createdAt;
  if (typeof created === "string") {
    const d = new Date(created);
    if (!Number.isNaN(d.getTime())) sapRegisteredAt = d;
  }
  return {
    walletStr,
    name: name || `SAP Agent ${row.pda.trim().slice(0, 8)}`,
    description,
    agentURI,
    x402Endpoint,
    isActive,
    capabilitiesJson,
    pricingJson,
    pricingRaw,
    protocols,
    capabilitiesRaw: caps,
    candidateAgentId,
    reputationScore,
    totalFeedbacks,
    totalCallsServedStr,
    sapRegisteredAt,
  };
}
function buildSapStatsJsonExplorer(
  stats: AgentStatsData | null,
  parsed: ParsedExplorerIdentity,
): Prisma.InputJsonValue {
  const base: Record<string, unknown> = {
    identityName: sanitizePg(parsed.name),
    identityDescription: sanitizePg(parsed.description),
    identityAgentUri: sanitizePg(parsed.agentURI),
    identityIsActive: parsed.isActive,
    identityReputationScore: parsed.reputationScore,
    identityTotalCallsServed: parsed.totalCallsServedStr,
    identityTotalFeedbacks: parsed.totalFeedbacks,
  };
  if (stats) base.agentStatsPda = serializeStats(stats);
  return base as Prisma.InputJsonValue;
}
function capabilityKeysFromExplorerCaps(caps: unknown[]): string[] {
  return caps.map((c) => {
    const x = c as Record<string, unknown>;
    return capabilityKey({
      id: String(x.id ?? ""),
      protocol: String(x.protocol ?? x.protocolId ?? ""),
      version: typeof x.version === "string" ? x.version : String(x.version ?? ""),
    });
  });
}
/** Upsert from OOBE `GET /api/v1/agents` when RPC snapshot omits an agent (index lag). Same Agent row shape as RPC path. */
async function upsertAgentFromOobeExplorerRow(
  row: OobeExplorerAgentRow,
  client: SapClient | null,
  connection: Connection | null,
  programId: PublicKey,
  registrationTxHint?: string | null,
  registrationTxKnown = false,
  uriMetaHint?: SapUriMetadata | null,
): Promise<SapUpsertNotice | null> {
  const parsed = parseExplorerRowIdentity(row);
  if (!parsed) return null;
  let agentPk: PublicKey;
  try {
    agentPk = new PublicKey(row.pda.trim());
  } catch {
    return null;
  }
  const pdaStr = agentPk.toBase58();
  const [statsPdaPk] = deriveAgentStats(agentPk, programId);
  const statsPdaStr = statsPdaPk.toBase58();
  const [uriMeta, stats, registrationTx] = await Promise.all([
    uriMetaHint ?? fetchUriJson(parsed.agentURI || null),
    (async () => {
      if (!client) return null;
      try {
        return await client.agent.fetchStatsNullable(agentPk);
      } catch {
        return null;
      }
    })(),
    registrationTxKnown
      ? registrationTxHint?.trim() || null
      : registrationTxHint?.trim()
        ? registrationTxHint
        : connection
          ? fetchRegistrationTxSig(connection, agentPk)
          : null,
  ]);
  const name = sanitizePg(uriMeta?.name ?? parsed.name);
  const description = sanitizePg(uriMeta?.description ?? parsed.description);
  const image = sanitizePg(uriMeta?.image ?? "");
  const x402Support = Boolean(parsed.x402Endpoint);
  const services: Array<{ name: string; endpoint: string }> = [];
  if (parsed.x402Endpoint) services.push({ name: "X402", endpoint: parsed.x402Endpoint });
  if (parsed.agentURI) services.push({ name: "WEB", endpoint: parsed.agentURI });
  const metadataEntries: Array<{ key: string; value: string }> = [
    { key: "sapRegistry", value: "synapse" },
    ...parsed.capabilitiesRaw.slice(0, 5).map((c) => {
      const x = c as Record<string, unknown>;
      const desc = typeof x.description === "string" ? x.description : "";
      const cid = typeof x.id === "string" ? x.id : String(x.id ?? "");
      return { key: `sap_cap:${cid}`, value: sanitizePg(desc).slice(0, 500) };
    }),
  ];
  const sapStatsJson = buildSapStatsJsonExplorer(stats, parsed);
  const capKeys = capabilityKeysFromExplorerCaps(parsed.capabilitiesRaw);
  const capabilityRows = explorerCapabilityProjectionRows(parsed.capabilitiesRaw);
  const sapProjections: SapNativeProjections = {
    sapCapabilityCount: capabilityRows.length,
    ...explorerPricingProjections(parsed.pricingRaw),
    ...sapStatsProjectionsExplorer(stats, parsed),
  };
  const scoreWallet = parsed.walletStr ? 100 : 0;
  const scoreQuality = Math.min(100, Math.max(0, parsed.reputationScore));
  const sapLockIdentities = [
    `sap-pda:${pdaStr}`,
    ...(parsed.walletStr ? [`wallet:${parsed.walletStr}`] : []),
    ...collectUrlKeysForTwinMatch({
      agentURI: parsed.agentURI,
      sapX402Endpoint: parsed.x402Endpoint,
      services,
    }).map((key) => `listing:${key}`),
  ];
  return prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, sapLockIdentities);
    const byPda = await tx.agent.findUnique({
      where: { sapAgentPda: pdaStr },
      select: {
        id: true,
        agentId: true,
        chainId: true,
        sapAgentPda: true,
        binanceCompatible: true,
        metadata: {
          where: { key: SAP_PROJECTION_DIGEST_KEY, sourceKind: "sap" },
          select: { value: true },
          take: 1,
        },
      },
    });
    const candidateId = parsed.candidateAgentId;
    const registryResolved =
      !byPda
        ? await resolveUniqueRegistryRowForSapIdentity(tx, {
            displayName: name,
            agentURI: parsed.agentURI,
            sapX402Endpoint: parsed.x402Endpoint,
            services,
          })
        : null;
    const registryRow = registryResolved
      ? await tx.agent.findUnique({
        where: { id: registryResolved.id },
        select: { id: true, agentId: true, chainId: true, binanceCompatible: true },
      })
      : null;
    const binanceCompatible = byPda?.binanceCompatible ?? registryRow?.binanceCompatible ?? false;
    const syncedAt = new Date();
    const scores = computeAgentScore({
      name,
      description,
      image,
      metadata: metadataEntries,
      services,
      scoreWallet,
      x402Support,
      binanceCompatible,
      totalFeedback: parsed.totalFeedbacks,
      scoreQuality,
      lastActiveAt: syncedAt,
    });
    const score = Math.min(100, Math.max(0, scores.score));
    const hotScore = Math.min(100, Math.max(0, scores.hotScore));
    const isActiveFinal = parsed.isActive && (stats?.isActive ?? parsed.isActive);
    const stableBaseData: Prisma.AgentUncheckedUpdateInput = {
      name,
      description,
      image,
      agentURI: parsed.agentURI,
      owner: sanitizePg(parsed.walletStr),
      isActive: isActiveFinal,
      x402Support,
      listingRegistrySource: "sap",
      sapVerified: true,
      sapAgentPda: pdaStr,
      sapStatsPda: statsPdaStr,
      sapCapabilities: parsed.capabilitiesJson,
      sapPricingTiers: parsed.pricingJson,
      sapProtocols: parsed.protocols,
      sapX402Endpoint: parsed.x402Endpoint,
      sapRegistrationTx: registrationTx,
      sapStats: sapStatsJson,
      sapOwnerWallet: parsed.walletStr,
      sapRegisteredAt: parsed.sapRegisteredAt,
      ...sapProjections,
      score,
      hotScore,
      scoreWallet,
      scoreMetadata: scores.scoreMetadata,
      scoreServices: scores.scoreEndpoints,
      scoreQuality,
      scorePopularity: scores.scorePopularity,
      scoreFreshness: scores.scoreFreshness,
      totalFeedback: parsed.totalFeedbacks,
    };
    const projectionDigest = createHash("sha256")
      .update(JSON.stringify({ agent: stableBaseData, services, metadata: metadataEntries }))
      .digest("hex");
    const managedMetadataEntries = [
      ...metadataEntries,
      { key: SAP_PROJECTION_DIGEST_KEY, value: projectionDigest },
    ];
    const baseData: Prisma.AgentUncheckedUpdateInput = {
      ...stableBaseData,
      sapLastSyncedAt: syncedAt,
      lastActiveAt: syncedAt,
    };
    if (byPda) {
      if (byPda.metadata[0]?.value === projectionDigest) {
        await tx.agent.update({
          where: { id: byPda.id },
          data: { sapLastSyncedAt: syncedAt, lastActiveAt: syncedAt },
        });
        await touchCovenantDetectionMetadata(tx, byPda.id, parsed.protocols, parsed.capabilitiesRaw);
        return null;
      }
      await tx.agent.update({
        where: { id: byPda.id },
        data: {
          ...baseData,
          agentId: byPda.agentId,
          chainId: byPda.chainId,
        },
      });
      await replaceServices(tx, byPda.id, services);
      await replaceSapCapabilities(tx, byPda.id, capabilityRows);
      await replaceSapMetadata(tx, byPda.id, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, byPda.id, parsed.protocols, parsed.capabilitiesRaw);
      await persistAgentScoresById(tx, byPda.id);
      return null;
    }
    if (registryRow) {
      const attachPayload = { ...baseData };
      delete attachPayload.listingRegistrySource;
      await tx.agent.update({
        where: { id: registryRow.id },
        data: {
          ...attachPayload,
          agentId: registryRow.agentId,
          chainId: registryRow.chainId,
        },
      });
      await replaceServices(tx, registryRow.id, services);
      await replaceSapCapabilities(tx, registryRow.id, capabilityRows);
      await replaceSapMetadata(tx, registryRow.id, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, registryRow.id, parsed.protocols, parsed.capabilitiesRaw);
      await persistAgentScoresById(tx, registryRow.id);
      return null;
    }
    await acquireSolanaCompatibilityIdAllocatorLock(tx);
    let agentIdToUse: number;
    let updateRowId: number | null = null;
    if (candidateId != null) {
      const collision = await tx.agent.findUnique({
        where: { agentId_chainId: { agentId: candidateId, chainId: SOLANA_CHAIN_ID } },
        select: { id: true, agentId: true, sapAgentPda: true },
      });
      if (!collision) {
        agentIdToUse = candidateId;
      } else if (collision.sapAgentPda === pdaStr) {
        updateRowId = collision.id;
        agentIdToUse = collision.agentId;
      } else {
        agentIdToUse = await nextSolanaAgentId(tx);
      }
    } else {
      agentIdToUse = await nextSolanaAgentId(tx);
    }
    if (updateRowId != null) {
      await tx.agent.update({
        where: { id: updateRowId },
        data: { ...baseData, agentId: agentIdToUse, chainId: SOLANA_CHAIN_ID },
      });
      await replaceServices(tx, updateRowId, services);
      await replaceSapCapabilities(tx, updateRowId, capabilityRows);
      await replaceSapMetadata(tx, updateRowId, managedMetadataEntries);
      await touchCovenantDetectionMetadata(tx, updateRowId, parsed.protocols, parsed.capabilitiesRaw);
      await persistAgentScoresById(tx, updateRowId);
      return null;
    }
    const created = await tx.agent.create({
      data: {
        agentId: agentIdToUse,
        chainId: SOLANA_CHAIN_ID,
        name,
        description,
        image,
        agentURI: parsed.agentURI,
        owner: sanitizePg(parsed.walletStr),
        isActive: isActiveFinal,
        x402Support,
        listingRegistrySource: "sap",
        sapVerified: true,
        sapAgentPda: pdaStr,
        sapStatsPda: statsPdaStr,
        sapCapabilities: parsed.capabilitiesJson,
        sapPricingTiers: parsed.pricingJson,
        sapProtocols: parsed.protocols,
        sapX402Endpoint: parsed.x402Endpoint,
        sapRegistrationTx: registrationTx,
        sapLastSyncedAt: new Date(),
        sapStats: sapStatsJson,
        sapOwnerWallet: parsed.walletStr,
        sapRegisteredAt: parsed.sapRegisteredAt,
        ...sapProjections,
        score,
        hotScore,
        scoreWallet,
        scoreMetadata: scores.scoreMetadata,
        scoreServices: scores.scoreEndpoints,
        scoreQuality,
        scorePopularity: scores.scorePopularity,
        scoreFreshness: scores.scoreFreshness,
        totalFeedback: parsed.totalFeedbacks,
        lastActiveAt: new Date(),
      },
    });
    await replaceServices(tx, created.id, services);
    await replaceSapCapabilities(tx, created.id, capabilityRows);
    await replaceSapMetadata(tx, created.id, managedMetadataEntries);
    await touchCovenantDetectionMetadata(tx, created.id, parsed.protocols, parsed.capabilitiesRaw);
    await persistAgentScoresById(tx, created.id);
    return {
      isNew: true,
      agentDbId: created.id,
      agentId: created.agentId,
      name,
      sapAgentPda: pdaStr,
      capabilityKeys: capKeys,
      chainId: SOLANA_CHAIN_ID,
    };
  }, SAP_INDEXER_PRISMA_TX);
}
/** Matches `identity.agentId` / top-level `agentId` on an OOBE explorer row to a directory `Agent.agentId`. */
function explorerRowDirectoryAgentId(row: OobeExplorerAgentRow): number | null {
  const top = row as Record<string, unknown>;
  const rawId = top.identity;
  const id =
    rawId && typeof rawId === "object" && !Array.isArray(rawId)
      ? (rawId as Record<string, unknown>)
      : null;
  const candidates = [id?.agentId, top.agentId];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    if (typeof raw === "string") {
      const n = Number.parseInt(raw.replace(/^\s+|\s+$/g, ""), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}
export type AdminSapDirectoryUpsertResult =
  | { ok: true; internalId: number; created: boolean }
  | { ok: false; error: string };
/**
 * Admin/import + sync: ensure one Solana (SAP) listing from OOBE Explorer by directory `agentId` (`chainId` 900001 implied).
 * Reuses the same ingest path as SAP indexer reconcile.
 */
export async function adminUpsertSapAgentFromOobeByDirectoryAgentId(
  agentId: number,
): Promise<AdminSapDirectoryUpsertResult> {
  if (!Number.isFinite(agentId) || agentId < 0 || agentId !== Math.floor(agentId)) {
    return { ok: false, error: "Invalid Solana directory agent id." };
  }
  try {
    await ensureSolanaChainRow();
    let explorerRows: OobeExplorerAgentRow[];
    try {
      explorerRows = await listOobeExplorerAgents({ limit: 5000 });
    } catch (e) {
      const msg = Error.isError(e) ? e.message : String(e);
      return { ok: false, error: `OOBE Explorer unreachable: ${msg}` };
    }
    const dbRow = await prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId: SOLANA_CHAIN_ID } },
      select: { sapAgentPda: true },
    });
    const pdaFromDb = dbRow?.sapAgentPda?.trim() ?? "";
    let explorerRow: OobeExplorerAgentRow | undefined;
    if (pdaFromDb) {
      explorerRow = explorerRows.find((r) => r.pda.trim() === pdaFromDb);
    }
    if (!explorerRow) {
      explorerRow = explorerRows.find((r) => explorerRowDirectoryAgentId(r) === agentId);
    }
    if (!explorerRow) {
      return {
        ok: false,
        error:
          "No matching SAP agent on OOBE Explorer for this directory id. Confirm it is listed publicly or run the SAP indexer.",
      };
    }
    const explorerPda = explorerRow.pda.trim();
    let programPk: PublicKey;
    try {
      programPk = resolveSapProgramId();
    } catch {
      return { ok: false, error: "Invalid SAP_PROGRAM_ID in env." };
    }
    const { client, connection } = await createSapClientWithFallback(programPk);
    const notice = await upsertAgentFromOobeExplorerRow(explorerRow, client, connection, programPk);
    const after = await prisma.agent.findUnique({
      where: { sapAgentPda: explorerPda },
      select: { id: true },
    });
    if (!after) {
      return {
        ok: false,
        error:
          "SAP ingest did not produce a directory row (check OOBE identity has a valid Solana wallet and PDA).",
      };
    }
    return { ok: true, internalId: after.id, created: notice?.isNew === true };
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
/**
 * Upsert only OOBE Explorer agents missing from AgentRanking (`sapVerified` rows).
 * Sequential, low-concurrency path for finishing drift after a partial full sync.
 */
export async function reconcileMissingOobeExplorerAgents(): Promise<{
  ok: boolean;
  upserted: number;
  missingPdas: string[];
  errors: Array<{ pda?: string; message: string }>;
}> {
  const { runSapOobeExplorerDriftCheck } = await import("@/lib/sap-explorer-drift");
  const drift = await runSapOobeExplorerDriftCheck({ listLimit: 10_000 });
  const missingPdas = drift.onlyInExplorer;
  if (missingPdas.length === 0) {
    return { ok: true, upserted: 0, missingPdas: [], errors: [] };
  }
  const errors: Array<{ pda?: string; message: string }> = [];
  let upserted = 0;
  let failures = 0;
  try {
    await ensureSolanaChainRow();
    const programPk = resolveSapProgramId();
    let client: SapClient | null = null;
    let connection: Connection | null = null;
    try {
      const bundle = await createSapClientWithFallback(programPk);
      client = bundle.client;
      connection = bundle.connection;
    } catch (rpcErr) {
      const msg = Error.isError(rpcErr) ? rpcErr.message : String(rpcErr);
      console.warn("[sap-reconcile] RPC unavailable — continuing with Explorer-only upserts:", msg);
    }
    const explorerRows = await listOobeExplorerAgents({ limit: 10_000 });
    const byPda = new Map(explorerRows.map((r) => [r.pda.trim(), r] as const));
    await forEachWithConcurrency(missingPdas, getSapIndexerConcurrency(), async (pda) => {
      const row = byPda.get(pda);
      if (!row) {
        failures++;
        appendSapError(errors, { pda, message: "Not found in OOBE agent list response" });
        return;
      }
      try {
        await upsertAgentFromOobeExplorerRow(row, client, connection, programPk);
        upserted++;
      } catch (e) {
        const msg = Error.isError(e) ? e.message : String(e);
        failures++;
        appendSapError(errors, { pda, message: msg });
      }
    });
    // SAP indexing is a high-frequency worker path. Public responses use bounded
    // request-time TTLs; do not import Next-only cache services into the worker.
    return { ok: upserted > 0 || failures === 0, upserted, missingPdas, errors };
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return { ok: false, upserted, missingPdas, errors: [{ message: msg }] };
  }
}
type OobeExplorerReconcileOutcome = {
  explorerMirrorUpserted: number;
  oobeReconcileOnlyCount: number;
  agentsFoundFromExplorer: number;
  extraAgentsUpserted: number;
  notices: SapUpsertNotice[];
  errors: Array<{ pda?: string; message: string }>;
  agentsFailed: number;
};
async function reconcileOobeExplorerAgents(options: {
  client: SapClient | null;
  connection: Connection | null;
  programId: PublicKey;
  concurrency: number;
  rpcUpsertOkPdas: Set<string>;
}): Promise<OobeExplorerReconcileOutcome> {
  const errors: Array<{ pda?: string; message: string }> = [];
  const notices: SapUpsertNotice[] = [];
  let explorerMirrorUpserted = 0;
  let extraAgentsUpserted = 0;
  let agentsFailed = 0;
  const explorerRows = await listOobeExplorerAgents({ limit: 10_000 });
  const explorerReconcile = explorerRows.filter(
    (row) => Boolean(row.pda?.trim()) && !options.rpcUpsertOkPdas.has(row.pda.trim()),
  );
  const oobeReconcileOnlyCount = explorerReconcile.length;
  const storedAgentStates = await loadStoredSapAgentStates(
    explorerReconcile.map((row) => row.pda.trim()),
  );
  await forEachWithConcurrency(
    explorerReconcile,
    options.concurrency,
    async (row) => {
      const pdaStr = row.pda.trim();
      const parsedIdentity = parseExplorerRowIdentity(row);
      if (!parsedIdentity) {
        agentsFailed++;
        appendSapError(errors, {
          pda: pdaStr,
          message: "OOBE reconcile: unable to parse identity (missing Solana wallet?)",
        });
        return;
      }
      try {
        const notice = await upsertAgentFromOobeExplorerRow(
          row,
          options.client,
          options.connection,
          options.programId,
          storedAgentStates.get(pdaStr)?.registrationTx,
          storedAgentStates.has(pdaStr),
          storedSapUriProfile(
            pdaStr,
            parsedIdentity.agentURI,
            storedAgentStates.get(pdaStr),
          ),
        );
        if (notice) notices.push(notice);
        explorerMirrorUpserted++;
        extraAgentsUpserted++;
      } catch (e) {
        const msg = Error.isError(e) ? e.message : String(e);
        agentsFailed++;
        appendSapError(errors, { pda: pdaStr, message: `OOBE reconcile: ${msg}` });
      }
    },
  );
  if (explorerMirrorUpserted > 0 || oobeReconcileOnlyCount > 0) {
    console.info(
      `[sap-indexer] OOBE Explorer reconcile: ${explorerMirrorUpserted} upsert ok, ${explorerReconcile.length} rows from API (${oobeReconcileOnlyCount} RPC-miss or partial-fail overlap)`,
    );
  }
  return {
    explorerMirrorUpserted,
    oobeReconcileOnlyCount,
    agentsFoundFromExplorer: explorerRows.length,
    extraAgentsUpserted,
    notices,
    errors,
    agentsFailed,
  };
}
/**
 * Run full SAP sync. Safe to call repeatedly (idempotent on sapAgentPda).
 * Does not throw on RPC/agent failures; returns structured errors.
 */
export async function runSapIndexer(options?: { respectBackgroundPause?: boolean }): Promise<SapIndexerResult> {
  const started = Date.now();
  const errors: Array<{ pda?: string; message: string }> = [];
  let agentsFound = 0;
  let agentsUpserted = 0;
  let agentsFailed = 0;
  const recordError = (error: SapIndexerError): void => {
    agentsFailed++;
    appendSapError(errors, error);
  };
  const recordOperationalError = (error: SapIndexerError): void => {
    appendSapError(errors, error);
  };
  if (options?.respectBackgroundPause) {
    const { isBackgroundJobsPaused } = await import("@/lib/pause-background-jobs");
    if (isBackgroundJobsPaused()) {
      return {
        ok: false,
        agentsFound: 0,
        agentsUpserted: 0,
        errors: [],
        durationMs: Date.now() - started,
        message: "Background jobs paused",
      };
    }
  }
  let programPk: PublicKey;
  try {
    programPk = resolveSapProgramId();
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    await prisma.sapSyncLog.create({
      data: {
        agentsFound: 0,
        agentsUpserted: 0,
        errors: [{ message: `Invalid SAP_PROGRAM_ID: ${msg}` }],
        durationMs: Date.now() - started,
      },
    });
    return {
      ok: false,
      agentsFound: 0,
      agentsUpserted: 0,
      errors: [{ message: msg }],
      durationMs: Date.now() - started,
    };
  }
  const newAgentNotices: SapUpsertNotice[] = [];
  const dispatchNewAgentNotices = async (notices: readonly SapUpsertNotice[]): Promise<void> => {
    if (notices.length === 0) return;
    const remainingSample = SAP_NEW_AGENT_LOG_LIMIT - newAgentNotices.length;
    if (remainingSample > 0) {
      newAgentNotices.push(...notices.slice(0, remainingSample));
    }
    try {
      await queueSapNewAgentNotifications(notices);
    } catch {
      // Notifications are optional and idempotently recoverable from delivery rows.
    }
  };
  let explorerMirrorUpserted = 0;
  let oobeReconcileOnlyCount = 0;
  let rpcSource: SapIndexerResult["rpcSource"];
  let rpcHostForLog = "";
  try {
    await ensureSolanaChainRow();
    const sapAgentConcurrency = getSapIndexerConcurrency();
    console.info(
      `[sap-indexer] per-agent concurrency=${sapAgentConcurrency} (SAP_INDEXER_CONCURRENCY, max 32)`,
    );
    /** PDAs successfully upserted from RPC — failed RPC rows MUST NOT block OOBE reconcile. */
    const rpcUpsertOkPdas = new Set<string>();
    let agentsFoundRpc = 0;
    let client: SapClient | null = null;
    let connection: Connection | null = null;
    let disableRpcForReconcile = false;
    try {
      const rpcBundle = await createSapClientWithFallback(programPk);
      client = rpcBundle.client;
      connection = rpcBundle.connection;
      rpcSource = rpcBundle.rpcSource;
      rpcHostForLog = redactRpcUrlForLogs(rpcBundle.rpcUrlUsed);
      // createSapClientWithFallback only returns after fetchGlobalRegistry()
      // succeeds. Do not immediately repeat the same probe on the selected RPC;
      // on quota-limited endpoints that duplicate request can consume the last
      // available unit and make the actual enumeration fail.
      try {
        const rows = await fetchAllAgentAccounts(client);
        agentsFoundRpc = rows.length;
        for (let offset = 0; offset < rows.length; offset += SAP_PROCESS_PAGE_SIZE) {
          const page = rows.slice(offset, offset + SAP_PROCESS_PAGE_SIZE);
          const pageObservedAt = new Date();
          const [storedAgentStates, statsResults] = await Promise.all([
            loadStoredSapAgentStates(page.map((row) => row.publicKey.toBase58())),
            fetchAgentStatsPage(client, programPk, page),
          ]);
          const pageNotices: SapUpsertNotice[] = [];
          const stableTouchIds: number[] = [];
          const uriFetchTouchIds: number[] = [];
          await forEachWithConcurrency(
            page,
            sapAgentConcurrency,
            async (row, rowIndex) => {
              if (disableRpcForReconcile) return;
              const pdaStr = row.publicKey.toBase58();
              const storedState = storedAgentStates.get(pdaStr);
              try {
                const statsResult = statsResults[rowIndex];
                if (!statsResult || "error" in statsResult) {
                  throw statsResult?.error ?? new Error("SAP stats result missing");
                }
                const cachedUriMeta = storedSapUriProfile(
                  pdaStr,
                  row.account.agentUri ?? null,
                  storedState,
                  pageObservedAt.getTime(),
                );
                const uriRefreshAttempted =
                  cachedUriMeta == null && Boolean(row.account.agentUri?.trim());
                const [regTx, uriMeta] = await Promise.all([
                  storedState
                    ? storedState.registrationTx
                    : fetchRegistrationTxSig(connection!, row.publicKey),
                  cachedUriMeta ?? fetchUriJson(row.account.agentUri ?? null),
                ]);
                const outcome = await upsertAgentRow(
                  programPk,
                  row.publicKey,
                  row.account,
                  statsResult.stats,
                  regTx,
                  uriMeta,
                  storedState,
                  pageObservedAt,
                );
                rpcUpsertOkPdas.add(pdaStr);
                if (outcome.kind === "stable") {
                  if (outcome.touchDue) stableTouchIds.push(outcome.agentDbId);
                } else if (outcome.notice) {
                  pageNotices.push(outcome.notice);
                }
                if (uriRefreshAttempted) {
                  uriFetchTouchIds.push(outcome.agentDbId);
                }
                agentsUpserted++;
              } catch (e) {
                if (isProviderWideSapRpcError(e)) disableRpcForReconcile = true;
                const msg = Error.isError(e) ? e.message : String(e);
                recordError({ pda: pdaStr, message: msg });
              }
            },
          );
          if (stableTouchIds.length > 0) {
            await prisma.agent.updateMany({
              where: { id: { in: stableTouchIds } },
              data: {
                sapLastSyncedAt: pageObservedAt,
                lastActiveAt: pageObservedAt,
              },
            });
          }
          await touchSapUriFetchMetadata(uriFetchTouchIds, pageObservedAt);
          await dispatchNewAgentNotices(pageNotices);
          if (disableRpcForReconcile) break;
          // agentAccount.all() necessarily returns one large SDK array. Drop
          // decoded accounts as each page commits so a 100k registry retains
          // only the small PDA success set needed by the mirror reconciler.
          for (let index = 0; index < page.length; index += 1) {
            rows[offset + index] = undefined as never;
          }
        }
        rows.length = 0;
      } catch (enumErr) {
        const msg = Error.isError(enumErr) ? enumErr.message : String(enumErr);
        recordOperationalError({ message: `SAP agentAccount.all: ${msg}` });
        if (isProviderWideSapRpcError(enumErr)) {
          disableRpcForReconcile = true;
          console.warn("[sap-indexer] RPC provider unavailable during enumeration — switching remaining work to OOBE HTTP mirror:", msg);
        } else {
          console.error("[sap-indexer] RPC enumeration failed:", msg);
        }
      }
      if (disableRpcForReconcile) {
        client = null;
        connection = null;
      }
    } catch (rpcErr) {
      const msg = Error.isError(rpcErr) ? rpcErr.message : String(rpcErr);
      recordOperationalError({ message: `RPC unavailable: ${msg}` });
      console.warn("[sap-indexer] RPC unavailable — continuing with OOBE Explorer HTTP reconcile:", msg);
    }
    agentsFound = agentsFoundRpc;
    try {
      const reconcile = await reconcileOobeExplorerAgents({
        client,
        connection,
        programId: programPk,
        concurrency: sapAgentConcurrency,
        rpcUpsertOkPdas,
      });
      explorerMirrorUpserted = reconcile.explorerMirrorUpserted;
      oobeReconcileOnlyCount = reconcile.oobeReconcileOnlyCount;
      agentsFound = Math.max(agentsFoundRpc, reconcile.agentsFoundFromExplorer);
      agentsUpserted += reconcile.extraAgentsUpserted;
      await dispatchNewAgentNotices(reconcile.notices);
      agentsFailed += reconcile.agentsFailed;
      for (const error of reconcile.errors) appendSapError(errors, error);
    } catch (httpErr) {
      const msg = Error.isError(httpErr) ? httpErr.message : String(httpErr);
      recordOperationalError({ message: `OOBE /api/v1/agents: ${msg}` });
    }
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    recordOperationalError({ message: msg });
    console.error("[sap-indexer] sync failed:", msg);
  }
  const durationMs = Date.now() - started;
  let oobeExplorerDrift: SapIndexerResult["oobeExplorerDrift"];
  if (process.env.SAP_INDEXER_OOBE_DRIFT_CHECK?.trim() === "true") {
    try {
      const { runSapOobeExplorerDriftCheck } = await import("@/lib/sap-explorer-drift");
      const drift = await runSapOobeExplorerDriftCheck({ listLimit: 2000 });
      oobeExplorerDrift = drift;
      if (drift.onlyInExplorer.length > 0 || drift.onlyInDb.length > 0) {
        console.warn(
          "[sap-indexer] OOBE Explorer drift:",
          `explorer=${drift.explorerAgentCount} db=${drift.dbSapAgentCount}`,
          `onlyInExplorer=${drift.onlyInExplorer.length}`,
          `onlyInDb=${drift.onlyInDb.length}`,
        );
      }
    } catch (e) {
      const msg = Error.isError(e) ? e.message : String(e);
      console.warn("[sap-indexer] OOBE Explorer drift check failed:", msg);
      oobeExplorerDrift = {
        explorerAgentCount: 0,
        dbSapAgentCount: 0,
        onlyInExplorer: [],
        onlyInDb: [],
        driftCheckError: msg,
      };
    }
  }
  const driftSummary = oobeExplorerDrift
    ? ` driftOnlyInExplorer=${oobeExplorerDrift.onlyInExplorer.length} driftOnlyInDb=${oobeExplorerDrift.onlyInDb.length}`
    : "";
  console.info(
    `[sap-indexer] sync complete rpcSource=${rpcSource ?? "unknown"} rpcHost=${rpcHostForLog || "n/a"} agentsFound=${agentsFound} agentsUpserted=${agentsUpserted} agentsFailed=${agentsFailed} explorerReconcile=${explorerMirrorUpserted} reconcileOnly=${oobeReconcileOnlyCount} durationMs=${durationMs}${driftSummary}`,
  );
  try {
    await prisma.sapSyncLog.create({
      data: {
        agentsFound,
        agentsUpserted,
        errors: errors.length
          ? (errors as Prisma.InputJsonValue)
          : rpcSource
            ? ({ rpcSource } as Prisma.InputJsonValue)
            : undefined,
        durationMs,
        newAgents:
          newAgentNotices.length > 0
            ? (newAgentNotices.slice(0, SAP_NEW_AGENT_LOG_LIMIT).map((n) => ({
                agentDbId: n.agentDbId,
                agentId: n.agentId,
                name: n.name,
                sapAgentPda: n.sapAgentPda,
                capabilityKeys: n.capabilityKeys,
              })) as Prisma.InputJsonValue)
            : undefined,
      },
    });
  } catch (e) {
    console.error("[sap-indexer] SapSyncLog insert failed:", e);
  }
  // SAP indexing is a high-frequency worker path. Agent-list and statistics
  // caches refresh through their short TTLs without coupling the worker to Next.
  let covenantVerification: Awaited<
    ReturnType<typeof import("./covenant-verification").runCovenantVerificationBatch>
  > | undefined;
  try {
    const { runCovenantVerificationBatch } = await import("./covenant-verification");
    covenantVerification = await runCovenantVerificationBatch({ limit: 40 });
    console.info(
      `[sap-indexer] OpenCovenant verification: scanned=${covenantVerification.scanned} verified=${covenantVerification.verified} skippedStale=${covenantVerification.skippedStale} errors=${covenantVerification.errors.length}`,
    );
  } catch (e) {
    console.warn(
      "[sap-indexer] OpenCovenant verification batch failed:",
      Error.isError(e) ? e.message : String(e),
    );
  }
  return {
    ok: agentsFailed === 0 || agentsUpserted > 0,
    agentsFound,
    agentsUpserted,
    errors,
    durationMs,
    ...(rpcSource ? { rpcSource } : {}),
    ...(agentsFailed > 0 ? { agentsFailed } : {}),
    ...(explorerMirrorUpserted > 0
      ? { explorerMirrorUpserted }
      : {}),
    ...(oobeReconcileOnlyCount > 0 ? { oobeReconcileOnlyCount } : {}),
    ...(oobeExplorerDrift ? { oobeExplorerDrift } : {}),
    ...(covenantVerification ? { covenantVerification } : {}),
  };
}
