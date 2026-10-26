/**
 * Metaplex Agent Registry indexer — MPL Core assets with AgentIdentity plugin.
 * Single-asset indexing primitive used by the durable partner.metaplex.index worker.
 */
import { hash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplCore,
  fetchAsset,
  findAssetSignerPda,
} from "@metaplex-foundation/mpl-core";
import {
  mplAgentIdentity,
  findAgentIdentityV1Pda,
  findAgentIdentityV2Pda,
  safeFetchAgentIdentityV1FromSeeds,
  safeFetchAgentIdentityV2FromSeeds,
} from "@metaplex-foundation/mpl-agent-registry";
import { publicKey, unwrapOption } from "@metaplex-foundation/umi";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { computeAgentScore } from "@/lib/agent-score";
import { agentPublicPath, agentPublicUrl } from "@/lib/agent-public-url";
import { getPublicSiteUrl } from "@/lib/site-url";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { resolveImageUrl } from "@/lib/image-utils";
import {
  assertNotBlocklistedWithRules,
  AgentBlocklistError,
  type AgentBlocklistProbe,
} from "@/lib/agent-blocklist-logic";
import {
  fetchRegistrationDocumentAttempt,
  type RegistrationDocumentAttempt,
  type RegistrationDocumentFetchStatus,
} from "@/lib/registration-document";
import type { RegistrationJson } from "@/worker/indexer/sync/agent-metadata";
import {
  SOLANA_REGISTRY_SOURCE,
  type CurrentSolanaAgent,
  type SnapshotDescriptor,
} from "@/worker/indexer/sync/solana-current-state-types";
import {
  markMembershipSeen,
  touchUnchangedMembershipSeen,
} from "@/worker/indexer/sync/solana-registry-membership";
import {
  METAPLEX_LISTING_REGISTRY_SOURCE,
  METAPLEX_SOURCE_TYPE,
} from "@/lib/metaplex/config";
import { normalizeMetaplexRegistration } from "@/lib/metaplex/normalize";
import {
  clearMetaplexIndexError,
  recordMetaplexIndexFailure,
} from "@/lib/metaplex/index-error-store";
import { resolveMetaplexRpcUrl, redactMetaplexRpcUrlForLogs } from "@/lib/metaplex/rpc-config";
import {
  extractDasAgentRegistrationUri,
  fetchDasAsset,
  type DasAssetResult,
} from "@/lib/metaplex/das-client";
import type { DecodedCoreAsset } from "@/lib/metaplex/core-rpc-hydration";
import { MPL_AGENT_IDENTITY_PROGRAM_ID } from "@/lib/metaplex/discover-on-chain";
import {
  collectMetaplexNormKeys,
  resolveUniqueRegistryRowForMetaplexIdentity,
} from "@/lib/metaplex/metaplex-registry-twin-resolve";
import type { MetaplexIndexResult } from "@/lib/metaplex/types";
import { persistGenesisEnrichmentForAgent } from "@/lib/metaplex/genesis-hydration";
import { needsMetaplexGenesisHydration } from "@/lib/metaplex/genesis-hydration-state";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";
import {
  updateAgentServicesInBulk,
  type AgentServiceUpdate,
} from "@/worker/indexer/sync/relation-diff";
import { withSolanaSnapshotLock } from "@/worker/indexer/sync/solana-snapshot-lock";
import { throwIfAborted } from "@/worker/indexer/lib/abort";
import {
  assertSolanaRegistryAssetAttachable,
  convergeSolanaRegistryAssetRows,
} from "@/worker/indexer/sync/solana-registry-agent-resolver";
import { refreshSolanaRegistryAgentLifecycle } from "@/worker/indexer/sync/solana-registry-lifecycle";
import {
  acquireSolanaAgentIdentityLocks,
  acquireSolanaCompatibilityIdAllocatorLock,
  acquireSolanaSnapshotWriterFence,
} from "@/worker/indexer/sync/solana-agent-locks";
const METAPLEX_INDEXER_TX = { maxWait: 20_000, timeout: 120_000 } as const;
const BLOCKLIST_RULE_CACHE_MS = 30_000;
const METAPLEX_SYNC_FINGERPRINT_KEY = "syncFingerprint:metaplex";
const METAPLEX_METADATA_SOURCE_KIND = "metaplex-registration";
const METAPLEX_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  agentURI: true,
  owner: true,
  x402Support: true,
  sapAgentPda: true,
  sourceEvidenceType: true,
  sourceFinality: true,
  sourceRegistryAddress: true,
  registrationStatus: true,
  registrationErrorClass: true,
  registrationErrorMessage: true,
  registrationNextRetryAt: true,
  listingRegistrySource: true,
  binanceCompatible: true,
  totalFeedback: true,
  scoreQuality: true,
  supportedTrust: true,
  metaplexSupportedTrust: true,
  metaplexActive: true,
  metaplexRawData: true,
  metaplexAssetAddress: true,
  metaplexAgentIdentityPda: true,
  metaplexAgentRegistrationUri: true,
  metaplexAgentTokenMint: true,
  metaplexAssetSignerPda: true,
  metaplexVerified: true,
  metaplexTokenBindingStatus: true,
  metaplexTradeUrl: true,
  metaplexLaunchAddress: true,
} as const;
type MetaplexUmi = ReturnType<typeof createUmi>;
let sharedUmi: { rpcUrl: string; value: MetaplexUmi } | null = null;
function metaplexUmi(rpcUrl: string): MetaplexUmi {
  if (sharedUmi?.rpcUrl === rpcUrl) return sharedUmi.value;
  const value = createUmi(rpcUrl).use(mplCore()).use(mplAgentIdentity());
  sharedUmi = { rpcUrl, value };
  return value;
}
type ActiveBlocklistRule = {
  id: string;
  matchType: string;
  value: string;
  active: boolean;
};
let activeBlocklistCache: { expiresAt: number; rules: ActiveBlocklistRule[] } | null = null;
let activeBlocklistLoad: Promise<ActiveBlocklistRule[]> | null = null;
async function activeBlocklistRules(): Promise<ActiveBlocklistRule[]> {
  const now = Date.now();
  if (activeBlocklistCache && activeBlocklistCache.expiresAt > now) {
    return activeBlocklistCache.rules;
  }
  if (activeBlocklistLoad) return activeBlocklistLoad;
  const load = prisma.agentBlocklistRule.findMany({
    where: { active: true },
    select: { id: true, matchType: true, value: true, active: true },
  }).then((rules) => {
    activeBlocklistCache = { expiresAt: Date.now() + BLOCKLIST_RULE_CACHE_MS, rules };
    return rules;
  });
  activeBlocklistLoad = load;
  void load.then(
    () => { if (activeBlocklistLoad === load) activeBlocklistLoad = null; },
    () => { if (activeBlocklistLoad === load) activeBlocklistLoad = null; },
  );
  return load;
}
async function assertNotBlocklisted(agent: AgentBlocklistProbe): Promise<void> {
  assertNotBlocklistedWithRules(await activeBlocklistRules(), agent);
}
function sanitizePg(s: string): string {
  return s.replace(/\0/g, "");
}
function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function canonicalSolanaAddress(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}
function dasEvidence(asset: DasAssetResult): Record<string, unknown> {
  return {
    id: asset.id,
    content: asset.content ?? null,
    ownership: asset.ownership ?? null,
    authorities: asset.authorities ?? null,
    assetSigner: canonicalSolanaAddress(asset.asset_signer),
    agentToken: canonicalSolanaAddress(asset.agent_token),
    isAgent: asset.is_agent === true,
    agentRegistrationUri: extractDasAgentRegistrationUri(asset),
  };
}
function portableOnchainValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[max-depth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.replace(/\0/g, "");
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Uint8Array) return { encoding: "base64", data: Buffer.from(value).toString("base64"), byteLength: value.byteLength };
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => portableOnchainValue(item, depth + 1));
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), portableOnchainValue(item, depth + 1)]));
  if (typeof value === "object") {
    const maybeString = (value as { toString?: () => string }).toString;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && typeof maybeString === "function") {
      const stringValue = maybeString.call(value);
      if (stringValue !== "[object Object]") return stringValue;
    }
    return Object.fromEntries(entries.slice(0, 2_000).map(([key, item]) => [key, portableOnchainValue(item, depth + 1)]));
  }
  return String(value);
}
async function upsertManuallyVerifiedMetaplexMembership(
  tx: Prisma.TransactionClient,
  input: { agentDbId: number; assetAddress: string; sourceActive: boolean | null; rawData: Prisma.InputJsonValue },
): Promise<void> {
  const now = new Date();
  await tx.solanaRegistryMembership.upsert({
    where: {
      source_externalId: {
        source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
        externalId: input.assetAddress,
      },
    },
    create: {
      source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
      externalId: input.assetAddress,
      registryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
      agentDbId: input.agentDbId,
      isCurrent: true,
      sourceActive: input.sourceActive,
      lastSeenGeneration: 0n,
      sourceSlot: null,
      sourceUpdatedAt: null,
      rawData: input.rawData,
      lastSeenAt: now,
    },
    update: {
      registryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
      agentDbId: input.agentDbId,
      isCurrent: true,
      sourceActive: input.sourceActive,
      rawData: input.rawData,
      lastSeenAt: now,
      // Preserve the latest snapshot generation. Generation zero is only the
      // bootstrap value for a membership first proven by a direct account read.
    },
  });
  await refreshSolanaRegistryAgentLifecycle(tx, input.agentDbId);
}
async function ensureSolanaChain(tx: Prisma.TransactionClient): Promise<void> {
  const chainConfig = getChainByChainId(SOLANA_CHAIN_ID);
  if (!chainConfig) throw new Error("Solana chain config missing");
  await tx.chain.createMany({
    data: [{
      chainId: SOLANA_CHAIN_ID,
      name: chainConfig.name,
      shortName: chainConfig.shortName,
      icon: chainConfig.icon ?? "",
      color: chainConfig.color ?? "#9945FF",
      identityRegistry: chainConfig.identityRegistry ?? "",
      reputationRegistry: chainConfig.reputationRegistry ?? "",
    }],
    skipDuplicates: true,
  });
}
async function nextSolanaAgentId(tx: Prisma.TransactionClient): Promise<number> {
  await acquireSolanaCompatibilityIdAllocatorLock(tx);
  const agg = await tx.agent.aggregate({
    where: { chainId: SOLANA_CHAIN_ID },
    _max: { agentId: true },
  });
  const maxAgentId = agg._max.agentId ?? 0;
  if (maxAgentId >= 2_147_483_647) throw new Error("Solana local agent ID space is exhausted");
  return maxAgentId + 1;
}
async function replaceServices(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  services: Array<{ name: string; endpoint: string; version: string; skills?: string[]; domains?: string[]; capabilities?: string[]; extensions?: Record<string, unknown> }>,
): Promise<void> {
  const desired = services.map((service) => {
    const normalized = normalizedAgentServiceData(service, { sourceKind: "metaplex-registration" });
    return {
      ...normalized,
      sourceDigest: hash("sha256", JSON.stringify(normalized), "hex").slice(0, 32),
    };
  });
  const key = (service: { sourceName?: string | null; name: string; sourceEndpoint?: string | null; endpoint: string; sourceVersion?: string | null; version: string }) =>
    `${service.sourceName ?? service.name}\0${service.sourceEndpoint ?? service.endpoint}\0${service.sourceVersion ?? service.version}`;
  const remaining = new Map(desired.map((service) => [key(service), service]));
  const existing = await tx.agentService.findMany({
    where: { agentId: agentDbId, sourceKind: METAPLEX_METADATA_SOURCE_KIND },
    select: { id: true, name: true, endpoint: true, version: true, sourceName: true, sourceEndpoint: true, sourceVersion: true, sourceDigest: true },
  });
  const deleteIds: number[] = [];
  const updates: AgentServiceUpdate[] = [];
  for (const row of existing) {
    const rowKey = key(row);
    const next = remaining.get(rowKey);
    if (!next) {
      deleteIds.push(row.id);
      continue;
    }
    remaining.delete(rowKey);
    if (row.sourceDigest === next.sourceDigest) continue;
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
function buildMetadataEntries(
  reg: RegistrationJson | null,
  assetSignerPda: string,
  fingerprint: string,
): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [
    { key: "metaplexRegistry", value: "metaplex" },
    { key: METAPLEX_SYNC_FINGERPRINT_KEY, value: fingerprint },
  ];
  if (assetSignerPda) entries.push({ key: "agentWallet", value: assetSignerPda });
  if (reg?.type != null) {
    const typeVal = Array.isArray(reg.type) ? JSON.stringify(reg.type) : String(reg.type);
    entries.push({ key: "type", value: typeVal });
  }
  if (reg?.active != null) entries.push({ key: "active", value: reg.active ? "true" : "false" });
  if (Array.isArray(reg?.registrations) && reg.registrations.length > 0) {
    entries.push({ key: "registrations", value: JSON.stringify(reg.registrations) });
  }
  if (Array.isArray(reg?.services) && reg.services.length > 0) {
    entries.push({ key: "serviceDeclarations", value: JSON.stringify(reg.services) });
  }
  const supportedTrust = (reg as { supportedTrust?: string[] } | null)?.supportedTrust;
  if (Array.isArray(supportedTrust) && supportedTrust.length > 0) {
    entries.push({ key: "supportedTrust", value: JSON.stringify(supportedTrust) });
  }
  return entries;
}
async function replaceMetaplexMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  entries: Array<{ key: string; value: string }>,
  replaceDocumentDerived: boolean,
): Promise<void> {
  // Registry-derived metadata must be reconciled inside its own namespace.
  // Deleting by key alone can remove canonical EVM registration metadata when
  // a Metaplex identity is attached to an ERC-8004 twin.
  const currentKeys = entries.map((entry) => entry.key);
  await tx.agentMetadata.deleteMany({
    where: {
      agentId: agentDbId,
      OR: [
        {
          sourceKind: METAPLEX_METADATA_SOURCE_KIND,
          ...(replaceDocumentDerived ? {} : { key: { in: currentKeys } }),
        },
        {
          sourceKind: null,
          key: { in: ["metaplexRegistry", METAPLEX_SYNC_FINGERPRINT_KEY] },
        },
      ],
    },
  });
  if (entries.length === 0) return;
  const sourceDigest = entries.find((entry) => entry.key === METAPLEX_SYNC_FINGERPRINT_KEY)?.value ?? null;
  await tx.agentMetadata.createMany({
    data: entries.map((entry) => ({
      agentId: agentDbId,
      key: entry.key,
      value: entry.value.slice(0, 48000),
      sourceKind: METAPLEX_METADATA_SOURCE_KIND,
      sourceDigest,
    })),
    skipDuplicates: true,
  });
}
function metaplexSyncFingerprint(payload: Record<string, unknown>): string {
  // The payload is constructed below with a fixed property order. A replacer
  // array built from only the top-level keys would strip nested service/trust
  // fields, causing materially different registrations to share a fingerprint.
  return hash("sha256", JSON.stringify(payload), "hex").slice(0, 32);
}
type ChainFetchResult = {
  assetAddress: string;
  assetName: string;
  assetUri: string;
  owner: string;
  creator: string;
  registrationUri: string;
  agentIdentityPda: string;
  assetSignerPda: string;
  agentTokenMint: string | null;
  tokenBindingStatus: "bound" | "unbound" | "unknown";
  metaplexVerified: boolean;
  hasAgentIdentityPlugin: boolean;
  coreProofHydration: "rpc-batch" | "rpc-single";
  rawSnapshot: Record<string, unknown>;
};
export type MetaplexIndexHint = {
  snapshotLockHeld: true;
  snapshotDescriptor: SnapshotDescriptor;
  identityPda: string;
  identityVersion: 1 | 2;
  sourceSlot: bigint;
  dasAsset?: DasAssetResult;
  decodedCoreAsset?: DecodedCoreAsset;
  priorAgentDbId?: number;
  priorSyncFingerprint?: string | null;
  priorHasCurrentSolana8004Membership?: boolean;
  priorRegistrationUri?: string | null;
  priorRegistrationJson?: RegistrationJson | null;
  priorRegistrationStatus?: RegistrationDocumentFetchStatus | null;
  priorRegistrationErrorClass?: string | null;
  priorRegistrationErrorMessage?: string | null;
  priorRegistrationNextRetryAt?: Date | null;
  refreshRegistrationDocument?: boolean;
  signal?: AbortSignal;
};

