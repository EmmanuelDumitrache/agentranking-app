import {
  METAPLEX_LISTING_REGISTRY_SOURCE,
  METAPLEX_SOURCE_TYPE,
} from "@/lib/metaplex/config";
import { hasMetaplexGenesisLookupAttempted } from "@/lib/metaplex/genesis-hydration-state";
import { normalizeBondingProgressPct } from "@/lib/metaplex/genesis-rules";
import type { MetaplexDetailPayload, MetaplexTokenBindingStatus } from "@/lib/metaplex/types";
function parseTokenBindingStatus(raw: string | null | undefined): MetaplexTokenBindingStatus {
  return raw === "bound" || raw === "unknown" ? raw : "unbound";
}
function readStringField(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function readNumberField(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function readObjectField(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const value = (obj as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function readArrayField(obj: unknown, key: string): unknown[] {
  if (!obj || typeof obj !== "object") return [];
  const value = (obj as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
function parseGenesisFromRaw(raw: unknown): {
  launchAddress: string | null;
  launchType: string | null;
  launchStatus: string | null;
  tradeUrl: string | null;
  bondingProgressPct: number | null;
  bondingProgressSource: string | null;
  bondingProgressUpdatedAt: string | null;
  technicalNote: string | null;
} {
  const empty = {
    launchAddress: null,
    launchType: null,
    launchStatus: null,
    tradeUrl: null,
    bondingProgressPct: null,
    bondingProgressSource: null,
    bondingProgressUpdatedAt: null,
    technicalNote: null,
  };
  if (!raw || typeof raw !== "object") {
    return empty;
  }
  const genesis = (raw as Record<string, unknown>).genesis;
  if (!genesis || typeof genesis !== "object") {
    return empty;
  }
  const g = genesis as Record<string, unknown>;
  const launchStatus = readStringField(g, "launchStatus");
  const bondingProgressSource = readStringField(g, "bondingProgressSource");
  const rawPct = readNumberField(g, "bondingProgressPct");
  return {
    launchAddress: readStringField(g, "launchAddress"),
    launchType: readStringField(g, "launchType"),
    launchStatus,
    tradeUrl: readStringField(g, "tradeUrl"),
    bondingProgressPct: normalizeBondingProgressPct(rawPct, launchStatus, bondingProgressSource),
    bondingProgressSource,
    bondingProgressUpdatedAt: readStringField(g, "bondingProgressUpdatedAt"),
    technicalNote: readStringField(g, "technicalNote"),
  };
}
function parseMetaplexRawExtras(raw: unknown): {
  authority: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { authority: null, tokenSymbol: null, tokenName: null };
  }
  const record = raw as Record<string, unknown>;
  const asset = record.asset;
  const core = record.core;
  const authority =
    readStringField(core, "updateAuthority") ??
    readStringField(asset, "updateAuthority") ??
    readStringField(asset, "authority") ??
    readStringField(record, "updateAuthority");
  const registrationJson = record.registrationJson;
  const tokenSymbol =
    readStringField(registrationJson, "tokenSymbol") ??
    readStringField(registrationJson, "symbol");
  const tokenName =
    readStringField(registrationJson, "tokenName") ?? readStringField(registrationJson, "name");
  return { authority, tokenSymbol, tokenName };
}
const EMPTY_GENESIS_FIELDS = {
  launchAddress: null,
  launchType: null,
  launchStatus: null,
  tradeUrl: null,
  bondingProgressPct: null,
  bondingProgressSource: null,
  bondingProgressUpdatedAt: null,
  hasDexPair: null,
  genesisLookupAttempted: false,
  genesisTechnicalNote: null,
} as const;
const EMPTY_METAPLEX_DETAIL: MetaplexDetailPayload = {
  isMetaplex: false,
  sourceType: METAPLEX_SOURCE_TYPE,
  assetAddress: null,
  agentIdentityPda: null,
  agentRegistrationUri: null,
  agentTokenMint: null,
  assetSignerPda: null,
  ownerWallet: null,
  authority: null,
  tokenSymbol: null,
  tokenName: null,
  verified: false,
  tokenBindingStatus: "unbound",
  supportedTrust: [],
  active: null,
  lastIndexedAt: null,
  identityVersion: null,
  lifecycleChecks: null,
  pluginAuthority: null,
  verificationEvidence: null,
  registrations: [],
  serviceDeclarations: [],
  coreAssetSnapshot: null,
  dasEvidence: null,
  ...EMPTY_GENESIS_FIELDS,
};
export function buildMetaplexDetail(agent: {
  owner?: string | null;
  listingRegistrySource?: string | null;
  metaplexSourceType?: string | null;
  metaplexAssetAddress?: string | null;
  metaplexAgentIdentityPda?: string | null;
  metaplexAgentRegistrationUri?: string | null;
  metaplexAgentTokenMint?: string | null;
  metaplexAssetSignerPda?: string | null;
  metaplexVerified?: boolean | null;
  metaplexTokenBindingStatus?: string | null;
  metaplexSupportedTrust?: string[] | null;
  metaplexActive?: boolean | null;
  metaplexLastIndexedAt?: Date | string | null;
  metaplexRawData?: unknown;
  metaplexLaunchAddress?: string | null;
  metaplexLaunchType?: string | null;
  metaplexLaunchStatus?: string | null;
  metaplexTradeUrl?: string | null;
  metaplexBondingProgressPct?: number | null;
  metaplexBondingProgressSource?: string | null;
  metaplexBondingProgressUpdatedAt?: Date | string | null;
  metaplexHasDexPair?: boolean | null;
}): MetaplexDetailPayload {
  const isMetaplex =
    agent.listingRegistrySource === METAPLEX_LISTING_REGISTRY_SOURCE ||
    Boolean(agent.metaplexAssetAddress?.trim()) ||
    agent.metaplexVerified === true;
  if (!isMetaplex) {
    return { ...EMPTY_METAPLEX_DETAIL };
  }
  const lastIndexedAt =
    agent.metaplexLastIndexedAt == null
      ? null
      : typeof agent.metaplexLastIndexedAt === "string"
        ? agent.metaplexLastIndexedAt
        : agent.metaplexLastIndexedAt.toISOString();
  const { authority, tokenSymbol, tokenName } = parseMetaplexRawExtras(agent.metaplexRawData);
  const rawRecord = agent.metaplexRawData && typeof agent.metaplexRawData === "object"
    ? agent.metaplexRawData as Record<string, unknown>
    : null;
  const rawCore = readObjectField(rawRecord, "core");
  const rawIdentity = readObjectField(rawRecord, "identity");
  const registrationJson = readObjectField(rawRecord, "registrationJson");
  const rawGenesis = parseGenesisFromRaw(agent.metaplexRawData);
  const launchStatus =
    agent.metaplexLaunchStatus?.trim() || rawGenesis.launchStatus;
  const bondingProgressSource =
    agent.metaplexBondingProgressSource?.trim() || rawGenesis.bondingProgressSource;
  const dbPct = agent.metaplexBondingProgressPct ?? rawGenesis.bondingProgressPct;
  const bondingProgressPct = normalizeBondingProgressPct(
    dbPct,
    launchStatus,
    bondingProgressSource,
  );
  const bondingProgressUpdatedAt =
    agent.metaplexBondingProgressUpdatedAt == null
      ? rawGenesis.bondingProgressUpdatedAt
      : typeof agent.metaplexBondingProgressUpdatedAt === "string"
        ? agent.metaplexBondingProgressUpdatedAt
        : agent.metaplexBondingProgressUpdatedAt.toISOString();
  return {
    isMetaplex: true,
    sourceType: agent.metaplexSourceType?.trim() || METAPLEX_SOURCE_TYPE,
    assetAddress: agent.metaplexAssetAddress?.trim() || null,
    agentIdentityPda: agent.metaplexAgentIdentityPda?.trim() || null,
    agentRegistrationUri: agent.metaplexAgentRegistrationUri?.trim() || null,
    agentTokenMint: agent.metaplexAgentTokenMint?.trim() || null,
    assetSignerPda: agent.metaplexAssetSignerPda?.trim() || null,
    ownerWallet: agent.owner?.trim() || null,
    authority,
    tokenSymbol,
    tokenName,
    verified: agent.metaplexVerified === true,
    tokenBindingStatus: parseTokenBindingStatus(agent.metaplexTokenBindingStatus),
    supportedTrust: agent.metaplexSupportedTrust ?? [],
    active: agent.metaplexActive ?? null,
    lastIndexedAt,
    identityVersion: readNumberField(rawIdentity, "version"),
    lifecycleChecks: readObjectField(rawCore, "lifecycleChecks"),
    pluginAuthority: rawCore?.pluginAuthority ?? null,
    verificationEvidence: readObjectField(rawRecord, "verification"),
    registrations: readArrayField(registrationJson, "registrations"),
    serviceDeclarations: readArrayField(registrationJson, "services"),
    coreAssetSnapshot: readObjectField(rawRecord, "asset"),
    dasEvidence: readObjectField(rawRecord, "das"),
    launchAddress: agent.metaplexLaunchAddress?.trim() || rawGenesis.launchAddress,
    launchType: agent.metaplexLaunchType?.trim() || rawGenesis.launchType,
    launchStatus,
    tradeUrl: agent.metaplexTradeUrl?.trim() || rawGenesis.tradeUrl,
    bondingProgressPct,
    bondingProgressSource: bondingProgressPct != null ? bondingProgressSource : null,
    bondingProgressUpdatedAt: bondingProgressPct != null ? bondingProgressUpdatedAt : null,
    hasDexPair: agent.metaplexHasDexPair ?? null,
    genesisLookupAttempted: hasMetaplexGenesisLookupAttempted(agent.metaplexRawData),
    genesisTechnicalNote: rawGenesis.technicalNote,
  };
}
