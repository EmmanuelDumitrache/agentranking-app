import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../../db.js";
import { SOLANA_CHAIN_ID } from "../../chain-constants.js";
import { type RegistrationJson, extractMetadata, listServiceEntries } from "../agent-metadata.js";
import { attemptRegistrationDocument, normalizeRegistrationUri } from "../../lib/registration-document.js";
import { throwIfAborted } from "../../lib/abort.js";
import { parseSolanaExactUnsigned, parseSolanaPublicKey } from "../../lib/solana-protocol.js";
import {
  reconcileChainRelationSets,
  reconcileChainRelations,
  type ChainRelationSet,
  type ChainServiceRow,
} from "../relation-diff.js";
import { derivePublicActivation } from "../../lib/public-activation.js";
import { normalizeChainString } from "../../lib/chain-string.js";
import { withSerializableRetry } from "../../lib/serializable-retry.js";
import { resolveUniqueRegistryRowForMetaplexIdentity } from "@/lib/metaplex/metaplex-registry-twin-resolve";
import { normalizeAgentListingUrl } from "@/lib/sap-twin-url-keys";
import { resolveAgentPaymentRails } from "@/lib/agent-payment-rails.js";
import { markMembershipSeen, type SnapshotDescriptor } from "../solana-snapshot-runner.js";
import {
  POSTGRES_SIGNED_BIGINT_MAX,
  POSTGRES_SIGNED_INT_MAX,
  SOLANA_REGISTRY_SOURCE,
  type CurrentSolanaAgent,
} from "../solana-current-state-types.js";
import { assertSolanaRegistryAssetAttachable, convergeSolanaRegistryAssetRows } from "../solana-registry-agent-resolver.js";
import {
  acquireSolanaAgentIdentityLocks,
  acquireSolanaCompatibilityIdAllocatorLock,
  acquireSolanaSnapshotWriterFence,
} from "../solana-agent-locks.js";
const METADATA_FETCH_TIMEOUT_MS = 8_000;
type RegistrationAttempt = Awaited<ReturnType<typeof attemptRegistrationDocument>>;
type CanonicalStatus = "PENDING" | "FINALIZED" | "ORPHANED";
type SourceCoordinates = { slot: bigint | null; blockTime: Date | null; indexerUpdatedAt: Date | null };
const MATERIALIZATION_AGENT_SELECT = {
  id: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  x402Support: true,
  mppSupport: true,
  supportedTrust: true,
  agentURI: true,
  sapAgentPda: true,
  sourceActive: true,
  sourceLifecycleStatus: true,
  sourceEvidenceType: true,
  sourceFinality: true,
  sourceRegistryAddress: true,
  moderationStatus: true,
  administrativeActiveOverride: true,
  declaredActive: true,
  declaredX402Support: true,
  declaredMppSupport: true,
  sourceQualityScore: true,
  sourceFeedbackCount: true,
  chainIdentityFingerprint: true,
  chainRelationFingerprint: true,
  chainMetricsFingerprint: true,
  relationMaterializationGeneration: true,
  identityUpdatedAt: true,
  metadataUpdatedAt: true,
  lastActiveAt: true,
  scoreStateVersion: true,
  registrationStatus: true,
  registrationRawDigest: true,
  registrationSemanticFingerprint: true,
  registrationNormalizedUri: true,
  registrationContentAddress: true,
  registrationLastAttemptAt: true,
  registrationLastSuccessAt: true,
  registrationErrorClass: true,
  registrationErrorMessage: true,
  registrationNextRetryAt: true,
  solanaAssetAddress: true,
  solanaSequenceId: true,
  solanaCanonicalStatus: true,
  solanaCommitment: true,
  solanaSlot: true,
  solanaTransactionSignature: true,
  solanaEventOrdinal: true,
  solanaOfficialRank: true,
  solanaAtomTrustTier: true,
  solanaIndexerUpdatedAt: true,
  solanaBlockTime: true,
} as const;
function sanitizeForPostgres(value: string): string {
  return value.replace(/\0/g, "");
}
export function solana8004IdentityFingerprint(input: {
  asset: string;
  sequenceId: bigint | null;
  owner: string | null;
  creator: string | null;
  wallet: string | null;
  uri: string | null;
}): string {
  const normalizedRegistration = input.uri ? (() => {
    try { return normalizeRegistrationUri(input.uri!); } catch { return null; }
  })() : null;
  return createHash("sha256").update(JSON.stringify({
    asset: input.asset,
    sequenceId: input.sequenceId?.toString(10) ?? null,
    owner: input.owner,
    creator: input.creator,
    wallet: input.wallet,
    uri: normalizedRegistration?.key ?? input.uri,
  })).digest("hex");
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function first(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  return null;
}
function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function postgresBigIntProjection(value: bigint | null): bigint | null {
  return value != null && value <= POSTGRES_SIGNED_BIGINT_MAX ? value : null;
}
function requirePostgresSourceCoordinate(value: bigint | null, label: string): bigint | null {
  if (value != null && value > POSTGRES_SIGNED_BIGINT_MAX) {
    throw new Error(`${label} exceeds the PostgreSQL BIGINT domain`);
  }
  return value;
}
function parseOptionalSolanaPublicKey(value: unknown, label: string): string | null {
  try {
    return parseSolanaPublicKey(value, label);
  } catch {
    return null;
  }
}
function parseOptionalQualityScore(value: unknown): number | null {
  if (value == null || value === "") return null;
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(candidate) && candidate >= 0 && candidate <= 100
    ? candidate
    : null;
}
function parseOptionalChainString(
  value: unknown,
  options: { label: string; maxBytes: number },
): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeChainString(value, {
      ...options,
      allowTruncation: true,
    }).value || null;
  } catch {
    return null;
  }
}
function canonicalStatus(raw: Record<string, unknown>): CanonicalStatus | null {
  const value = first(raw, "canonical_status", "canonicalStatus", "status", "verification_status");
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  return normalized === "PENDING" || normalized === "FINALIZED" || normalized === "ORPHANED" ? normalized : null;
}
function coordinates(raw: Record<string, unknown>): SourceCoordinates {
  return {
    slot: requirePostgresSourceCoordinate(
      parseSolanaExactUnsigned(first(raw, "slot", "block_slot", "source_slot"), "Solana slot"),
      "Solana slot",
    ),
    blockTime: parseDate(first(raw, "block_time", "blockTime")),
    indexerUpdatedAt: parseDate(first(raw, "updated_at", "updatedAt")),
  };
}
function parseServices(reg: RegistrationJson | null) {
  return listServiceEntries(reg).map((service) => ({
    name: sanitizeForPostgres(service.normalizedType || service.name || "web"),
    endpoint: sanitizeForPostgres(service.normalizedEndpoint ?? service.endpoint ?? ""),
    version: sanitizeForPostgres(service.version ?? ""),
    sourceName: service.name ?? null,
    normalizedType: service.normalizedType ?? null,
    sourceEndpoint: service.endpoint ?? null,
    endpointKind: service.endpointKind ?? null,
    endpointValid: service.validationStatus == null ? null : service.validationStatus === "valid",
    sourceVersion: service.version ?? null,
    sourceDigest: reg?.rawDocumentDigest ?? null,
    sourceKind: "registration",
    skills: service.skills,
    domains: service.domains,
    capabilities: service.capabilities,
    extensions: service.extensions,
  }));
}
export async function hydrateSolanaRegistration(
  assetInput: string,
  uri: string,
  signal?: AbortSignal,
): Promise<"updated" | "unchanged" | "permanent_invalid" | "deferred"> {
  throwIfAborted(signal);
  const asset = parseSolanaPublicKey(assetInput, "agent asset", true)!;
  const existing = await prisma.agent.findUnique({ where: { solanaAssetAddress: asset } });
  if (!existing) return "unchanged";
  const initiallySolanaNative = existing.chainId === SOLANA_CHAIN_ID && !existing.sapAgentPda?.trim();
  if (initiallySolanaNative && existing.agentURI !== uri) return "unchanged";
  if (!initiallySolanaNative) {
    const membership = await prisma.solanaRegistryMembership.findUnique({
      where: {
        source_externalId: {
          source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
          externalId: asset,
        },
      },
      select: { agentDbId: true, isCurrent: true, rawData: true },
    });
    const raw = record(membership?.rawData);
    const currentUri = raw ? first(raw, "agent_uri", "agentUri") : null;
    if (!membership?.isCurrent || membership.agentDbId !== existing.id ||
      (typeof currentUri === "string" && currentUri !== uri)) return "unchanged";
  }
  const attempt = await attemptRegistrationDocument(uri, METADATA_FETCH_TIMEOUT_MS, undefined, signal);
  const attemptedAt = new Date();
  const transactionResult = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, [`asset:${asset}`, `agent-db:${existing.id}`]);
    throwIfAborted(signal);
    const [current, membership] = await Promise.all([
      tx.agent.findUnique({ where: { solanaAssetAddress: asset } }),
      tx.solanaRegistryMembership.findUnique({
        where: {
          source_externalId: {
            source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
            externalId: asset,
          },
        },
        select: { agentDbId: true, isCurrent: true, rawData: true },
      }),
    ]);
    if (!current || current.id !== existing.id || !membership?.isCurrent || membership.agentDbId !== current.id) {
      return null;
    }
    const currentSolanaNative = current.chainId === SOLANA_CHAIN_ID && !current.sapAgentPda?.trim();
    const membershipRaw = record(membership.rawData);
    const membershipUriValue = membershipRaw ? first(membershipRaw, "agent_uri", "agentUri") : null;
    const authoritativeUri = typeof membershipUriValue === "string"
      ? membershipUriValue
      : currentSolanaNative
        ? current.agentURI
        : null;
    // The HTTP request may outlive a source snapshot. Re-check the current
    // membership and URI after acquiring the transaction fence so an old
    // document cannot overwrite a removed identity or a newer registration.
    if (authoritativeUri !== uri || (currentSolanaNative && current.agentURI !== uri)) return null;
    if (attempt.status !== "valid") {
      if (currentSolanaNative) {
        const errorClass = "errorClass" in attempt ? attempt.errorClass : null;
        const message = "message" in attempt ? attempt.message : null;
        const nextRetryAt = "nextRetryAt" in attempt ? attempt.nextRetryAt : null;
        await tx.agent.update({
          where: { id: current.id },
          data: {
            registrationStatus: attempt.status,
            registrationLastAttemptAt: attemptedAt,
            registrationErrorClass: errorClass,
            registrationErrorMessage: message,
            registrationNextRetryAt: nextRetryAt,
          },
        });
      }
      throwIfAborted(signal);
      return {
        status: attempt.status === "transient_unavailable"
          ? "deferred" as const
          : attempt.status === "permanent_invalid"
            ? "permanent_invalid" as const
            : "unchanged" as const,
        scoreStateVersion: null,
      };
    }
    const result = attempt.result;
    const reg = result.registration;
    const normalized = normalizeRegistrationUri(uri);
    const services = parseServices(reg);
    const name = sanitizeForPostgres(reg.name ?? current.name);
    const description = sanitizeForPostgres(reg.description ?? current.description);
    const image = sanitizeForPostgres(reg.image ?? current.image);
    const metadata = extractMetadata(reg, currentSolanaNative ? current.owner || null : null)
      .map((entry) => ({ key: sanitizeForPostgres(entry.key), value: sanitizeForPostgres(entry.value) }));
    const relationFingerprint = createHash("sha256").update(JSON.stringify({
      name,
      description,
      image,
      active: reg.active ?? null,
      x402Support: reg.x402Support ?? null,
      services: services.map((service) => ({
        name: service.name,
        endpoint: service.endpoint,
        version: service.version,
        normalizedType: service.normalizedType,
        endpointKind: service.endpointKind,
        skills: service.skills,
        domains: service.domains,
        capabilities: service.capabilities,
        extensions: service.extensions,
      })),
      metadata: metadata.sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value)),
    })).digest("hex");
    const sourceKind = currentSolanaNative ? "registration" : "solana-registration";
    const unchanged = currentSolanaNative &&
      current.chainRelationFingerprint === relationFingerprint &&
      current.registrationRawDigest === result.decoded.rawDocumentDigest &&
      current.registrationStatus === "available";
    if (unchanged) {
      await tx.agent.update({
        where: { id: current.id },
        data: {
          registrationLastAttemptAt: attemptedAt,
          registrationLastSuccessAt: attemptedAt,
          registrationErrorClass: null,
          registrationErrorMessage: null,
          registrationNextRetryAt: null,
        },
      });
      throwIfAborted(signal);
      return { status: "unchanged" as const, scoreStateVersion: null };
    }
    const paymentRails = resolveAgentPaymentRails({
      x402Support: current.x402Support,
      mppSupport: current.mppSupport,
      declaredX402Support: reg.x402Support ?? null,
      declaredMppSupport: reg.mppSupport ?? null,
    });
    const x402Support = paymentRails.x402Support;
    const mppSupport = paymentRails.mppSupport;
    const serviceRows: ChainServiceRow[] = services.map((service) => ({ ...service, sourceKind }));
    const canonicalData: Prisma.AgentUncheckedUpdateInput = currentSolanaNative
      ? {
          declaredActive: reg.active ?? null,
          declaredX402Support: reg.x402Support ?? null,
          declaredMppSupport: reg.mppSupport ?? null,
          registrationRawDigest: result.decoded.rawDocumentDigest,
          registrationSemanticFingerprint: result.decoded.normalizedFingerprint,
          registrationNormalizedUri: normalized.key,
          registrationContentAddress: normalized.contentAddress,
          registrationStatus: "available",
          registrationLastAttemptAt: attemptedAt,
          registrationLastSuccessAt: attemptedAt,
          registrationErrorClass: null,
          registrationErrorMessage: null,
          registrationNextRetryAt: null,
          chainRelationFingerprint: relationFingerprint,
          metadataUpdatedAt: attemptedAt,
        }
      : {};
    const canonicalProfileData: Prisma.AgentUncheckedUpdateInput = currentSolanaNative
      ? {
          name,
          description,
          image,
          x402Support,
          mppSupport,
          supportedTrust: Array.isArray(reg.supportedTrust)
            ? reg.supportedTrust.join(", ")
            : current.supportedTrust,
        }
      : {};
    const updated = await tx.agent.update({
      where: { id: current.id },
      data: {
        ...canonicalProfileData,
        ...canonicalData,
      },
      select: { scoreStateVersion: true },
    });
    await reconcileChainRelations(tx, {
      agentId: current.id,
      sourceKind,
      sourceDigest: result.decoded.rawDocumentDigest,
      services: serviceRows,
      metadata,
    });
    throwIfAborted(signal);
    return { status: "updated" as const, scoreStateVersion: updated.scoreStateVersion };
  }, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 30_000 }), 8);
  if (transactionResult == null) return "unchanged";
  return transactionResult.status;
}
export async function materializeSolana8004Agent(input: {
  raw: Record<string, unknown>;
  asset: string;
  sequenceId: bigint | null;
  owner: string | null;
  creator: string | null;
  wallet: string | null;
  uri: string | null;
  status: CanonicalStatus;
  source: SourceCoordinates;
  officialRank: bigint | null;
  trustTier: string | null;
  signal?: AbortSignal;
  forceRepair?: boolean;
  registrationAttempt?: RegistrationAttempt;
  snapshotDescriptor: SnapshotDescriptor;
  snapshotItem: CurrentSolanaAgent;
}): Promise<{
  status: "upserted" | "skipped";
  agentDbId: number;
  metadataHydration: { asset: string; uri: string } | null;
}> {
  throwIfAborted(input.signal);
  if (input.status !== "FINALIZED" || input.source.slot == null) {
    throw new Error("snapshot materialization requires a finalized row with a source slot");
  }
  const preferredAgentId = input.sequenceId != null && input.sequenceId <= 2_147_483_647n
    ? Number(input.sequenceId)
    : null;
  const storedSequenceId = postgresBigIntProjection(input.sequenceId);
  const storedOfficialRank = postgresBigIntProjection(input.officialRank);
  const now = new Date();
  const normalizedRegistration = input.uri ? (() => {
    try { return normalizeRegistrationUri(input.uri!); } catch { return null; }
  })() : null;
  const listingLockKey = normalizeAgentListingUrl(input.uri);
  const materializationLockIdentities = [
    `asset:${input.asset}`,
    ...(listingLockKey ? [`listing:${listingLockKey}`] : []),
  ];
  // Identity materialization is deliberately independent of registration-document
  // HTTP/IPFS availability. Phase 1 records the authoritative URI and immediately
  // makes the Agent visible; Phase 2 (or steady-state hydration) performs the
  // off-chain fetch. A caller may still provide a precomputed attempt explicitly,
  // but this function never starts one implicitly.
  const registrationAttempt = input.registrationAttempt ?? null;
  const registrationResult = registrationAttempt?.status === "valid" ? registrationAttempt.result : null;
  const reg = registrationResult?.registration ?? null;
  const registrationUsable = reg != null;
  const indexedName = first(input.raw, "nft_name", "name");
  const fallbackName = typeof indexedName === "string" ? indexedName : `Agent ${input.asset.slice(0, 8)}`;
  const services = reg ? parseServices(reg) : [];
  const registrationMetadata = reg ? extractMetadata(reg, input.wallet)
    .map((entry) => ({ key: sanitizeForPostgres(entry.key), value: sanitizeForPostgres(entry.value) })) : [];
  const coreMetadata = [
    { key: "solanaAsset", value: input.asset },
    ...(input.creator ? [{ key: "solanaImmutableCreator", value: input.creator }] : []),
    ...(input.wallet ? [{ key: "agentWallet", value: input.wallet }] : []),
  ];
  const parsedQualityScore = parseOptionalQualityScore(first(input.raw, "quality_score", "qualityScore"));
  const normalizedTrustTier = parseOptionalChainString(input.trustTier, {
    label: "Solana trust tier",
    maxBytes: 256,
  });
  const identityFingerprint = solana8004IdentityFingerprint({
    asset: input.asset,
    sequenceId: input.sequenceId,
    owner: input.owner,
    creator: input.creator,
    wallet: input.wallet,
    uri: input.uri,
  });
  const materialized = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await acquireSolanaSnapshotWriterFence(tx);
    await acquireSolanaAgentIdentityLocks(tx, materializationLockIdentities);
    throwIfAborted(input.signal);
    const exactAgentId = await convergeSolanaRegistryAssetRows(tx, {
      assetAddress: input.asset,
      preferredSource: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
    });
    const exactExisting = exactAgentId == null
      ? null
      : await tx.agent.findUniqueOrThrow({
          where: { id: exactAgentId },
          select: MATERIALIZATION_AGENT_SELECT,
        });
    const twinResolved = exactExisting == null
      ? await resolveUniqueRegistryRowForMetaplexIdentity(tx, {
          displayName: sanitizeForPostgres(reg?.name ?? fallbackName),
          agentURI: input.uri,
          registrationUri: input.uri,
          services,
        })
      : null;
    const twinMatch = twinResolved
      ? await tx.agent.findUnique({
          where: { id: twinResolved.id },
          select: MATERIALIZATION_AGENT_SELECT,
        })
      : null;
    const existing = exactExisting ?? twinMatch;
    const qualityScore = parsedQualityScore ?? existing?.sourceQualityScore ?? 0;
    // Trust counters are Phase 3 inputs. Identity materialization preserves the
    // previously indexed trust state and never treats the cached AgentAccount
    // counters as an authoritative reputation backfill.
    const totalFeedback = existing?.sourceFeedbackCount ?? 0;
    const metricsFingerprint = createHash("sha256").update(JSON.stringify({
      qualityScore,
      officialRank: storedOfficialRank?.toString(10) ?? null,
      trustTier: normalizedTrustTier,
      canonicalStatus: input.status,
    })).digest("hex");
    if (existing) {
      await assertSolanaRegistryAssetAttachable(tx, {
        agentDbId: existing.id,
        source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
        assetAddress: input.asset,
      });
    }
    const solanaNativeTarget = existing == null || (
      existing.chainId === SOLANA_CHAIN_ID && !existing.sapAgentPda?.trim()
    );
    const preserveLastKnownGood = Boolean(existing && !registrationUsable);
    const name = sanitizeForPostgres(reg?.name ?? existing?.name ?? fallbackName);
    const description = sanitizeForPostgres(reg?.description ?? existing?.description ?? "");
    const image = sanitizeForPostgres(reg?.image ?? existing?.image ?? "");
    const declaredX402Support = reg?.x402Support ?? existing?.declaredX402Support ?? null;
    const declaredMppSupport = reg?.mppSupport ?? existing?.declaredMppSupport ?? null;
    const paymentRails = resolveAgentPaymentRails({
      x402Support: existing?.x402Support,
      mppSupport: existing?.mppSupport,
      declaredX402Support,
      declaredMppSupport,
    });
    const x402Support = paymentRails.x402Support;
    const mppSupport = paymentRails.mppSupport;
    const declaredActive = reg?.active ?? existing?.declaredActive ?? null;
    const supportedTrust = normalizeChainString(
      Array.isArray(reg?.supportedTrust) ? reg.supportedTrust.join(", ") : existing?.supportedTrust ?? "reputation",
      { label: "Solana supported trust", maxBytes: 1_024, allowTruncation: true },
    ).value;
    const relationFingerprint = preserveLastKnownGood
      ? existing?.chainRelationFingerprint ?? createHash("sha256").update("empty-registration").digest("hex")
      : createHash("sha256").update(JSON.stringify({
          name,
          description,
          image,
          active: declaredActive,
          x402Support: declaredX402Support,
          services: services.map((service) => ({
            name: service.name,
            endpoint: service.endpoint,
            version: service.version,
            normalizedType: service.normalizedType,
            endpointKind: service.endpointKind,
          })),
          metadata: registrationMetadata.sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value)),
        })).digest("hex");
    const materializedIdentityChanged = !existing ||
      existing.solanaAssetAddress !== input.asset ||
      existing.solanaSequenceId !== storedSequenceId;
    const sourceCoreDigest = existing && !solanaNativeTarget
      ? (await tx.agentMetadata.findFirst({
          where: { agentId: existing.id, sourceKind: "solana-indexer-core" },
          select: { sourceDigest: true },
        }))?.sourceDigest ?? null
      : existing?.chainIdentityFingerprint ?? null;
    const identityChanged = materializedIdentityChanged || sourceCoreDigest !== identityFingerprint;
    const profileChanged = solanaNativeTarget && (!existing || existing.name !== name || existing.description !== description ||
      existing.image !== image || existing.x402Support !== x402Support || existing.mppSupport !== mppSupport || existing.supportedTrust !== supportedTrust);
    const relationChanged = solanaNativeTarget
      ? existing?.chainRelationFingerprint !== relationFingerprint
      : registrationUsable;
    const metricsChanged = solanaNativeTarget
      ? existing?.chainMetricsFingerprint !== metricsFingerprint
      : false;
    const canonicalSourceChanged = solanaNativeTarget && existing != null && (
      existing.sourceActive !== true || existing.sourceLifecycleStatus !== "current" ||
      existing.sourceEvidenceType !== "solana-8004-direct-rpc" ||
      existing.sourceFinality !== "rpc-finalized-stable-inventory" ||
      existing.sourceRegistryAddress !== input.snapshotDescriptor.registryAddress
    );
    const sourceChanged = !existing || canonicalSourceChanged ||
      existing.solanaCanonicalStatus !== input.status || existing.solanaSlot !== input.source.slot ||
      existing.solanaCommitment !== "finalized" ||
      existing.solanaTransactionSignature != null || existing.solanaEventOrdinal != null ||
      existing.solanaOfficialRank !== storedOfficialRank || existing.solanaAtomTrustTier !== normalizedTrustTier ||
      existing.solanaIndexerUpdatedAt?.getTime() !== input.source.indexerUpdatedAt?.getTime() ||
      existing.solanaBlockTime?.getTime() !== input.source.blockTime?.getTime();
    const registrationIdentity = normalizedRegistration?.key ?? (input.uri ? `raw:${input.uri}` : null);
    const existingRegistrationIdentity = existing?.registrationNormalizedUri ??
      (existing?.agentURI ? `raw:${existing.agentURI}` : null);
    const registrationUriChanged = registrationIdentity !== existingRegistrationIdentity;
    const nextRegistrationStatus = registrationAttempt
      ? registrationAttempt.status === "valid"
        ? "available"
        : registrationAttempt.status === "not_declared"
          ? "missing_uri"
          : registrationAttempt.status
      : !input.uri
        ? "missing_uri"
        : normalizedRegistration == null
          ? "permanent_invalid"
          : registrationUriChanged
            ? "pending"
            : existing?.registrationStatus ?? "pending";
    const nextRegistrationErrorClass = registrationAttempt && "errorClass" in registrationAttempt
      ? registrationAttempt.errorClass
      : normalizedRegistration == null && input.uri
        ? "invalid_uri"
        : registrationUriChanged
          ? null
          : existing?.registrationErrorClass ?? null;
    const nextRegistrationErrorMessage = registrationAttempt && "message" in registrationAttempt
      ? registrationAttempt.message
      : normalizedRegistration == null && input.uri
        ? "registration URI is not a supported canonical URI"
        : registrationUriChanged
          ? null
          : existing?.registrationErrorMessage ?? null;
    const nextRegistrationRetryAt = registrationAttempt && "nextRetryAt" in registrationAttempt
      ? registrationAttempt.nextRetryAt
      : registrationUriChanged
        ? null
        : existing?.registrationNextRetryAt ?? null;
    const nextRegistrationRawDigest = registrationResult?.decoded.rawDocumentDigest ??
      (registrationUriChanged ? null : existing?.registrationRawDigest ?? null);
    const nextRegistrationSemanticFingerprint = registrationResult?.decoded.normalizedFingerprint ??
      (registrationUriChanged ? null : existing?.registrationSemanticFingerprint ?? null);
    const nextRegistrationLastAttemptAt = registrationAttempt
      ? now
      : registrationUriChanged
        ? null
        : existing?.registrationLastAttemptAt ?? null;
    const nextRegistrationLastSuccessAt = registrationUsable
      ? now
      : registrationUriChanged
        ? null
        : existing?.registrationLastSuccessAt ?? null;
    const registrationStatusChanged = solanaNativeTarget && (!existing ||
      existing.registrationStatus !== nextRegistrationStatus ||
      existing.registrationRawDigest !== nextRegistrationRawDigest ||
      existing.registrationSemanticFingerprint !== nextRegistrationSemanticFingerprint ||
      existing.registrationLastAttemptAt?.getTime() !== nextRegistrationLastAttemptAt?.getTime() ||
      existing.registrationLastSuccessAt?.getTime() !== nextRegistrationLastSuccessAt?.getTime() ||
      existing.registrationErrorClass !== nextRegistrationErrorClass ||
      existing.registrationErrorMessage !== nextRegistrationErrorMessage ||
      existing.registrationNextRetryAt?.getTime() !== nextRegistrationRetryAt?.getTime());
    if (existing && !input.forceRepair && !identityChanged && !profileChanged && !relationChanged &&
      !metricsChanged && !sourceChanged && !registrationStatusChanged) {
      await markMembershipSeen(
        tx,
        input.snapshotDescriptor,
        existing.id,
        input.snapshotItem,
        input.signal,
        {
          locksHeld: true,
          currentLifecycleMaterialized: !solanaNativeTarget || (
            input.snapshotItem.sourceActive !== false &&
            existing.sourceActive === true &&
            existing.sourceLifecycleStatus === "current"
          ),
        },
      );
      throwIfAborted(input.signal);
      return {
        status: "skipped" as const,
        id: existing.id,
        scoreStateVersion: existing.scoreStateVersion,
        registrationStatus: existing.registrationStatus,
        registrationNormalizedUri: existing.registrationNormalizedUri,
        registrationNextRetryAt: existing.registrationNextRetryAt,
      };
    }
    const sourceActive = true;
    const publiclyActive = derivePublicActivation({
      sourceActive,
      moderationStatus: existing?.moderationStatus ?? "inherit",
      administrativeOverride: existing?.administrativeActiveOverride,
      // Current registry identity is sufficient for lifecycle completeness.
      // Registration-document availability only controls enrichment fields.
      complete: true,
    });
    const canonicalProfileData = solanaNativeTarget
      ? { name, description, image, x402Support, mppSupport, supportedTrust }
      : {};
    const solanaSourceData = {
      lastIndexedAt: now,
      solanaAssetAddress: input.asset,
      solanaSequenceId: storedSequenceId,
      solanaCanonicalStatus: input.status,
      solanaCommitment: "finalized",
      solanaSlot: input.source.slot,
      solanaTransactionSignature: null,
      solanaEventOrdinal: null,
      solanaOfficialRank: storedOfficialRank,
      solanaAtomTrustTier: normalizedTrustTier,
      solanaIndexerUpdatedAt: input.source.indexerUpdatedAt,
      solanaBlockTime: input.source.blockTime,
    };
    const canonicalSourceData = solanaNativeTarget
      ? {
          protocolAgentId: input.sequenceId?.toString(10) ?? input.asset,
          agentURI: sanitizeForPostgres(input.uri ?? ""),
          owner: input.owner ?? "",
          registeredOwner: input.creator ?? "",
          declaredActive,
          declaredX402Support,
          declaredMppSupport,
          sourceActive,
          sourceLifecycleStatus: "current",
          publiclyActive,
          sourceEvidenceType: "solana-8004-direct-rpc",
          sourceFinality: "rpc-finalized-stable-inventory",
          sourceRegistryAddress: input.snapshotDescriptor.registryAddress,
          sourceBlockNumber: null,
          sourceBlockHash: null,
          sourceTransactionHash: null,
          sourceTransactionIndex: null,
          sourceLogIndex: null,
          registrationRawDigest: nextRegistrationRawDigest,
          registrationSemanticFingerprint: nextRegistrationSemanticFingerprint,
          registrationNormalizedUri: normalizedRegistration?.key ?? (registrationUriChanged ? null : existing?.registrationNormalizedUri ?? null),
          registrationContentAddress: normalizedRegistration?.contentAddress ?? (registrationUriChanged ? null : existing?.registrationContentAddress ?? null),
          registrationStatus: nextRegistrationStatus,
          registrationLastAttemptAt: nextRegistrationLastAttemptAt,
          registrationLastSuccessAt: nextRegistrationLastSuccessAt,
          registrationErrorClass: nextRegistrationErrorClass,
          registrationErrorMessage: nextRegistrationErrorMessage,
          registrationNextRetryAt: nextRegistrationRetryAt,
          chainIdentityFingerprint: identityFingerprint,
          chainRelationFingerprint: relationFingerprint,
          chainMetricsFingerprint: metricsFingerprint,
          isActive: publiclyActive,
          sourceQualityScore: qualityScore,
          sourceFeedbackCount: totalFeedback,
          walletHydrationStatus: input.wallet ? "present" : "absent",
          walletCapabilityStatus: "registry-account",
          materializedRelationFingerprint: relationFingerprint,
          relationMaterializationGeneration: input.forceRepair
            ? (existing?.relationMaterializationGeneration ?? 0) + 1
            : existing?.relationMaterializationGeneration ?? 0,
          // New current identities should start with a current activity time;
          // subsequent snapshots preserve it rather than refreshing it on every poll.
          lastActiveAt: existing?.lastActiveAt ?? now,
          identityUpdatedAt: identityChanged ? input.source.blockTime ?? now : existing?.identityUpdatedAt ?? null,
          metadataUpdatedAt: registrationUsable && relationChanged ? now : existing?.metadataUpdatedAt ?? null,
        }
      : {};
    const scalarData = {
      ...canonicalProfileData,
      ...solanaSourceData,
      ...canonicalSourceData,
    };
    let current: {
      id: number;
      scoreStateVersion: bigint;
      registrationStatus: string | null;
      registrationNormalizedUri: string | null;
      registrationNextRetryAt: Date | null;
    };
    if (existing) {
      current = await tx.agent.update({
        where: { id: existing.id },
        data: scalarData,
        select: {
          id: true,
          scoreStateVersion: true,
          registrationStatus: true,
          registrationNormalizedUri: true,
          registrationNextRetryAt: true,
        },
      });
    } else {
      await acquireSolanaCompatibilityIdAllocatorLock(tx);
      const preferredCollision = preferredAgentId == null
        ? null
        : await tx.agent.findUnique({
            where: { agentId_chainId: { agentId: preferredAgentId, chainId: SOLANA_CHAIN_ID } },
            select: { id: true },
          });
      let localAgentId = preferredAgentId;
      if (localAgentId == null || preferredCollision != null) {
        const maxAgentId = (await tx.agent.aggregate({
          where: { chainId: SOLANA_CHAIN_ID },
          _max: { agentId: true },
        }))._max.agentId ?? 0;
        if (maxAgentId >= 2_147_483_647) {
          throw new Error("Solana local agent ID space is exhausted");
        }
        localAgentId = maxAgentId + 1;
      }
      current = await tx.agent.create({
        data: {
          ...scalarData,
          // Prisma cannot infer from the solanaNativeTarget branch that the
          // shared update payload contains the required create-only name.
          // Supply it explicitly at the create boundary.
          name,
          agentId: localAgentId,
          chainId: SOLANA_CHAIN_ID,
          isVerified: false,
          rank: 0,
          stars: 0,
          listedAt: now,
        },
        select: {
          id: true,
          scoreStateVersion: true,
          registrationStatus: true,
          registrationNormalizedUri: true,
          registrationNextRetryAt: true,
        },
      });
    }
    const coreSourceKind = solanaNativeTarget ? "indexer-core" : "solana-indexer-core";
    const registrationSourceKind = solanaNativeTarget ? "registration" : "solana-registration";
    const relationSets: ChainRelationSet[] = [];
    if (identityChanged || input.forceRepair) {
      relationSets.push({
        sourceKind: coreSourceKind,
        sourceDigest: identityFingerprint,
        services: [],
        metadata: coreMetadata,
      });
    }
    if (registrationUsable && (!existing || relationChanged || input.forceRepair)) {
      relationSets.push({
        sourceKind: registrationSourceKind,
        sourceDigest: registrationResult?.decoded.rawDocumentDigest ?? (solanaNativeTarget ? existing?.registrationRawDigest ?? null : null),
        services: services.map((service) => ({ ...service, sourceKind: registrationSourceKind })),
        metadata: registrationMetadata,
      });
    }
    await reconcileChainRelationSets(tx, current.id, relationSets);
    await markMembershipSeen(
      tx,
      input.snapshotDescriptor,
      current.id,
      input.snapshotItem,
      input.signal,
      {
        locksHeld: true,
        currentLifecycleMaterialized: !solanaNativeTarget || input.snapshotItem.sourceActive !== false,
      },
    );
    throwIfAborted(input.signal);
    return { status: "upserted" as const, ...current };
  }, { isolationLevel: "ReadCommitted", timeout: 120_000, maxWait: 30_000 }), 8);
  const registrationBackoffActive =
    materialized.registrationNextRetryAt != null &&
    materialized.registrationNextRetryAt.getTime() > Date.now();
  const registrationAlreadyCurrent = normalizedRegistration != null &&
    materialized.registrationStatus === "available" &&
    materialized.registrationNormalizedUri === normalizedRegistration.key;
  const metadataHydration = input.uri && normalizedRegistration &&
    !registrationUsable && !registrationAlreadyCurrent && !registrationBackoffActive
    ? { asset: input.asset, uri: input.uri }
    : null;
  return { status: materialized.status, agentDbId: materialized.id, metadataHydration };
}