function reusableRegistrationAttempt(
  chainRegistrationUri: string,
  hint?: MetaplexIndexHint,
): RegistrationDocumentAttempt<RegistrationJson> | null {
  if (!hint || hint.refreshRegistrationDocument !== false) return null;
  if ((hint.priorRegistrationUri ?? "").trim() !== chainRegistrationUri.trim()) return null;
  const status = hint.priorRegistrationStatus;
  if (!status) return null;
  const document = hint.priorRegistrationJson ?? null;
  if (status === "available" && document == null) return null;
  return {
    status,
    data: status === "available" ? document : null,
    errorClass: hint.priorRegistrationErrorClass ?? null,
    errorMessage: hint.priorRegistrationErrorMessage ?? null,
    nextRetryAt: hint.priorRegistrationNextRetryAt ?? null,
  };
}
async function fetchMetaplexChainData(
  assetAddress: string,
  hint?: MetaplexIndexHint,
  operationSignal: AbortSignal | undefined = hint?.signal,
): Promise<ChainFetchResult> {
  const trimmed = assetAddress.trim();
  let assetPk: ReturnType<typeof publicKey>;
  try {
    assetPk = publicKey(trimmed);
    new PublicKey(trimmed);
  } catch {
    throw new Error("Invalid Solana asset address.");
  }
  const rpcUrl = resolveMetaplexRpcUrl();
  const umi = metaplexUmi(rpcUrl);
  let assetName = "";
  let assetUri = "";
  let owner = "";
  let creator = "";
  let registrationUri = "";
  let hasAgentIdentityPlugin = false;
  let coreAssetPresent = false;
  const rawSnapshot: Record<string, unknown> = { rpc: redactMetaplexRpcUrlForLogs(rpcUrl) };
  let hydratedDas: DasAssetResult | null = hint?.dasAsset ?? null;
  const applyCoreAsset = (asset: DecodedCoreAsset): void => {
    coreAssetPresent = true;
    assetName = asset.name ?? "";
    assetUri = asset.uri ?? "";
    owner = asset.owner?.toString() ?? "";
    const plugin = asset.agentIdentities?.[0];
    if (plugin?.uri) {
      registrationUri = plugin.uri;
      hasAgentIdentityPlugin = true;
    }
    const updateAuthority = asset.updateAuthority?.address?.toString?.() ?? null;
    creator = updateAuthority ?? "";
    rawSnapshot.asset = portableOnchainValue(asset) as Record<string, unknown>;
    rawSnapshot.core = {
      name: assetName,
      uri: assetUri,
      owner,
      updateAuthority,
      agentIdentityPlugin: portableOnchainValue(plugin ?? null),
      lifecycleChecks: portableOnchainValue(plugin?.lifecycleChecks ?? null),
      pluginAuthority: portableOnchainValue((plugin as { authority?: unknown } | undefined)?.authority ?? null),
    };
  };
  const applyDasAsset = (das: DasAssetResult): void => {
    // DAS may normalize parsed fields, but it is never accepted as proof that
    // the Core account exists or is owned by MPL Core.
    if (!assetName) assetName = das.content?.metadata?.name ?? "";
    if (!assetUri) assetUri = das.content?.json_uri ?? "";
    if (!owner) owner = das.ownership?.owner ?? "";
    const dasRegistrationUri = extractDasAgentRegistrationUri(das);
    if (!registrationUri && dasRegistrationUri) registrationUri = dasRegistrationUri;
    rawSnapshot.das = dasEvidence(das);
  };
  try {
    applyCoreAsset(hint?.decodedCoreAsset ?? await fetchAsset(umi, assetPk, { commitment: "finalized" }));
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    throw new Error(`Failed to fetch or decode MPL Core asset (${msg}).`);
  }
  if (!hydratedDas && !hint) {
    try {
      hydratedDas = await fetchDasAsset(trimmed, operationSignal);
    } catch (error) {
      if (operationSignal?.aborted) throw operationSignal.reason ?? error;
      rawSnapshot.dasError = sanitizePg(Error.isError(error) ? error.message : String(error));
    }
  }
  if (hydratedDas) applyDasAsset(hydratedDas);
  const identityV2Pda = findAgentIdentityV2Pda(umi, { asset: assetPk });
  const identityV1Pda = findAgentIdentityV1Pda(umi, { asset: assetPk });
  const identityV2Address = identityV2Pda[0];
  const identityV1Address = identityV1Pda[0];
  if (hint) {
    const expectedIdentityPda = hint.identityVersion === 2 ? identityV2Address : identityV1Address;
    if (hint.identityPda !== expectedIdentityPda) {
      throw new Error(
        `Discovered AgentIdentity V${hint.identityVersion} PDA ${hint.identityPda} does not match derived PDA ${expectedIdentityPda}.`,
      );
    }
  }
  const identityV2 = hint ? null : await safeFetchAgentIdentityV2FromSeeds(umi, { asset: assetPk }, { commitment: "finalized" });
  const identityV1 = hint || identityV2
    ? null
    : await safeFetchAgentIdentityV1FromSeeds(umi, { asset: assetPk }, { commitment: "finalized" });
  const identity = identityV2 ?? identityV1;
  const identityVersion = hint?.identityVersion ?? (identityV2 ? 2 : 1);
  const agentIdentityPda = hint?.identityPda ?? (identityV2 ? identityV2Address : identityV1Address);
  const assetSignerPda = findAssetSignerPda(umi, { asset: assetPk })[0];
  const dasAgentTokenMint = canonicalSolanaAddress(hydratedDas?.agent_token);
  let agentTokenMint: string | null = null;
  if (identityV2) {
    const token = unwrapOption(identityV2.agentToken);
    if (token) agentTokenMint = token.toString();
  }
  // A V2 discovery hint proves the identity account exists, but the 40-byte
  // inventory slice does not include its optional token field. DAS may report
  // a token as enrichment, but it cannot establish the binding. Keep the
  // persisted binding unknown until a full finalized identity account read
  // proves the token or proves its absence.
  const tokenBindingStatus: "bound" | "unbound" | "unknown" = identityV2
    ? (agentTokenMint ? "bound" : "unbound")
    : hint?.identityVersion === 2
      ? "unknown"
      : "unbound";
  const identityPresent = Boolean(hint || identity);
  if (!identityPresent) {
    throw new Error("Asset is not a registered Metaplex agent (no AgentIdentity plugin or identity PDA).");
  }
  const identityAsset = hint ? trimmed : identity?.asset?.toString() ?? "";
  const metaplexVerified =
    coreAssetPresent &&
    identityPresent &&
    hasAgentIdentityPlugin &&
    (identityAsset === "" || identityAsset === trimmed);
  rawSnapshot.identity = identityPresent
    ? {
        pda: agentIdentityPda,
        asset: identityAsset,
        version: identityVersion,
        agentTokenMint,
        sourceSlot: hint?.sourceSlot.toString(10) ?? null,
        account: identity ? portableOnchainValue(identity) : null,
      }
    : null;
  rawSnapshot.derived = {
    identityV1Pda: identityV1Address,
    identityV2Pda: identityV2Address,
    selectedIdentityPda: agentIdentityPda,
    assetSignerPda,
  };
  if (hydratedDas) {
    const dasRecord = hydratedDas as unknown as Record<string, unknown>;
    const dasAssetSigner = canonicalSolanaAddress(dasRecord.asset_signer);
    const dasAgentToken = canonicalSolanaAddress(dasRecord.agent_token);
    rawSnapshot.verification = {
      pluginPresent: hasAgentIdentityPlugin,
      identityAccountPresent: identityPresent,
      identityAssetMatches: identityAsset === "" || identityAsset === trimmed,
      dasIsAgent: dasRecord.is_agent === true,
      assetSignerMatchesDas: dasAssetSigner == null ? null : dasAssetSigner === assetSignerPda,
      agentTokenMatchesDas: hint?.identityVersion === 2
        ? null
        : dasAgentToken == null
          ? agentTokenMint == null
          : dasAgentToken === agentTokenMint,
      dasAgentTokenMint,
      agentTokenBindingEvidence: hint?.identityVersion === 2 ? "unverified-das-enrichment" : "identity-account",
    };
  }
  return {
    assetAddress: trimmed,
    assetName,
    assetUri,
    owner,
    creator,
    registrationUri,
    agentIdentityPda,
    assetSignerPda,
    agentTokenMint,
    tokenBindingStatus,
    metaplexVerified,
    hasAgentIdentityPlugin,
    coreProofHydration: hint?.decodedCoreAsset ? "rpc-batch" : "rpc-single",
    rawSnapshot,
  };
}
async function assertManualMetaplexIndexingAllowed(): Promise<void> {
  const runningSnapshot = await prisma.solanaRegistrySnapshot.findFirst({
    where: { source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY, status: "running" },
    select: { source: true, generation: true },
    orderBy: { startedAt: "desc" },
  });
  if (!runningSnapshot) return;
  await prisma.solanaRegistrySnapshot.updateMany({
    where: {
      source: runningSnapshot.source,
      generation: runningSnapshot.generation,
      status: "running",
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage: "Metaplex snapshot lost its source-scoped distributed mutex before completion",
    },
  });
  throw new Error(
    `Recovered orphaned Metaplex snapshot generation ${runningSnapshot.generation}; retry manual indexing after the prior writer drains`,
  );
}
async function assertNoRunningMetaplexSnapshot(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const runningSnapshot = await tx.solanaRegistrySnapshot.findFirst({
    where: { source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY, status: "running" },
    orderBy: [{ startedAt: "asc" }, { generation: "asc" }],
    select: { source: true, generation: true },
  });
  if (runningSnapshot) {
    throw new Error(
      `${runningSnapshot.source} snapshot generation ${runningSnapshot.generation} is still running`,
    );
  }
}
export async function withMetaplexManualIndexLock<T>(
  signal: AbortSignal | undefined,
  operation: (lockedSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  return withSolanaSnapshotLock("metaplex-agent-registry", signal, async (lockedSignal) => {
    await assertManualMetaplexIndexingAllowed();
    if (lockedSignal.aborted) throw lockedSignal.reason ?? new Error("Metaplex indexing aborted");
    return operation(lockedSignal);
  });
}
export async function indexMetaplexAgentWithSnapshotLockHeld(
  assetAddress: string,
  signal?: AbortSignal,
): Promise<MetaplexIndexResult> {
  const trimmed = assetAddress.trim();
  try {
    return await indexMetaplexAgentInner(trimmed, undefined, signal);
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    recordMetaplexIndexFailure(trimmed, msg);
    throw err;
  }
}
export async function indexMetaplexAgent(assetAddress: string, hint?: MetaplexIndexHint): Promise<MetaplexIndexResult> {
  const trimmed = assetAddress.trim();
  try {
    return hint?.snapshotLockHeld === true
      ? await indexMetaplexAgentInner(trimmed, hint, hint.signal)
      : await withMetaplexManualIndexLock(undefined, (lockedSignal) =>
          indexMetaplexAgentInner(trimmed, undefined, lockedSignal),
        );
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    recordMetaplexIndexFailure(trimmed, msg);
    throw err;
  }
}
async function indexMetaplexAgentInner(
  assetAddress: string,
  hint?: MetaplexIndexHint,
  operationSignal: AbortSignal | undefined = hint?.signal,
): Promise<MetaplexIndexResult> {
  if (operationSignal?.aborted) throw operationSignal.reason ?? new Error("Metaplex indexing aborted");
  const chain = await fetchMetaplexChainData(assetAddress, hint, operationSignal);
  if (operationSignal?.aborted) throw operationSignal.reason ?? new Error("Metaplex indexing aborted");
  const priorAttempt = reusableRegistrationAttempt(chain.registrationUri, hint);
  const registrationAttempt = priorAttempt ??
    await fetchRegistrationDocumentAttempt<RegistrationJson>(
      chain.registrationUri,
      {
        httpsTimeoutMs: Number(process.env.URI_ENRICH_TIMEOUT_MS ?? 8_000) || 8_000,
        signal: operationSignal,
      },
    );
  if (operationSignal?.aborted) throw operationSignal.reason ?? new Error("Metaplex indexing aborted");
  const registrationAvailable = registrationAttempt.status === "available";
  const samePriorRegistrationUri =
    (hint?.priorRegistrationUri ?? "").trim() === chain.registrationUri.trim();
  // A failed refresh changes availability/retry state, but it must not replace
  // the last known registration projection with Core-name fallbacks. Keeping the
  // prior document also leaves the semantic fingerprint stable, so only the
  // failure-state scalars need to be written once.
  const reg = registrationAvailable
    ? registrationAttempt.data
    : samePriorRegistrationUri
      ? hint?.priorRegistrationJson ?? null
      : null;
  const normalized = normalizeMetaplexRegistration(reg, {
    assetName: chain.assetName,
    assetUri: chain.assetUri,
  });
  const name = sanitizePg(normalized.name);
  const description = sanitizePg(normalized.description);
  const imageRaw = sanitizePg(normalized.image);
  const image = resolveImageUrl(imageRaw) ?? imageRaw;
  const agentURI = sanitizePg(chain.registrationUri);
  const owner = sanitizePg(chain.owner);
  const services = normalized.services;
  const x402Support = normalized.x402Support ?? services.some((s) => s.name === "X402");
  const fingerprint = metaplexSyncFingerprint({
    asset: chain.assetAddress,
    assetUri: chain.assetUri,
    owner: chain.owner,
    creator: chain.creator,
    registrationUri: chain.registrationUri,
    agentIdentityPda: chain.agentIdentityPda,
    assetSignerPda: chain.assetSignerPda,
    name,
    description,
    image,
    services,
    metaplexVerified: chain.metaplexVerified,
    agentTokenMint: chain.agentTokenMint,
    tokenBindingStatus: chain.tokenBindingStatus,
    type: normalized.type,
    registrations: normalized.registrations,
    supportedTrust: normalized.supportedTrust,
    active: normalized.active,
    x402Support: normalized.x402Support,
  });
  const metadataEntries = buildMetadataEntries(reg, chain.assetSignerPda, fingerprint);
  const rawMetaplexData = portableOnchainValue({
    ...chain.rawSnapshot,
    registration: {
      status: registrationAttempt.status,
      errorClass: registrationAttempt.errorClass,
      errorMessage: registrationAttempt.errorMessage ? sanitizePg(registrationAttempt.errorMessage) : null,
      nextRetryAt: registrationAttempt.nextRetryAt?.toISOString() ?? null,
    },
    registrationJson: reg ?? null,
    indexedAt: new Date().toISOString(),
  }) as Prisma.InputJsonValue;
  // A policy blocklist controls publication, not protocol inventory. Complete
  // snapshots must still persist source membership for every current identity;
  // public read paths already exclude matching rows. Keep the legacy rejection
  // only for direct/manual indexing requests.
  if (!hint) {
    try {
      await assertNotBlocklisted({
        name,
        owner,
        agentURI,
        chainId: SOLANA_CHAIN_ID,
        agentId: 0,
      });
    } catch (e) {
      if (e instanceof AgentBlocklistError) {
        recordMetaplexIndexFailure(assetAddress, e.message);
        return { ok: false, error: e.message };
      }
      throw e;
    }
  }
  const isActive = normalized.active !== false;
  const metaplexLockIdentities = [
    `asset:${chain.assetAddress}`,
    ...collectMetaplexNormKeys({
      displayName: name,
      agentURI,
      registrationUri: chain.registrationUri,
      services,
    }).map((key) => `listing:${key}`),
  ];
  const result = await prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, metaplexLockIdentities);
    throwIfAborted(operationSignal);
    if (!hint) await assertNoRunningMetaplexSnapshot(tx);
    const exactAgentId = await convergeSolanaRegistryAssetRows(tx, {
      assetAddress: chain.assetAddress,
      preferredSource: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
    });
    const existing = exactAgentId == null
      ? null
      : await tx.agent.findUniqueOrThrow({
          where: { id: exactAgentId },
          select: METAPLEX_AGENT_SELECT,
        });
    const registryResolved =
      !existing
        ? await resolveUniqueRegistryRowForMetaplexIdentity(tx, {
            displayName: name,
            agentURI,
            registrationUri: chain.registrationUri,
            services,
          })
        : null;
    const registryRow = registryResolved
      ? await tx.agent.findUnique({
          where: { id: registryResolved.id },
          select: METAPLEX_AGENT_SELECT,
        })
      : null;
    const scoreAnchor = existing ?? registryRow;
    const hintedPriorMatches = scoreAnchor != null && hint?.priorAgentDbId === scoreAnchor.id;
    let storedFingerprint: { value: string } | null = null;
    let currentSolana8004Membership: { id: string } | null = null;
    if (scoreAnchor != null && !hintedPriorMatches) {
      [storedFingerprint, currentSolana8004Membership] = await Promise.all([
          tx.agentMetadata.findFirst({
            where: {
              agentId: scoreAnchor.id,
              key: METAPLEX_SYNC_FINGERPRINT_KEY,
              sourceKind: METAPLEX_METADATA_SOURCE_KIND,
            },
            select: { value: true },
          }),
          tx.solanaRegistryMembership.findFirst({
            where: {
              agentDbId: scoreAnchor.id,
              source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
              isCurrent: true,
            },
            select: { id: true },
          }),
        ]);
    }
    const priorFingerprint = hintedPriorMatches
      ? hint?.priorSyncFingerprint ?? null
      : storedFingerprint?.value ?? null;
    if (scoreAnchor) {
      await assertSolanaRegistryAssetAttachable(tx, {
        agentDbId: scoreAnchor.id,
        source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
        assetAddress: chain.assetAddress,
      });
    }
    const priorMetaplexRawData = objectRecord(scoreAnchor?.metaplexRawData);
    const priorTokenMatches =
      (scoreAnchor?.metaplexAgentTokenMint?.trim() || null) ===
      (chain.agentTokenMint?.trim() || null);
    const currentMetaplexRawData = objectRecord(rawMetaplexData) ?? {};
    const persistedRawMetaplexData = portableOnchainValue({
      ...currentMetaplexRawData,
      registrationJson: registrationAvailable
        ? reg
        : priorMetaplexRawData?.registrationJson ?? null,
      ...(priorTokenMatches && priorMetaplexRawData?.genesis != null
        ? { genesis: priorMetaplexRawData.genesis }
        : {}),
    }) as Prisma.InputJsonValue;
    const shouldHydrateGenesis = Boolean(chain.agentTokenMint?.trim()) && (
      !priorTokenMatches ||
      needsMetaplexGenesisHydration({
        metaplexAgentTokenMint: chain.agentTokenMint,
        metaplexTradeUrl: scoreAnchor?.metaplexTradeUrl,
        metaplexLaunchAddress: scoreAnchor?.metaplexLaunchAddress,
        metaplexRawData: persistedRawMetaplexData,
      })
    );
    const hasCurrentSolana8004Membership = scoreAnchor != null && (
      hintedPriorMatches
        ? hint?.priorHasCurrentSolana8004Membership === true
        : currentSolana8004Membership != null
    );
    const effectiveMetaplexActive = registrationAvailable
      ? normalized.active
      : scoreAnchor?.metaplexActive ?? null;
    const effectiveMetaplexSupportedTrust = registrationAvailable
      ? normalized.supportedTrust
      : scoreAnchor?.metaplexSupportedTrust ?? [];
    const solanaNativeTarget = scoreAnchor == null || (
      scoreAnchor.chainId === SOLANA_CHAIN_ID && !scoreAnchor.sapAgentPda?.trim()
    );
    // Solana 8004 is the canonical profile authority when both supported Solana
    // registries point at the same Core asset. Metaplex still persists all of
    // its source-specific fields, metadata and services.
    const ownsCanonicalProfile = solanaNativeTarget && !hasCurrentSolana8004Membership;
    const scalarProjectionMatches = scoreAnchor != null &&
      scoreAnchor.metaplexAssetAddress === chain.assetAddress &&
      scoreAnchor.metaplexAgentIdentityPda === chain.agentIdentityPda &&
      scoreAnchor.metaplexAgentRegistrationUri === (agentURI || null) &&
      scoreAnchor.metaplexAgentTokenMint === chain.agentTokenMint &&
      scoreAnchor.metaplexAssetSignerPda === chain.assetSignerPda &&
      scoreAnchor.metaplexVerified === chain.metaplexVerified &&
      scoreAnchor.metaplexTokenBindingStatus === chain.tokenBindingStatus &&
      scoreAnchor.metaplexActive === effectiveMetaplexActive &&
      JSON.stringify(scoreAnchor.metaplexSupportedTrust) ===
        JSON.stringify(effectiveMetaplexSupportedTrust) &&
      (!ownsCanonicalProfile || (
        scoreAnchor.name === name &&
        scoreAnchor.description === description &&
        scoreAnchor.image === image &&
        scoreAnchor.agentURI === agentURI &&
        scoreAnchor.owner === owner &&
        scoreAnchor.x402Support === x402Support &&
        scoreAnchor.registrationStatus === registrationAttempt.status &&
        scoreAnchor.registrationErrorClass === registrationAttempt.errorClass &&
        scoreAnchor.registrationErrorMessage === registrationAttempt.errorMessage &&
        (scoreAnchor.registrationNextRetryAt?.getTime() ?? null) ===
          (registrationAttempt.nextRetryAt?.getTime() ?? null) &&
        scoreAnchor.sourceEvidenceType === "registry-program-account-snapshot" &&
        scoreAnchor.sourceFinality === "finalized" &&
        scoreAnchor.sourceRegistryAddress === MPL_AGENT_IDENTITY_PROGRAM_ID
      ));
    const projectionChanged =
      priorFingerprint !== fingerprint || !scalarProjectionMatches;
    let sourceMembershipPersisted = false;
    const persistSourceMembership = async (
      agentDbId: number,
      projectionUnchanged = false,
    ): Promise<boolean> => {
      if (sourceMembershipPersisted) return false;
      if (!hint) {
        await upsertManuallyVerifiedMetaplexMembership(tx, {
          agentDbId,
          assetAddress: chain.assetAddress,
          sourceActive: effectiveMetaplexActive,
          rawData: persistedRawMetaplexData,
        });
        sourceMembershipPersisted = true;
        return false;
      }
      const membershipItem: CurrentSolanaAgent = {
        source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
        externalId: chain.assetAddress,
        registryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
        assetAddress: chain.assetAddress,
        sequenceId: null,
        owner: chain.owner || null,
        creator: chain.creator || null,
        operationalWallet: chain.assetSignerPda || null,
        registrationUri: chain.registrationUri || null,
        sourceActive: effectiveMetaplexActive,
        sourceSlot: hint.sourceSlot,
        sourceUpdatedAt: null,
        nameHint: chain.assetName || null,
        sourceEvidenceKey: null,
        raw: {
          identityPda: hint.identityPda,
          identityVersion: hint.identityVersion,
          sourceSlot: hint.sourceSlot.toString(10),
          coreProofHydration: chain.coreProofHydration,
          owner: chain.owner || null,
          creator: chain.creator || null,
          operationalWallet: chain.assetSignerPda || null,
          registrationUri: chain.registrationUri || null,
          nameHint: chain.assetName || null,
          sourceActive: effectiveMetaplexActive,
          dasEnriched: Boolean(hint.dasAsset),
          dasIsAgent: (hint.dasAsset as unknown as Record<string, unknown> | undefined)?.is_agent === true,
          metaplexVerified: chain.metaplexVerified,
          tokenBindingStatus: chain.tokenBindingStatus,
          agentTokenMint: chain.agentTokenMint,
        },
      };
      if (
        projectionUnchanged &&
        await touchUnchangedMembershipSeen(
          tx,
          hint.snapshotDescriptor,
          agentDbId,
          membershipItem,
          operationSignal,
        )
      ) {
        sourceMembershipPersisted = true;
        return true;
      }
      await markMembershipSeen(
        tx,
        hint.snapshotDescriptor,
        agentDbId,
        membershipItem,
        operationSignal,
      );
      sourceMembershipPersisted = true;
      return false;
    };
    if (hint && scoreAnchor && !projectionChanged) {
      // A full membership upsert (instead of the narrow generation touch) can
      // still be necessary when source evidence changed in a way that does not
      // alter the materialized Agent projection. Cached and failed registration
      // attempts carry their prior projection and retry scalars, so unchanged
      // attempts can take this path too. In every case membership and lifecycle
      // persistence are complete, so avoid rewriting the Agent row.
      await persistSourceMembership(scoreAnchor.id, true);
      throwIfAborted(operationSignal);
      return {
        created: false,
        agentDbId: scoreAnchor.id,
        agentId: scoreAnchor.agentId,
        chainId: scoreAnchor.chainId,
        metaplexVerified: chain.metaplexVerified,
        sourceActive: effectiveMetaplexActive,
        metaplexRawData: scoreAnchor.metaplexRawData,
        profileName: scoreAnchor.name,
        shouldHydrateGenesis,
      };
    }
    const indexedAt = new Date();
    const scores = computeAgentScore({
      name,
      description,
      image,
      metadata: metadataEntries,
      services,
      scoreWallet: chain.assetSignerPda ? 100 : 0,
      x402Support,
      binanceCompatible: scoreAnchor?.binanceCompatible ?? false,
      totalFeedback: scoreAnchor?.totalFeedback ?? 0,
      scoreQuality: scoreAnchor?.scoreQuality ?? 0,
      lastActiveAt: indexedAt,
    });
    const documentData: Prisma.AgentUncheckedUpdateInput = registrationAvailable && ownsCanonicalProfile && projectionChanged
      ? {
          name,
          description,
          image,
          x402Support,
          supportedTrust:
            normalized.supportedTrust[0]?.trim() || scoreAnchor?.supportedTrust || "reputation",
          score: Math.min(100, Math.max(0, scores.score)),
          hotScore: Math.min(100, Math.max(0, scores.hotScore)),
          scoreMetadata: scores.scoreMetadata,
          scoreServices: scores.scoreEndpoints,
          scorePopularity: scores.scorePopularity,
          scoreFreshness: scores.scoreFreshness,
        }
      : {};
    const canonicalSourceData: Prisma.AgentUncheckedUpdateInput = ownsCanonicalProfile
      ? {
          agentURI,
          owner,
          sourceEvidenceType: "registry-program-account-snapshot",
          sourceFinality: "finalized",
          sourceRegistryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
          registrationStatus: registrationAttempt.status,
          registrationLastAttemptAt: chain.registrationUri ? indexedAt : null,
          registrationLastSuccessAt: registrationAvailable ? indexedAt : undefined,
          registrationErrorClass: registrationAttempt.errorClass,
          registrationErrorMessage: registrationAttempt.errorMessage,
          registrationNextRetryAt: registrationAttempt.nextRetryAt,
        }
      : {};
    const baseData: Prisma.AgentUncheckedUpdateInput = {
      ...documentData,
      ...canonicalSourceData,
      metaplexSourceType: METAPLEX_SOURCE_TYPE,
      ...(registrationAvailable || scoreAnchor == null
        ? {
            metaplexSupportedTrust: effectiveMetaplexSupportedTrust,
            metaplexActive: effectiveMetaplexActive,
          }
        : {}),
      metaplexAssetAddress: chain.assetAddress,
      metaplexAgentIdentityPda: chain.agentIdentityPda,
      metaplexAgentRegistrationUri: agentURI || null,
      metaplexAgentTokenMint: chain.agentTokenMint,
      metaplexAssetSignerPda: chain.assetSignerPda,
      metaplexVerified: chain.metaplexVerified,
      metaplexTokenBindingStatus: chain.tokenBindingStatus,
      metaplexRawData: persistedRawMetaplexData,
      metaplexLastIndexedAt: indexedAt,
      ...(!priorTokenMatches && scoreAnchor != null
        ? {
            metaplexLaunchAddress: null,
            metaplexLaunchType: null,
            metaplexLaunchStatus: null,
            metaplexTradeUrl: null,
            metaplexBondingProgressPct: null,
            metaplexBondingProgressSource: null,
            metaplexBondingProgressUpdatedAt: null,
            metaplexHasDexPair: null,
          }
        : {}),
      ...(ownsCanonicalProfile && projectionChanged
        ? {
            scoreWallet: chain.assetSignerPda ? 100 : 0,
            lastActiveAt: indexedAt,
          }
        : {}),
    };
    if (existing) {
      const updateData: Prisma.AgentUncheckedUpdateInput = {
        ...baseData,
        agentId: existing.agentId,
        chainId: existing.chainId,
      };
      if (existing.listingRegistrySource === METAPLEX_LISTING_REGISTRY_SOURCE) {
        updateData.listingRegistrySource = METAPLEX_LISTING_REGISTRY_SOURCE;
      }
      await tx.agent.update({
        where: { id: existing.id },
        data: updateData,
      });
      if (registrationAvailable && projectionChanged) await replaceServices(tx, existing.id, services);
      if (projectionChanged) {
        await replaceMetaplexMetadata(tx, existing.id, metadataEntries, registrationAvailable);
        await persistAgentScoresById(tx, existing.id);
      }
      await persistSourceMembership(existing.id);
      throwIfAborted(operationSignal);
      return {
        created: false,
        agentDbId: existing.id,
        agentId: existing.agentId,
        chainId: existing.chainId,
        metaplexVerified: chain.metaplexVerified,
        sourceActive: effectiveMetaplexActive,
        metaplexRawData: persistedRawMetaplexData,
        profileName: registrationAvailable && ownsCanonicalProfile ? name : existing.name,
        shouldHydrateGenesis,
      };
    }
    if (registryRow) {
      const attachData: Prisma.AgentUncheckedUpdateInput = {
        ...baseData,
        agentId: registryRow.agentId,
        chainId: registryRow.chainId,
      };
      await tx.agent.update({
        where: { id: registryRow.id },
        data: attachData,
      });
      if (registrationAvailable && projectionChanged) await replaceServices(tx, registryRow.id, services);
      if (projectionChanged) {
        await replaceMetaplexMetadata(tx, registryRow.id, metadataEntries, registrationAvailable);
        await persistAgentScoresById(tx, registryRow.id);
      }
      await persistSourceMembership(registryRow.id);
      throwIfAborted(operationSignal);
      return {
        created: false,
        agentDbId: registryRow.id,
        agentId: registryRow.agentId,
        chainId: registryRow.chainId,
        metaplexVerified: chain.metaplexVerified,
        sourceActive: effectiveMetaplexActive,
        metaplexRawData: persistedRawMetaplexData,
        profileName: registrationAvailable && ownsCanonicalProfile ? name : registryRow.name,
        shouldHydrateGenesis,
      };
    }
    await ensureSolanaChain(tx);
    const agentIdToUse = await nextSolanaAgentId(tx);
    const created = await tx.agent.create({
      data: {
        agentId: agentIdToUse,
        chainId: SOLANA_CHAIN_ID,
        name,
        description,
        image,
        agentURI,
        owner,
        isActive,
        publiclyActive: isActive,
        sourceActive: isActive,
        sourceLifecycleStatus: "current",
        sourceEvidenceType: "registry-program-account-snapshot",
        sourceFinality: "finalized",
        sourceRegistryAddress: MPL_AGENT_IDENTITY_PROGRAM_ID,
        registrationStatus: registrationAttempt.status,
        registrationLastAttemptAt: chain.registrationUri ? new Date() : null,
        registrationLastSuccessAt: registrationAttempt.status === "available" ? new Date() : null,
        registrationErrorClass: registrationAttempt.errorClass,
        registrationErrorMessage: registrationAttempt.errorMessage,
        registrationNextRetryAt: registrationAttempt.nextRetryAt,
        x402Support,
        listingRegistrySource: METAPLEX_LISTING_REGISTRY_SOURCE,
        metaplexSourceType: METAPLEX_SOURCE_TYPE,
        metaplexSupportedTrust: effectiveMetaplexSupportedTrust,
        metaplexActive: effectiveMetaplexActive,
        metaplexAssetAddress: chain.assetAddress,
        metaplexAgentIdentityPda: chain.agentIdentityPda,
        metaplexAgentRegistrationUri: agentURI || null,
        metaplexAgentTokenMint: chain.agentTokenMint,
        metaplexAssetSignerPda: chain.assetSignerPda,
        metaplexVerified: chain.metaplexVerified,
        metaplexTokenBindingStatus: chain.tokenBindingStatus,
        metaplexRawData: persistedRawMetaplexData,
        metaplexLastIndexedAt: new Date(),
        supportedTrust: normalized.supportedTrust[0]?.trim() || "reputation",
        score: Math.min(100, Math.max(0, scores.score)),
        hotScore: Math.min(100, Math.max(0, scores.hotScore)),
        scoreWallet: chain.assetSignerPda ? 100 : 0,
        scoreMetadata: scores.scoreMetadata,
        scoreServices: scores.scoreEndpoints,
        scorePopularity: scores.scorePopularity,
        scoreFreshness: scores.scoreFreshness,
        lastActiveAt: new Date(),
      },
    });
    await replaceServices(tx, created.id, services);
    await replaceMetaplexMetadata(tx, created.id, metadataEntries, true);
    await persistAgentScoresById(tx, created.id);
    await persistSourceMembership(created.id);
    throwIfAborted(operationSignal);
    return {
      created: true,
      agentDbId: created.id,
      agentId: created.agentId,
      chainId: created.chainId,
      metaplexVerified: chain.metaplexVerified,
      sourceActive: effectiveMetaplexActive,
      metaplexRawData: persistedRawMetaplexData,
      profileName: created.name,
      shouldHydrateGenesis: Boolean(chain.agentTokenMint?.trim()),
    };
  }, METAPLEX_INDEXER_TX);
  clearMetaplexIndexError();
  if (chain.agentTokenMint?.trim() && result.shouldHydrateGenesis) {
    try {
      await applyGenesisEnrichment(result.agentDbId, chain.agentTokenMint, result.metaplexRawData);
    } catch (genesisErr) {
      console.warn(
        "[metaplex-indexer] Genesis enrichment failed (non-fatal):",
        Error.isError(genesisErr) ? genesisErr.message : genesisErr,
      );
    }
  }
  const publicLink = {
    chainId: result.chainId,
    agentId: result.agentId,
    name: result.profileName,
  };
  return {
    ok: true,
    created: result.created,
    agentDbId: result.agentDbId,
    chainId: result.chainId,
    agentId: result.agentId,
    metaplexVerified: result.metaplexVerified,
    sourceActive: result.sourceActive,
    owner: chain.owner || null,
    creator: chain.creator || null,
    operationalWallet: chain.assetSignerPda || null,
    registrationUri: chain.registrationUri || null,
    nameHint: chain.assetName || null,
    coreProofHydration: chain.coreProofHydration,
    profilePath: agentPublicPath(publicLink),
    profileUrl: agentPublicUrl(getPublicSiteUrl(), publicLink),
  };
}
async function applyGenesisEnrichment(
  agentDbId: number,
  tokenMint: string,
  existingRaw: unknown,
): Promise<void> {
  const result = await persistGenesisEnrichmentForAgent(agentDbId, tokenMint, existingRaw);
  if (!result.persist) {
    console.warn(
      "[metaplex-indexer] Genesis enrichment skipped DB update (API error); preserving existing genesis fields.",
    );
  }
}
