import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiItem, type Hex, type PublicClient } from "viem";
import { prisma } from "../db.js";
import type { Prisma } from "@/generated/prisma/client";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { CHAINS, getChainByChainId, isErc8004IndexingEnabled, provenRegistryDeploymentBlock, registryDeploymentSearchHint } from "../chains.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { classifyRpcError, getRpcFinalitySnapshot, getRpcUrls, withRpcFallback } from "./rpc.js";
import { logger } from "../logger.js";
import { enqueueClusterReconcile } from "../queue/producer.js";
import { type RegistrationJson, extractMetadata, listServiceEntries } from "./agent-metadata.js";
import { registrationFingerprint } from "../lib/registration-fingerprint.js";
import { resolveAgentPaymentRails } from "@/lib/agent-payment-rails.js";
import { attemptRegistrationDocument, normalizeRegistrationUri } from "../lib/registration-document.js";
import { canonicalUint256, compatibleAgentInt, evmEventKey } from "../lib/exact-protocol.js";
import type { SourceSnapshot } from "../queue/contracts.js";
import { throwIfAborted } from "../lib/abort.js";
import { currentJobRuntime, currentRetryBudget } from "../queue/retry-budget.js";
import { runIdempotentStage } from "../queue/stage-idempotency.js";
import { classifyDatabaseError, isSafePreExecutionDatabaseRetry } from "../lib/database-errors.js";
import {
  AgentBlocklistError,
  assertNotBlocklistedWithRules,
  type AgentBlocklistRuleRow,
} from "../lib/agent-blocklist-logic.js";
import { normalizeChainString } from "../lib/chain-string.js";
import { reconcileChainFeedbackCounts } from "./chain-feedback-counts.js";
import { derivePublicActivation } from "../lib/public-activation.js";
import { createCompletionLogLimiter } from "../../job-completion-log.js";
import {
  jsonEquivalent,
  updateAgentMetadataInBulk,
  updateAgentServicesInBulk,
  type AgentMetadataUpdate,
  type AgentServiceUpdate,
} from "./relation-diff.js";
const agentSyncInfoLog = createCompletionLogLimiter();
function logAgentSyncInfo(event: string, details: Record<string, unknown>, category = "sync"): void {
  const summary = agentSyncInfoLog(event);
  if (summary) logger.info(event, { ...summary, ...details }, category);
}
const IDENTITY_ABI = [
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
  parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)"),
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function getAgentWallet(uint256 agentId) view returns (address)"),
] as const;
const MULTICALL3_ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);
/** Machine-verified static identity-registry creation blocks. Other chains require runtime archival discovery. */
export const DEPLOYMENT_BLOCKS: Record<number, bigint> = Object.fromEntries(
  CHAINS.flatMap((chain) => {
    if (chain.chainId === SOLANA_CHAIN_ID || !isErc8004IndexingEnabled(chain)) return [];
    const block = provenRegistryDeploymentBlock(chain, "identity");
    return block == null ? [] : [[chain.chainId, block]];
  }),
);
const METADATA_FETCH_TIMEOUT_MS = 8_000;
/** Jobs per pg-boss bulk insert when enqueueing mints after catchup. */
const CATCHUP_AGENT_SYNC_CREATE_BATCH = 250;
/** Strips null bytes (0x00) that PostgreSQL UTF8 rejects with "invalid byte sequence" */
function sanitizeForPostgres(s: string): string {
  return normalizeChainString(s, { label: "chain-derived string", maxBytes: 8_192, allowTruncation: true }).value;
}
function sourceCoordinateIsOlder(input: {
  incomingBlock: bigint;
  incomingTransactionIndex: number | null | undefined;
  incomingLogIndex: number | null | undefined;
  existingBlock: bigint | null;
  existingTransactionIndex: number | null;
  existingLogIndex: number | null;
}): boolean {
  if (input.existingBlock == null) return false;
  if (input.incomingBlock !== input.existingBlock) return input.incomingBlock < input.existingBlock;
  if (input.incomingTransactionIndex != null && input.existingTransactionIndex != null) {
    if (input.incomingTransactionIndex !== input.existingTransactionIndex) {
      return input.incomingTransactionIndex < input.existingTransactionIndex;
    }
  }
  if (input.incomingLogIndex != null && input.existingLogIndex != null) {
    return input.incomingLogIndex < input.existingLogIndex;
  }
  return false;
}
/** Empty `services: [{}]` still yields rows but no real endpoint — treat as no services for junk detection. */
function hasSubstantiveServiceEndpoints(services: { endpoint: string }[]): boolean {
  return services.some((s) => s.endpoint.trim().length > 0);
}
function isLowSignalListing(
  name: string,
  description: string,
  services: { endpoint: string }[],
): boolean {
  const n = name.trim();
  const d = description.trim();
  const badName =
    !n ||
    n.toLowerCase() === "unnamed agent" ||
    /^Agent #\d+$/.test(n);
  return badName && !d && !hasSubstantiveServiceEndpoints(services);
}
function sortedMetadata(entries: Array<{ key: string; value: string }>) {
  return entries.sort((a, b) => {
    const keyCmp = a.key.localeCompare(b.key);
    return keyCmp !== 0 ? keyCmp : a.value.localeCompare(b.value);
  });
}
function sortedServices(entries: Array<{ name: string; endpoint: string; version?: string }>) {
  return entries.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    const endpointCmp = a.endpoint.localeCompare(b.endpoint);
    return endpointCmp !== 0 ? endpointCmp : (a.version ?? "").localeCompare(b.version ?? "");
  });
}
function metadataEntriesEqual(
  a: readonly { key: string; value: string }[],
  b: readonly { key: string; value: string }[],
): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return other?.key === row.key && other.value === row.value;
  });
}
function serviceEntriesEqual(
  a: readonly { name: string; endpoint: string; version?: string }[],
  b: readonly { name: string; endpoint: string; version?: string }[],
): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return (
      other?.name === row.name &&
      other.endpoint === row.endpoint &&
      (other.version ?? "") === (row.version ?? "")
    );
  });
}
type AgentChainConfig = NonNullable<ReturnType<typeof getChainByChainId>>;
type AgentChainConfigRow = {
  name: string;
  shortName: string;
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
  sourceConfigDigest: string | null;
};
const chainRowEnsureInFlight = new Map<number, Promise<void>>();
const CHAIN_ROW_REVALIDATE_MS = 60_000;
const chainRowConfirmedUntil = new Map<number, number>();
function agentChainSourceConfigDigest(chainId: number, chainConfig: AgentChainConfig): string {
  return createHash("sha256").update(JSON.stringify({
    chainId,
    name: chainConfig.name,
    shortName: chainConfig.shortName,
    identityRegistry: chainConfig.identityRegistry.toLowerCase(),
    reputationRegistry: chainConfig.reputationRegistry.toLowerCase(),
    validationRegistry: chainConfig.validationRegistry.toLowerCase(),
    identityDeploymentSearchHint: registryDeploymentSearchHint(chainConfig, "identity").toString(10),
    reputationDeploymentSearchHint: registryDeploymentSearchHint(chainConfig, "reputation").toString(10),
    validationDeploymentSearchHint: registryDeploymentSearchHint(chainConfig, "validation").toString(10),
  })).digest("hex");
}
function agentChainConfigMatches(
  current: AgentChainConfigRow,
  chainConfig: AgentChainConfig,
  sourceConfigDigest: string,
): boolean {
  return current.name === chainConfig.name &&
    current.shortName === chainConfig.shortName &&
    current.identityRegistry.toLowerCase() === chainConfig.identityRegistry.toLowerCase() &&
    current.reputationRegistry.toLowerCase() === chainConfig.reputationRegistry.toLowerCase() &&
    current.validationRegistry.toLowerCase() === chainConfig.validationRegistry.toLowerCase() &&
    current.sourceConfigDigest === sourceConfigDigest;
}
async function ensureChainRowUncoalesced(chainId: number, chainConfig: AgentChainConfig): Promise<void> {
  const sourceConfigDigest = agentChainSourceConfigDigest(chainId, chainConfig);
  const select = {
    name: true,
    shortName: true,
    identityRegistry: true,
    reputationRegistry: true,
    validationRegistry: true,
    sourceConfigDigest: true,
  } as const;
  let current = await withDbRetry(() => prisma.chain.findUnique({ where: { chainId }, select }));
  if (current && agentChainConfigMatches(current, chainConfig, sourceConfigDigest)) return;
  if (!current) {
    await withDbRetry(() => prisma.chain.createMany({
      data: [{
        chainId,
        name: chainConfig.name,
        shortName: chainConfig.shortName,
        icon: "",
        color: "#888",
        identityRegistry: chainConfig.identityRegistry,
        reputationRegistry: chainConfig.reputationRegistry,
        validationRegistry: chainConfig.validationRegistry,
        agentCount: 0,
        feedbackCount: 0,
        isActive: true,
        indexingEnabled: true,
        lastSyncedBlock: null,
        sourceConfigDigest,
      }],
      skipDuplicates: true,
    }));
    current = await withDbRetry(() => prisma.chain.findUnique({ where: { chainId }, select }));
    if (current && agentChainConfigMatches(current, chainConfig, sourceConfigDigest)) return;
  }
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const locked = await tx.chain.findUnique({ where: { chainId }, select });
    if (!locked) {
      await tx.chain.create({
        data: {
          chainId,
          name: chainConfig.name,
          shortName: chainConfig.shortName,
          icon: "",
          color: "#888",
          identityRegistry: chainConfig.identityRegistry,
          reputationRegistry: chainConfig.reputationRegistry,
          validationRegistry: chainConfig.validationRegistry,
          agentCount: 0,
          feedbackCount: 0,
          isActive: true,
          indexingEnabled: true,
          lastSyncedBlock: null,
          sourceConfigDigest,
        },
      });
      return;
    }
    if (agentChainConfigMatches(locked, chainConfig, sourceConfigDigest)) return;
    const identityRegistryChanged = locked.identityRegistry.toLowerCase() !== chainConfig.identityRegistry.toLowerCase();
    const reputationRegistryChanged = locked.reputationRegistry.toLowerCase() !== chainConfig.reputationRegistry.toLowerCase();
    const validationRegistryChanged = locked.validationRegistry.toLowerCase() !== chainConfig.validationRegistry.toLowerCase();
    await tx.chain.update({
      where: { chainId },
      data: {
        name: chainConfig.name,
        shortName: chainConfig.shortName,
        identityRegistry: chainConfig.identityRegistry,
        reputationRegistry: chainConfig.reputationRegistry,
        validationRegistry: chainConfig.validationRegistry,
        sourceConfigDigest,
      },
    });
    if (identityRegistryChanged) {
      await tx.agent.updateMany({
        where: {
          chainId,
          sourceRegistryAddress: locked.identityRegistry.toLowerCase(),
        },
        data: {
          sourceActive: false,
          sourceLifecycleStatus: "registry_replaced",
          publiclyActive: false,
          isActive: false,
        },
      });
    }
    if (reputationRegistryChanged) {
      await tx.feedback.deleteMany({
        where: {
          agent: { chainId },
          sourceRegistry: { equals: locked.reputationRegistry.toLowerCase(), mode: "insensitive" },
        },
      });
      await reconcileChainFeedbackCounts(tx, chainId);
    }
    if (validationRegistryChanged) {
      await tx.agentChainVerification.updateMany({
        where: { chainId },
        data: {
          verified: false,
          score: null,
          hasResponse: false,
          sourceFinality: "registry_replaced",
        },
      });
    }
  }, { isolationLevel: "Serializable" }));
}
async function ensureChainRow(chainId: number, chainConfig: AgentChainConfig): Promise<void> {
  if ((chainRowConfirmedUntil.get(chainId) ?? 0) > Date.now()) return;
  const existing = chainRowEnsureInFlight.get(chainId);
  if (existing) return existing;
  const operation = ensureChainRowUncoalesced(chainId, chainConfig);
  chainRowEnsureInFlight.set(chainId, operation);
  try {
    await operation;
    chainRowConfirmedUntil.set(chainId, Date.now() + CHAIN_ROW_REVALIDATE_MS);
  } finally {
    if (chainRowEnsureInFlight.get(chainId) === operation) chainRowEnsureInFlight.delete(chainId);
  }
}
type MaterializedService = {
  name: string;
  endpoint: string;
  version: string;
  sourceName: string | null;
  normalizedType: string | null;
  sourceEndpoint: string | null;
  endpointKind: string | null;
  endpointValid: boolean | null;
  sourceVersion: string | null;
  sourceDigest: string | null;
  sourceKind: string | null;
  skills: string[];
  domains: string[];
  capabilities: string[];
  extensions: Record<string, unknown>;
};
function parseServices(reg: RegistrationJson): MaterializedService[] {
  return listServiceEntries(reg).map((service) => ({
    name: normalizeChainString(service.normalizedType || service.name || "web", { label: "service name", maxBytes: 128, allowTruncation: true }).value,
    endpoint: sanitizeForPostgres(service.normalizedEndpoint ?? service.endpoint ?? ""),
    version: sanitizeForPostgres(service.version ?? ""),
    sourceName: service.name ? sanitizeForPostgres(service.name) : null,
    normalizedType: service.normalizedType ?? null,
    sourceEndpoint: service.endpoint ? sanitizeForPostgres(service.endpoint) : null,
    endpointKind: service.endpointKind ?? null,
    endpointValid: service.validationStatus == null ? null : service.validationStatus === "valid",
    sourceVersion: service.version ? sanitizeForPostgres(service.version) : null,
    sourceDigest: reg.rawDocumentDigest ?? null,
    sourceKind: "registration",
    skills: service.skills ?? [],
    domains: service.domains ?? [],
    capabilities: [
      ...(service.capabilities ?? []),
      ...(service.mcpTools ?? []),
      ...(service.a2aSkills ?? []),
    ],
    extensions: service.extensions ?? {},
  }));
}
function serviceCreateData(service: MaterializedService) {
  return {
    name: service.name,
    endpoint: service.endpoint,
    version: service.version ?? "",
    sourceName: service.sourceName,
    normalizedType: service.normalizedType,
    sourceEndpoint: service.sourceEndpoint,
    endpointKind: service.endpointKind,
    endpointValid: service.endpointValid,
    sourceVersion: service.sourceVersion,
    sourceDigest: service.sourceDigest,
    sourceKind: service.sourceKind,
    skills: service.skills,
    domains: service.domains,
    capabilities: service.capabilities,
    extensions: service.extensions as never,
  };
}
function serviceRowKey(service: { name: string; endpoint: string; version?: string }): string {
  return `${service.name}\0${service.endpoint}\0${service.version ?? ""}`;
}
type IdentityObservationProjection = {
  registeredOwner: string | null;
  status: string;
  transactionHash: string | null;
  transactionIndex: number | null;
  lastLogIndex: number | null;
};
async function sourceIdentityObservation(input: {
  chainId: number;
  registryAddress: string;
  protocolAgentId: string;
  sourceSnapshot?: SourceSnapshot;
}): Promise<IdentityObservationProjection | null> {
  const snapshot = input.sourceSnapshot;
  if (snapshot && Object.hasOwn(snapshot, "registeredOwner")) {
    return {
      registeredOwner: snapshot.registeredOwner ?? null,
      status: snapshot.finality ?? "finalized",
      transactionHash: snapshot.transactionHash ?? null,
      transactionIndex: snapshot.transactionIndex ?? null,
      lastLogIndex: snapshot.logIndex ?? null,
    };
  }
  return prisma.evmIdentityObservation.findFirst({
    where: {
      chainId: input.chainId,
      registryAddress: input.registryAddress,
      protocolAgentId: input.protocolAgentId,
      status: "finalized",
    },
    orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { lastLogIndex: "desc" }],
    select: {
      registeredOwner: true,
      status: true,
      transactionHash: true,
      transactionIndex: true,
      lastLogIndex: true,
    },
  });
}
async function reconcileReservedAgentWallet(
  tx: Prisma.TransactionClient,
  agentDatabaseId: number,
  wallet: string,
  sourceDigest: string | null,
): Promise<void> {
  const rows = await tx.agentMetadata.findMany({
    where: { agentId: agentDatabaseId, key: "agentWallet", chainControlled: true },
    orderBy: { id: "asc" },
  });
  const first = rows[0];
  if (first) {
    if (first.value !== wallet || first.sourceKind !== "onchain" || first.sourceDigest !== sourceDigest) {
      await tx.agentMetadata.update({
        where: { id: first.id },
        data: { value: wallet, sourceKind: "onchain", sourceDigest, chainControlled: true },
      });
    }
    if (rows.length > 1) await tx.agentMetadata.deleteMany({ where: { id: { in: rows.slice(1).map((row) => row.id) } } });
    return;
  }
  await tx.agentMetadata.create({
    data: {
      agentId: agentDatabaseId, key: "agentWallet", value: wallet,
      sourceKind: "onchain", sourceDigest, chainControlled: true,
    },
  });
}
async function reconcileRegistrationRelations(
  tx: Prisma.TransactionClient,
  agentId: number,
  desiredServices: MaterializedService[],
  desiredMetadata: Array<{ key: string; value: string }>,
  sourceDigest: string | null,
): Promise<void> {
  const currentServices = await tx.agentService.findMany({ where: { agentId, sourceKind: "registration" } });
  const desiredByKey = new Map<string, MaterializedService>();
  for (const service of desiredServices) desiredByKey.set(serviceRowKey(service), service);
  const staleServiceIds: number[] = [];
  const serviceUpdates: AgentServiceUpdate[] = [];
  for (const current of currentServices) {
    const key = serviceRowKey(current);
    const desired = desiredByKey.get(key);
    if (!desired) {
      staleServiceIds.push(current.id);
      continue;
    }
    desiredByKey.delete(key);
    const next = serviceCreateData(desired);
    if (
      current.sourceName !== next.sourceName || current.normalizedType !== next.normalizedType ||
      current.sourceEndpoint !== next.sourceEndpoint || current.endpointKind !== next.endpointKind ||
      current.endpointValid !== next.endpointValid || current.sourceVersion !== next.sourceVersion ||
      current.sourceDigest !== next.sourceDigest || current.sourceKind !== next.sourceKind ||
      !jsonEquivalent(current.skills, next.skills) ||
      !jsonEquivalent(current.domains, next.domains) ||
      !jsonEquivalent(current.capabilities, next.capabilities) ||
      !jsonEquivalent(current.extensions, next.extensions)
    ) {
      serviceUpdates.push({ id: current.id, data: next });
    }
  }
  await updateAgentServicesInBulk(tx, serviceUpdates);
  if (staleServiceIds.length > 0) {
    await tx.agentService.deleteMany({ where: { id: { in: staleServiceIds } } });
  }
  if (desiredByKey.size > 0) {
    await tx.agentService.createMany({
      data: [...desiredByKey.values()].map((service) => ({ agentId, ...serviceCreateData(service) })),
    });
  }
  const currentMetadata = await tx.agentMetadata.findMany({ where: { agentId, chainControlled: true } });
  const desiredByMetadataKey = new Map<string, string>();
  for (const entry of desiredMetadata) desiredByMetadataKey.set(entry.key, entry.value);
  const staleMetadataIds: number[] = [];
  const metadataUpdates: AgentMetadataUpdate[] = [];
  for (const current of currentMetadata) {
    const value = desiredByMetadataKey.get(current.key);
    if (value == null) {
      staleMetadataIds.push(current.id);
      continue;
    }
    desiredByMetadataKey.delete(current.key);
    if (current.value !== value || current.sourceKind !== "registration" || current.sourceDigest !== sourceDigest) {
      metadataUpdates.push({
        id: current.id,
        value,
        sourceKind: "registration",
        sourceDigest,
        chainControlled: true,
      });
    }
  }
  await updateAgentMetadataInBulk(tx, metadataUpdates);
  if (staleMetadataIds.length > 0) {
    await tx.agentMetadata.deleteMany({ where: { id: { in: staleMetadataIds } } });
  }
  if (desiredByMetadataKey.size > 0) {
    await tx.agentMetadata.createMany({
      data: [...desiredByMetadataKey].map(([key, value]) => ({
        agentId, key, value, sourceKind: "registration", sourceDigest, chainControlled: true,
      })),
    });
  }
}
const UNIVERSAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const MULTICALL_NEGATIVE_CACHE_TTL_MS = 5 * 60_000;
type RuntimeMulticallObservation = {
  available: boolean;
  checkedBlock: bigint;
  checkedAt: number;
};
const runtimeMulticallAvailability = new Map<number, RuntimeMulticallObservation>();
async function resolveRuntimeMulticall3(
  client: PublicClient,
  chainId: number,
  blockNumber: bigint,
): Promise<`0x${string}` | undefined> {
  const configured = client.chain?.contracts?.multicall3?.address;
  if (configured) return configured;
  const cached = runtimeMulticallAvailability.get(chainId);
  if (cached?.available) return UNIVERSAL_MULTICALL3;
  if (
    cached &&
    blockNumber <= cached.checkedBlock &&
    Date.now() - cached.checkedAt < MULTICALL_NEGATIVE_CACHE_TTL_MS
  ) {
    return undefined;
  }
  const code = await client.getBytecode({ address: UNIVERSAL_MULTICALL3, blockNumber });
  const available = Boolean(code && code !== "0x");
  runtimeMulticallAvailability.set(chainId, { available, checkedBlock: blockNumber, checkedAt: Date.now() });
  return available ? UNIVERSAL_MULTICALL3 : undefined;
}
async function readIdentitySnapshot(input: {
  chainId: number;
  registry: `0x${string}`;
  protocolAgentId: string;
  pinnedBlock?: bigint;
  pinnedHash?: `0x${string}`;
  signal?: AbortSignal;
}): Promise<{ uri: string; owner: string; agentWallet: string | null; walletStatus: "present" | "absent" | "unsupported" | "contract_error" | "malformed"; walletCapabilityStatus: string }> {
  throwIfAborted(input.signal);
  return withRpcFallback(input.chainId, async (client) => {
    throwIfAborted(input.signal);
    const tokenId = BigInt(input.protocolAgentId);
    const contracts = [
      { address: input.registry, abi: IDENTITY_ABI, functionName: "tokenURI", args: [tokenId] },
      { address: input.registry, abi: IDENTITY_ABI, functionName: "ownerOf", args: [tokenId] },
      { address: input.registry, abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [tokenId] },
    ] as const;
    // A single EIP-1898-pinned Multicall3 request gives all identity fields from the exact
    // canonical block hash. This avoids three independently reorg-sensitive eth_call reads.
    if (input.pinnedHash) {
      const multicallAddress = await resolveRuntimeMulticall3(client, input.chainId, input.pinnedBlock ?? 0n);
      if (multicallAddress) {
        try {
          const calls = contracts.map((contract, index) => ({
            target: contract.address,
            allowFailure: index === 2,
            callData: encodeFunctionData(contract),
          }));
          const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls] });
          const raw = await client.request({
            method: "eth_call",
            params: [
              { to: multicallAddress, data },
              { blockHash: input.pinnedHash, requireCanonical: true },
            ],
          } as never) as Hex;
          const results = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw });
          const uriResult = results[0];
          const ownerResult = results[1];
          const walletResult = results[2];
          if (!uriResult?.success || !ownerResult?.success) throw new Error("Pinned identity multicall returned a required-call failure");
          const uri = decodeFunctionResult({ abi: IDENTITY_ABI, functionName: "tokenURI", data: uriResult.returnData });
          const owner = decodeFunctionResult({ abi: IDENTITY_ABI, functionName: "ownerOf", data: ownerResult.returnData });
          let wallet: string | null = null;
          let walletStatus: "present" | "absent" | "unsupported" | "contract_error" | "malformed" = "contract_error";
          if (walletResult?.success) {
            try {
              wallet = String(decodeFunctionResult({ abi: IDENTITY_ABI, functionName: "getAgentWallet", data: walletResult.returnData }));
              walletStatus = /^0x[0-9a-fA-F]{40}$/.test(wallet)
                ? wallet === "0x0000000000000000000000000000000000000000" ? "absent" : "present"
                : "malformed";
            } catch { walletStatus = "malformed"; }
          }
          return { uri: String(uri), owner: String(owner), agentWallet: wallet, walletStatus, walletCapabilityStatus: walletResult?.success ? "supported" : "call_failed" };
        } catch (error) {
          const classification = classifyRpcError(error);
          if (classification !== "invalid_parameter" && classification !== "unsupported_tag") throw error;
          if (process.env.WORKER_RPC_DEBUG === "1") {
            logAgentSyncInfo("EIP-1898 identity multicall unsupported; using verified number-pinned compatibility path", {
              chainId: input.chainId,
              blockHash: input.pinnedHash,
              error: error instanceof Error ? error.message : String(error),
            }, "rpc");
          }
        }
      }
    }
    try {
      const multicallAddress = await resolveRuntimeMulticall3(client, input.chainId, input.pinnedBlock ?? 0n);
      if (!multicallAddress) throw new Error("Multicall3 is not deployed at the canonical address");
      const results = await client.multicall({
        contracts,
        multicallAddress,
        allowFailure: true,
        ...(input.pinnedBlock == null ? {} : { blockNumber: input.pinnedBlock }),
      });
      const uri = results[0];
      const owner = results[1];
      const wallet = results[2];
      if (uri.status !== "success") throw uri.error;
      if (owner.status !== "success") throw owner.error;
      const walletValue = wallet.status === "success" ? String(wallet.result) : null;
      const walletStatus = wallet.status !== "success" ? "contract_error" as const
        : !/^0x[0-9a-fA-F]{40}$/.test(walletValue!) ? "malformed" as const
        : walletValue === "0x0000000000000000000000000000000000000000" ? "absent" as const : "present" as const;
      return { uri: String(uri.result), owner: String(owner.result), agentWallet: walletValue, walletStatus, walletCapabilityStatus: wallet.status === "success" ? "supported" : "call_failed" };
    } catch (multicallError) {
      throwIfAborted(input.signal);
      const settled = await Promise.allSettled([
        client.readContract({ address: input.registry, abi: IDENTITY_ABI, functionName: "tokenURI", args: [tokenId], ...(input.pinnedBlock == null ? {} : { blockNumber: input.pinnedBlock }) }),
        client.readContract({ address: input.registry, abi: IDENTITY_ABI, functionName: "ownerOf", args: [tokenId], ...(input.pinnedBlock == null ? {} : { blockNumber: input.pinnedBlock }) }),
        client.readContract({ address: input.registry, abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [tokenId], ...(input.pinnedBlock == null ? {} : { blockNumber: input.pinnedBlock }) }),
      ]);
      const requiredFailures = settled.slice(0, 2).filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (requiredFailures.length === 1) throw requiredFailures[0].reason;
      if (requiredFailures.length > 1) throw new AggregateError(requiredFailures.map((failure) => failure.reason), "pinned identity reads failed");
      const uri = (settled[0] as PromiseFulfilledResult<unknown>).value;
      const owner = (settled[1] as PromiseFulfilledResult<unknown>).value;
      const walletResult = settled[2]!;
      let wallet: string | null = null;
      let walletStatus: "present" | "absent" | "unsupported" | "contract_error" | "malformed" = "contract_error";
      let walletCapabilityStatus = "call_failed";
      if (walletResult.status === "fulfilled") {
        wallet = String(walletResult.value);
        walletCapabilityStatus = "supported";
        walletStatus = !/^0x[0-9a-fA-F]{40}$/.test(wallet) ? "malformed"
          : wallet === "0x0000000000000000000000000000000000000000" ? "absent" : "present";
      } else {
        const classification = classifyRpcError(walletResult.reason);
        if (["method_not_found", "invalid_parameter"].includes(classification)) { walletStatus = "unsupported"; walletCapabilityStatus = "unsupported"; }
        else if (["transport_failure", "rate_limit", "provider_lag", "authentication"].includes(classification)) throw walletResult.reason;
      }
      if (multicallError instanceof Error && process.env.WORKER_RPC_DEBUG === "1") {
        logAgentSyncInfo("identity multicall unavailable; used pinned individual calls", { chainId: input.chainId, error: multicallError.message }, "rpc");
      }
      return { uri: String(uri), owner: String(owner), agentWallet: wallet, walletStatus, walletCapabilityStatus };
    }
  }, input.pinnedBlock == null
    ? { signal: input.signal, requiresCalls: true }
    : { blockNumber: input.pinnedBlock, blockHash: input.pinnedHash, signal: input.signal, requiresCalls: true });
}
export async function upsertAgentFromChain(
  chainId: number,
  sourceAgentId: string | number | bigint,
  options: {
    sourceSnapshot?: SourceSnapshot;
    signal?: AbortSignal;
    stageBusinessKey?: string;
    blocklistRules?: readonly AgentBlocklistRuleRow[];
  } = {},
): Promise<{ createdOrUpdated: boolean; outcomeReason?: string }> {
  throwIfAborted(options.signal);
  const protocolAgentId = canonicalUint256(typeof sourceAgentId === "number" ? BigInt(sourceAgentId) : sourceAgentId);
  const agentId = compatibleAgentInt(protocolAgentId);
  if (agentId == null) {
    logger.warn("agent cannot be projected into compatibility Int model", { chainId, protocolAgentId }, "sync");
    return { createdOrUpdated: false };
  }
  const chainConfig = getChainByChainId(chainId);
  const urls = getRpcUrls(chainId);
  if (!chainConfig || urls.length === 0) {
    throw new Error(`Missing chain config/RPC for chain ${chainId}`);
  }
  const identityRegistry = chainConfig.identityRegistry as `0x${string}`;
  const preBlockRules = options.blocklistRules ?? await loadActiveBlocklistRules();
  try {
    assertNotBlocklistedWithRules(preBlockRules, { name: "", agentURI: "", owner: "", chainId, agentId });
  } catch (error) {
    if (!(error instanceof AgentBlocklistError)) throw error;
    const changed = await prisma.agent.updateMany({
      where: {
        chainId,
        agentId,
        OR: [
          { moderationStatus: { not: "blocked" } },
          { publiclyActive: true },
          { isActive: true },
        ],
      },
      data: { moderationStatus: "blocked", publiclyActive: false, isActive: false, lastIndexedAt: new Date() },
    });
    return { createdOrUpdated: changed.count > 0, outcomeReason: "blocklisted_agent_key" };
  }
  const snapshot = options.sourceSnapshot;
  if (snapshot?.blockHash && snapshot.transactionHash && snapshot.logIndex != null) {
    const sourceEventKey = evmEventKey({
      chainId,
      contractAddress: identityRegistry,
      blockHash: snapshot.blockHash,
      transactionHash: snapshot.transactionHash,
      logIndex: snapshot.logIndex,
    });
    const sourceEvent = await prisma.evmEventObservation.findUnique({
      where: { eventKey: sourceEventKey },
      select: { status: true, removed: true },
    });
    if (sourceEvent?.removed || sourceEvent?.status === "orphaned" || sourceEvent?.status === "removed") {
      logAgentSyncInfo("agent-sync skipped because its source event is no longer canonical", {
        chainId,
        protocolAgentId,
        blockHash: snapshot.blockHash,
        transactionHash: snapshot.transactionHash,
        logIndex: snapshot.logIndex,
      }, "sync");
      return { createdOrUpdated: false };
    }
  }
  const observeIdentity = async () => {
    const finalitySnapshot = snapshot?.blockNumber == null
      ? await getRpcFinalitySnapshot(chainId, options.signal)
      : null;
    const pinnedBlock = snapshot?.blockNumber == null ? finalitySnapshot!.finalized : BigInt(snapshot.blockNumber);
    const pinnedHash = (snapshot?.blockHash ?? finalitySnapshot?.finalizedHash) as `0x${string}`;
    const identity = await readIdentitySnapshot({
      chainId,
      registry: identityRegistry,
      protocolAgentId,
      pinnedBlock,
      pinnedHash,
      signal: options.signal,
    });
    return {
      ...identity, pinnedBlock: pinnedBlock.toString(10), pinnedHash,
      finalityPolicy: snapshot?.finality ?? finalitySnapshot?.policy ?? "finalized",
    };
  };
  const observation = options.stageBusinessKey
    ? await runIdempotentStage({
        businessKey: options.stageBusinessKey,
        stage: "agent-observe",
        sourceObservationKey: snapshot?.transactionHash,
        operation: observeIdentity,
      })
    : await observeIdentity();
  const pinnedBlock = BigInt(observation.pinnedBlock);
  const pinnedHash = observation.pinnedHash as `0x${string}`;
  const { uri, owner, agentWallet, walletStatus, walletCapabilityStatus } = observation;
  throwIfAborted(options.signal);
  const normalizedRegistration = uri ? (() => {
    try { return normalizeRegistrationUri(uri); } catch { return null; }
  })() : null;
  const existingLite = await withDbRetry(() => prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: {
      id: true, name: true, description: true, image: true, agentURI: true, owner: true,
      isActive: true, x402Support: true, mppSupport: true, declaredActive: true, declaredX402Support: true, declaredMppSupport: true,
      protocolAgentId: true, registeredOwner: true, sourceEvidenceType: true, sourceFinality: true, sourceRegistryAddress: true,
      sourceBlockNumber: true, sourceBlockHash: true, sourceTransactionHash: true,
      sourceTransactionIndex: true, sourceLogIndex: true, registrationRawDigest: true,
      registrationSemanticFingerprint: true, registrationNormalizedUri: true,
      registrationContentAddress: true, chainIdentityFingerprint: true,
      chainRelationFingerprint: true, supportedTrust: true, walletHydrationStatus: true, walletCapabilityStatus: true, walletObservedBlock: true,
      sourceActive: true, sourceLifecycleStatus: true, moderationStatus: true, administrativeActiveOverride: true, publiclyActive: true,
      lastActiveAt: true, identityUpdatedAt: true, metadataUpdatedAt: true, activityObservedAt: true, lastIndexedAt: true,
      registrationStatus: true, registrationLastSuccessAt: true, registrationLastAttemptAt: true,
      registrationErrorClass: true, registrationErrorMessage: true, registrationNextRetryAt: true,
      metadata: { where: { key: "agentWallet", chainControlled: true }, select: { value: true }, take: 1 },
    },
  }));
  if (existingLite && sourceCoordinateIsOlder({
    incomingBlock: pinnedBlock,
    incomingTransactionIndex: options.sourceSnapshot?.transactionIndex,
    incomingLogIndex: options.sourceSnapshot?.logIndex,
    existingBlock: existingLite.sourceBlockNumber,
    existingTransactionIndex: existingLite.sourceTransactionIndex,
    existingLogIndex: existingLite.sourceLogIndex,
  })) {
    logAgentSyncInfo("agent-sync skipped stale source snapshot", {
      chainId,
      agentId,
      incomingBlock: pinnedBlock.toString(10),
      existingBlock: existingLite.sourceBlockNumber?.toString(10),
    }, "sync");
    return { createdOrUpdated: false, outcomeReason: "stale_source_snapshot" };
  }
  const ownerStrEarly = sanitizeForPostgres(String(owner));
  const walletString = agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000" ? agentWallet : "";
  const immutableRegistrationUnchanged = Boolean(
    existingLite && normalizedRegistration?.immutable &&
    existingLite.registrationNormalizedUri === normalizedRegistration.key &&
    existingLite.owner === ownerStrEarly &&
    (existingLite.metadata[0]?.value ?? "") === walletString
  );
  if (immutableRegistrationUnchanged && existingLite) {
    const sourceObservation = await sourceIdentityObservation({
      chainId,
      registryAddress: identityRegistry,
      protocolAgentId,
      sourceSnapshot: snapshot,
    });
    const chainIdentityFingerprint = createHash("sha256").update(JSON.stringify({
      protocolAgentId, uri: normalizedRegistration!.key, owner: ownerStrEarly, wallet: walletString,
    })).digest("hex");
    const sourceFields = {
      protocolAgentId,
      registeredOwner: sourceObservation?.registeredOwner ?? existingLite.registeredOwner,
      sourceEvidenceType: sourceObservation ? "event-decoded" : "contract-read",
      sourceFinality: snapshot?.finality ?? sourceObservation?.status ?? observation.finalityPolicy ?? "finalized",
      sourceRegistryAddress: chainConfig.identityRegistry.toLowerCase(),
      sourceBlockNumber: snapshot?.blockNumber == null ? pinnedBlock : BigInt(snapshot.blockNumber),
      sourceBlockHash: pinnedHash,
      sourceTransactionHash: snapshot?.transactionHash ?? sourceObservation?.transactionHash ?? null,
      sourceTransactionIndex: snapshot?.transactionIndex ?? sourceObservation?.transactionIndex ?? null,
      sourceLogIndex: snapshot?.logIndex ?? sourceObservation?.lastLogIndex ?? null,
      chainIdentityFingerprint,
      sourceActive: existingLite.sourceActive ?? true,
      sourceLifecycleStatus: existingLite.sourceLifecycleStatus ?? "active",
      identityUpdatedAt: existingLite.chainIdentityFingerprint === chainIdentityFingerprint
        ? existingLite.identityUpdatedAt
        : new Date(),
      lastIndexedAt: new Date(),
      walletHydrationStatus: walletStatus, walletCapabilityStatus, walletObservedBlock: pinnedBlock,
      registrationStatus: existingLite.registrationStatus ?? "valid",
    };
    const blockRules = preBlockRules;
    try {
      assertNotBlocklistedWithRules(blockRules, {
        name: existingLite.name, agentURI: uri, owner: ownerStrEarly, chainId, agentId,
      });
    } catch (error) {
      if (error instanceof AgentBlocklistError) {
        await prisma.agent.update({
          where: { id: existingLite.id },
          data: { isActive: false, publiclyActive: false, moderationStatus: "blocked", ...sourceFields },
        });
        return { createdOrUpdated: existingLite.isActive };
      }
      throw error;
    }
    const unchanged = existingLite.protocolAgentId === protocolAgentId &&
      existingLite.registeredOwner === sourceFields.registeredOwner &&
      existingLite.sourceEvidenceType === sourceFields.sourceEvidenceType &&
      existingLite.sourceFinality === sourceFields.sourceFinality &&
      existingLite.sourceRegistryAddress === sourceFields.sourceRegistryAddress &&
      existingLite.sourceBlockNumber === sourceFields.sourceBlockNumber &&
      existingLite.sourceBlockHash === sourceFields.sourceBlockHash &&
      existingLite.sourceTransactionHash === sourceFields.sourceTransactionHash &&
      existingLite.sourceTransactionIndex === sourceFields.sourceTransactionIndex &&
      existingLite.sourceLogIndex === sourceFields.sourceLogIndex &&
      existingLite.chainIdentityFingerprint === sourceFields.chainIdentityFingerprint;
    if (unchanged) {
      return { createdOrUpdated: false, outcomeReason: "immutable_registration_unchanged" };
    }
    await prisma.agent.update({ where: { id: existingLite.id }, data: sourceFields });
    await enqueueClusterReconcile({
      chainId, agentId, sourceObservationKey: snapshot?.transactionHash ?? `block:${pinnedHash}`,
    });
    return { createdOrUpdated: true };
  }
  const attemptMetadata = async () => {
    const attempt = await attemptRegistrationDocument(
      uri ?? "",
      METADATA_FETCH_TIMEOUT_MS,
      { chainId, registryAddress: identityRegistry, agentId: protocolAgentId },
      options.signal,
    );
    if (attempt.status === "valid") {
      return { status: attempt.status, registration: attempt.result.registration, errorClass: null, message: null, nextRetryAt: null };
    }
    if (attempt.status === "not_declared") {
      return { status: attempt.status, registration: null, errorClass: null, message: null, nextRetryAt: null };
    }
    return {
      status: attempt.status, registration: null, errorClass: attempt.errorClass,
      message: attempt.message, nextRetryAt: attempt.nextRetryAt?.toISOString() ?? null,
    };
  };
  const registrationAttempt = options.stageBusinessKey
    ? await runIdempotentStage({
        businessKey: `${options.stageBusinessKey}:${normalizedRegistration?.key ?? "no-uri"}`,
        stage: "agent-metadata",
        sourceObservationKey: snapshot?.transactionHash,
        operation: attemptMetadata,
        shouldCache: (result) => result.status !== "transient_unavailable",
      })
    : await attemptMetadata();
  const reg = registrationAttempt.status === "valid" ? registrationAttempt.registration : null;
  const reuseLastKnownGood = Boolean(existingLite && registrationAttempt.status !== "valid");
  throwIfAborted(options.signal);
  const name = sanitizeForPostgres(reg?.name ?? (reuseLastKnownGood ? existingLite!.name : `Agent #${protocolAgentId}`));
  const description = sanitizeForPostgres(reg?.description ?? (reuseLastKnownGood ? existingLite!.description : ""));
  const image = sanitizeForPostgres(reg?.image ?? (reuseLastKnownGood ? existingLite!.image : ""));
  const services = reg ? parseServices(reg) : [];
  // Only the reserved on-chain wallet is verified wallet evidence. A registration service
  const declaredX402Support = reg?.x402Support ?? (reuseLastKnownGood ? existingLite!.declaredX402Support : null);
  const declaredMppSupport = reg?.mppSupport ?? (reuseLastKnownGood ? existingLite!.declaredMppSupport : null);
  const declaredActive = reg?.active ?? (reuseLastKnownGood ? existingLite!.declaredActive : null);
  const rawMetadata = reg ? extractMetadata(reg, agentWallet) : extractMetadata(null, agentWallet);
  const metadataEntries = rawMetadata.map((e) => ({ key: sanitizeForPostgres(e.key), value: sanitizeForPostgres(e.value) }));
  const fp = reg ? registrationFingerprint(
    name,
    description,
    image,
    services.map((s) => ({ name: s.name, endpoint: s.endpoint })),
    declaredX402Support ?? false,
  ) : null;
  const metadataWithFingerprint = reg ? [
    ...metadataEntries.filter((e) => e.key !== "registrationFingerprint"),
    { key: "registrationFingerprint", value: fp! },
  ] : metadataEntries;
  const isJunk = isLowSignalListing(name, description, services);
  const agentURIStr = sanitizeForPostgres(uri ?? "");
  const ownerStr = sanitizeForPostgres(owner as string);
  throwIfAborted(options.signal);
  const sourceObservation = await sourceIdentityObservation({
    chainId,
    registryAddress: identityRegistry,
    protocolAgentId,
    sourceSnapshot: snapshot,
  });
  const now = new Date();
  const coreIdentityFingerprint = createHash("sha256").update(JSON.stringify({
    protocolAgentId, uri: normalizedRegistration?.key ?? agentURIStr, owner: ownerStr, agentWallet: agentWallet ?? null,
  })).digest("hex");
  const relationFingerprint = reuseLastKnownGood && existingLite?.chainRelationFingerprint
    ? existingLite.chainRelationFingerprint
    : createHash("sha256").update(JSON.stringify({
        services: sortedServices(services), metadata: sortedMetadata(metadataWithFingerprint),
      })).digest("hex");
  const identityChanged = !existingLite || existingLite.chainIdentityFingerprint !== coreIdentityFingerprint;
  const metadataChanged = registrationAttempt.status === "valid" &&
    (!existingLite || existingLite.registrationRawDigest !== reg?.rawDocumentDigest);
  const sourceActive = registrationAttempt.status === "valid"
    ? (declaredActive ?? true)
    : existingLite?.sourceActive ?? true;
  const registrationStatus = registrationAttempt.status === "valid"
    ? "valid"
    : registrationAttempt.status === "not_declared"
      ? "not_declared"
      : registrationAttempt.status;
  const sourceFields = {
    protocolAgentId,
    registeredOwner: sourceObservation?.registeredOwner ?? existingLite?.registeredOwner ?? "",
    declaredActive,
    declaredX402Support,
    declaredMppSupport,
    sourceEvidenceType: sourceObservation ? "event-decoded" : "contract-read",
    sourceFinality: snapshot?.finality ?? sourceObservation?.status ?? observation.finalityPolicy ?? "finalized",
    sourceRegistryAddress: chainConfig.identityRegistry.toLowerCase(),
    sourceBlockNumber: pinnedBlock,
    sourceBlockHash: pinnedHash,
    sourceTransactionHash: options.sourceSnapshot?.transactionHash ?? sourceObservation?.transactionHash ?? null,
    sourceTransactionIndex: options.sourceSnapshot?.transactionIndex ?? sourceObservation?.transactionIndex ?? null,
    sourceLogIndex: options.sourceSnapshot?.logIndex ?? sourceObservation?.lastLogIndex ?? null,
    registrationRawDigest: reg?.rawDocumentDigest ?? existingLite?.registrationRawDigest ?? null,
    registrationSemanticFingerprint: reg?.normalizedFingerprint ?? existingLite?.registrationSemanticFingerprint ?? null,
    registrationNormalizedUri: normalizedRegistration?.key ?? existingLite?.registrationNormalizedUri ?? null,
    registrationContentAddress: normalizedRegistration?.contentAddress ?? existingLite?.registrationContentAddress ?? null,
    chainIdentityFingerprint: coreIdentityFingerprint,
    chainRelationFingerprint: relationFingerprint,
    sourceActive,
    sourceLifecycleStatus: sourceActive ? "active" : "inactive",
    identityUpdatedAt: identityChanged ? now : existingLite?.identityUpdatedAt ?? null,
    metadataUpdatedAt: metadataChanged ? now : existingLite?.metadataUpdatedAt ?? null,
    lastIndexedAt: now,
    registrationStatus,
    registrationLastAttemptAt: now,
    registrationLastSuccessAt: registrationAttempt.status === "valid" ? now : existingLite?.registrationLastSuccessAt ?? null,
    registrationErrorClass: registrationAttempt.errorClass ?? null,
    registrationErrorMessage: registrationAttempt.message ?? null,
    registrationNextRetryAt: registrationAttempt.nextRetryAt ? new Date(registrationAttempt.nextRetryAt) : null,
    walletHydrationStatus: walletStatus,
    walletCapabilityStatus,
    walletObservedBlock: pinnedBlock,
  };
  throwIfAborted(options.signal);
  const blockRules = preBlockRules;
  throwIfAborted(options.signal);
  try {
    assertNotBlocklistedWithRules(blockRules, {
      name,
      agentURI: agentURIStr,
      owner: ownerStr,
      chainId,
      agentId,
    });
  } catch (e) {
    if (e instanceof AgentBlocklistError) {
      const deactivated = await prisma.agent.updateMany({
        where: { agentId, chainId, isActive: true },
        data: {
          isActive: false, publiclyActive: false, moderationStatus: "blocked",
          sourceFinality: sourceFields.sourceFinality, sourceBlockNumber: sourceFields.sourceBlockNumber,
          sourceBlockHash: sourceFields.sourceBlockHash, lastIndexedAt: now,
        },
      });
      logAgentSyncInfo("agents deactivated by blocklist", { chainId, latestAgentId: agentId, changed: deactivated.count });
      return { createdOrUpdated: deactivated.count > 0 };
    }
    throw e;
  }
  throwIfAborted(options.signal);
  const existing = existingLite;
  const paymentRails = resolveAgentPaymentRails({
    x402Support: existing?.x402Support,
    mppSupport: existing?.mppSupport,
    declaredX402Support,
    declaredMppSupport,
  });
  const x402Support = paymentRails.x402Support;
  const mppSupport = paymentRails.mppSupport;
  const supportedTrust = sanitizeForPostgres(
    Array.isArray(reg?.supportedTrust)
      ? reg.supportedTrust.join(", ")
      : existing?.supportedTrust ?? "reputation",
  );
  if (existing) {
    const relationsUnchanged = existing.chainRelationFingerprint === sourceFields.chainRelationFingerprint;
    const presentationChanged =
      existing.name !== name ||
      existing.description !== description ||
      existing.image !== image;
    // Identity or metadata maintenance is not behavioral activity. Freshness is
    // advanced only by qualifying activity/feedback paths.
    const lastActiveAnchor = existing.lastActiveAt;
    // Derived score fields are materialized by the dedicated score queue.
    const nextPubliclyActive = registrationAttempt.status === "valid"
      ? derivePublicActivation({
          sourceActive,
          moderationStatus: existing.moderationStatus,
          administrativeOverride: existing.administrativeActiveOverride,
          complete: true,
          lowSignal: isJunk,
        })
      : existing.publiclyActive;
    const nextIsActive = nextPubliclyActive;
    const relisted = false;
    const scalarUnchanged =
      existing.name === name &&
      existing.description === description &&
      existing.image === image &&
      existing.agentURI === agentURIStr &&
      existing.owner === ownerStr &&
      existing.isActive === nextIsActive &&
      existing.publiclyActive === nextPubliclyActive &&
      existing.sourceActive === sourceFields.sourceActive &&
      existing.x402Support === x402Support &&
      existing.mppSupport === mppSupport &&
      existing.supportedTrust === supportedTrust &&
      existing.lastActiveAt.getTime() === lastActiveAnchor.getTime() &&
      existing.protocolAgentId === sourceFields.protocolAgentId &&
      existing.registeredOwner === sourceFields.registeredOwner &&
      existing.declaredActive === sourceFields.declaredActive &&
      existing.declaredX402Support === sourceFields.declaredX402Support &&
      existing.declaredMppSupport === sourceFields.declaredMppSupport &&
      existing.sourceEvidenceType === sourceFields.sourceEvidenceType &&
      existing.sourceFinality === sourceFields.sourceFinality &&
      existing.sourceRegistryAddress === sourceFields.sourceRegistryAddress &&
      existing.sourceBlockNumber === sourceFields.sourceBlockNumber &&
      existing.sourceBlockHash === sourceFields.sourceBlockHash &&
      existing.sourceTransactionHash === sourceFields.sourceTransactionHash &&
      existing.sourceTransactionIndex === sourceFields.sourceTransactionIndex &&
      existing.sourceLogIndex === sourceFields.sourceLogIndex &&
      existing.registrationRawDigest === sourceFields.registrationRawDigest &&
      existing.registrationSemanticFingerprint === sourceFields.registrationSemanticFingerprint &&
      existing.registrationNormalizedUri === sourceFields.registrationNormalizedUri &&
      existing.registrationContentAddress === sourceFields.registrationContentAddress &&
      existing.chainIdentityFingerprint === sourceFields.chainIdentityFingerprint &&
      existing.chainRelationFingerprint === sourceFields.chainRelationFingerprint &&
      existing.registrationStatus === sourceFields.registrationStatus &&
      existing.registrationErrorClass === sourceFields.registrationErrorClass &&
      existing.registrationErrorMessage === sourceFields.registrationErrorMessage &&
      existing.registrationNextRetryAt?.getTime() === sourceFields.registrationNextRetryAt?.getTime() &&
      existing.walletHydrationStatus === sourceFields.walletHydrationStatus &&
      existing.walletCapabilityStatus === sourceFields.walletCapabilityStatus &&
      existing.walletObservedBlock === sourceFields.walletObservedBlock;
    if (!relisted && scalarUnchanged && relationsUnchanged) {
      return { createdOrUpdated: false };
    }
    await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: existing.id },
        data: {
          name,
          description,
          image,
          agentURI: agentURIStr,
          owner: ownerStr,
          ...sourceFields,
          isActive: nextIsActive,
          publiclyActive: nextPubliclyActive,
          ...(relisted ? { listedAt: new Date() } : {}),
          x402Support,
          mppSupport,
          supportedTrust,
          lastActiveAt: lastActiveAnchor,
        },
        select: { id: true },
      });
      await reconcileReservedAgentWallet(tx, existing.id, walletString, sourceFields.registrationRawDigest);
      if (!relationsUnchanged && registrationAttempt.status === "valid") {
        await reconcileRegistrationRelations(
          tx, existing.id, services, metadataWithFingerprint, reg?.rawDocumentDigest ?? null,
        );
      }
    }, {
      isolationLevel: "ReadCommitted",
      maxWait: 10_000,
      timeout: 30_000,
    }), 8);
  } else {
    await ensureChainRow(chainId, chainConfig);
    const initialPubliclyActive = registrationAttempt.status === "valid" && Boolean(sourceActive && !isJunk);
    await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.agent.findUnique({
        where: { agentId_chainId: { agentId, chainId } },
        select: { id: true },
      });
      const created = current == null;
      const row = created
        ? await tx.agent.create({
            data: {
              agentId, chainId, name, description, image, agentURI: agentURIStr, owner: ownerStr,
              ...sourceFields,
              moderationStatus: "inherit", publiclyActive: initialPubliclyActive, isActive: initialPubliclyActive,
              isVerified: false, rank: 0, x402Support, mppSupport, stars: 0, supportedTrust,
              lastActiveAt: now, listedAt: now,
            },
            select: { id: true },
          })
        : await tx.agent.update({
            where: { id: current.id },
            data: {
              name, description, image, agentURI: agentURIStr, owner: ownerStr, ...sourceFields,
              x402Support, mppSupport, supportedTrust,
            },
            select: { id: true },
          });
      await reconcileReservedAgentWallet(tx, row.id, walletString, sourceFields.registrationRawDigest);
      if (registrationAttempt.status === "valid") {
        await reconcileRegistrationRelations(tx, row.id, services, metadataWithFingerprint, reg?.rawDocumentDigest ?? null);
      }
      if (created) {
        await tx.chain.update({
          where: { chainId },
          data: { agentCount: { increment: 1 } },
        });
      }
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 }), 8);
  }
  await enqueueClusterReconcile({
    chainId, agentId,
    sourceObservationKey: options.sourceSnapshot?.transactionHash ?? `block:${pinnedHash}`,
  });
  return { createdOrUpdated: true };
}
export async function hydrateEvmRegistration(
  chainId: number,
  protocolAgentIdInput: string | bigint,
  uri: string,
  signal?: AbortSignal,
): Promise<"updated" | "unchanged" | "permanent_invalid" | "deferred"> {
  throwIfAborted(signal);
  const protocolAgentId = canonicalUint256(protocolAgentIdInput);
  const agentId = compatibleAgentInt(protocolAgentId);
  if (agentId == null) return "unchanged";
  const chainConfig = getChainByChainId(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain ${chainId}`);
  const existing = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    include: {
      metadata: true,
      services: true,
    },
  });
  if (!existing || existing.agentURI !== uri) return "unchanged";
  const attemptedAt = new Date();
  const attempt = await attemptRegistrationDocument(
    uri,
    METADATA_FETCH_TIMEOUT_MS,
    { chainId, registryAddress: chainConfig.identityRegistry, agentId: protocolAgentId },
    signal,
  );
  if (attempt.status !== "valid") {
    const errorClass = "errorClass" in attempt ? attempt.errorClass : null;
    const message = "message" in attempt ? attempt.message : null;
    const nextRetryAt = "nextRetryAt" in attempt ? attempt.nextRetryAt : null;
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        registrationStatus: attempt.status,
        registrationLastAttemptAt: attemptedAt,
        registrationErrorClass: errorClass,
        registrationErrorMessage: message,
        registrationNextRetryAt: nextRetryAt,
      },
    });
    if (attempt.status === "transient_unavailable") return "deferred";
    return attempt.status === "permanent_invalid" ? "permanent_invalid" : "unchanged";
  }
  const result = attempt.result;
  const reg = result.registration;
  const normalized = normalizeRegistrationUri(uri);
  const verifiedWallet = existing.metadata.find((entry) => entry.chainControlled && entry.sourceKind === "onchain" && entry.key === "agentWallet")?.value ?? null;
  const services = parseServices(reg);
  const metadata = extractMetadata(reg, verifiedWallet)
    .map((entry) => ({ key: sanitizeForPostgres(entry.key), value: sanitizeForPostgres(entry.value) }));
  const name = sanitizeForPostgres(reg.name ?? existing.name);
  const description = sanitizeForPostgres(reg.description ?? existing.description);
  const image = sanitizeForPostgres(reg.image ?? existing.image);
  const declaredActive = reg.active ?? null;
  const declaredX402Support = reg.x402Support ?? null;
  const declaredMppSupport = reg.mppSupport ?? null;
  const fp = registrationFingerprint(
    name,
    description,
    image,
    services.map((service) => ({ name: service.name, endpoint: service.endpoint })),
    declaredX402Support ?? false,
  );
  const metadataWithFingerprint = [
    ...metadata.filter((entry) => entry.key !== "registrationFingerprint"),
    { key: "registrationFingerprint", value: fp },
  ];
  const relationFingerprint = createHash("sha256").update(JSON.stringify({
    services: sortedServices(services),
    metadata: sortedMetadata(metadataWithFingerprint),
  })).digest("hex");
  const unchanged = existing.registrationRawDigest === result.decoded.rawDocumentDigest &&
    existing.chainRelationFingerprint === relationFingerprint &&
    existing.registrationStatus === "valid";
  if (unchanged) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        registrationLastAttemptAt: attemptedAt,
        registrationLastSuccessAt: attemptedAt,
        registrationErrorClass: null,
        registrationErrorMessage: null,
        registrationNextRetryAt: null,
      },
    });
    return "unchanged";
  }
  const blockRules = await loadActiveBlocklistRules();
  let blocked = false;
  try {
    assertNotBlocklistedWithRules(blockRules, { name, agentURI: uri, owner: existing.owner, chainId, agentId });
  } catch (error) {
    if (!(error instanceof AgentBlocklistError)) throw error;
    blocked = true;
  }
  const paymentRails = resolveAgentPaymentRails({
    x402Support: existing.x402Support,
    mppSupport: existing.mppSupport,
    declaredX402Support,
    declaredMppSupport,
  });
  const x402Support = paymentRails.x402Support;
  const mppSupport = paymentRails.mppSupport;
  const sourceActive = declaredActive ?? existing.sourceActive ?? true;
  const isJunk = isLowSignalListing(name, description, services);
  const publiclyActive = derivePublicActivation({
    sourceActive,
    moderationStatus: blocked ? "blocked" : existing.moderationStatus,
    administrativeOverride: existing.administrativeActiveOverride,
    complete: true,
    lowSignal: isJunk,
  });
  const supportedTrust = sanitizeForPostgres(
    Array.isArray(reg.supportedTrust) ? reg.supportedTrust.join(", ") : existing.supportedTrust,
  );
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: existing.id },
      data: {
        name,
        description,
        image,
        declaredActive,
        declaredX402Support,
        declaredMppSupport,
        sourceActive,
        sourceLifecycleStatus: sourceActive ? "active" : "inactive",
        publiclyActive,
        isActive: publiclyActive,
        x402Support,
        mppSupport,
        supportedTrust,
        registrationRawDigest: result.decoded.rawDocumentDigest,
        registrationSemanticFingerprint: result.decoded.normalizedFingerprint,
        registrationNormalizedUri: normalized.key,
        registrationContentAddress: normalized.contentAddress,
        registrationStatus: "valid",
        registrationLastAttemptAt: attemptedAt,
        registrationLastSuccessAt: attemptedAt,
        registrationErrorClass: null,
        registrationErrorMessage: null,
        registrationNextRetryAt: null,
        chainRelationFingerprint: relationFingerprint,
        metadataUpdatedAt: attemptedAt,
        moderationStatus: blocked ? "blocked" : existing.moderationStatus,
      },
    });
    await reconcileRegistrationRelations(
      tx,
      existing.id,
      services,
      metadataWithFingerprint,
      result.decoded.rawDocumentDigest,
    );
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 }), 8);
  await enqueueClusterReconcile({ chainId, agentId, sourceObservationKey: `registration:${result.decoded.rawDocumentDigest}` });
  return "updated";
}
async function withDbRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  const attempts = Math.max(1, Math.trunc(maxAttempts));
  for (let attempt = 1; ; attempt += 1) {
    throwIfAborted(currentJobRuntime()?.signal);
    try {
      return await operation();
    } catch (error) {
      const classification = classifyDatabaseError(error);
      if (attempt >= attempts || !isSafePreExecutionDatabaseRetry(error)) throw error;
      const delayMs = Math.round(Math.min(4_000, 400 * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4));
      currentRetryBudget()?.consumeAttempt(`database_${classification}`);
      currentRetryBudget()?.consumeDelay(delayMs);
      await sleep(delayMs, undefined, { signal: currentJobRuntime()?.signal });
    }
  }
}
const ACTIVE_BLOCKLIST_CACHE_TTL_MS = 30_000;
let activeBlocklistCache: { rules: AgentBlocklistRuleRow[]; expiresAt: number } | null = null;
let activeBlocklistLoad: Promise<AgentBlocklistRuleRow[]> | null = null;
export async function loadActiveBlocklistRules(): Promise<AgentBlocklistRuleRow[]> {
  const now = Date.now();
  if (activeBlocklistCache && activeBlocklistCache.expiresAt > now) return activeBlocklistCache.rules;
  if (activeBlocklistLoad) return activeBlocklistLoad;
  const pending = withDbRetry(async () => {
    const raw = Reflect.get(prisma as object, "agentBlocklistRule") as
      | { findMany: (args: unknown) => Promise<AgentBlocklistRuleRow[]> }
      | undefined;
    if (!raw?.findMany) {
      throw new Error("AgentBlocklistRule Prisma delegate is unavailable; refusing fail-open synchronization");
    }
    return raw.findMany({
      where: { active: true },
      select: { id: true, matchType: true, value: true, active: true },
    });
  });
  activeBlocklistLoad = pending;
  try {
    const rules = await pending;
    activeBlocklistCache = { rules, expiresAt: Date.now() + ACTIVE_BLOCKLIST_CACHE_TTL_MS };
    return rules;
  } finally {
    if (activeBlocklistLoad === pending) activeBlocklistLoad = null;
  }
}
