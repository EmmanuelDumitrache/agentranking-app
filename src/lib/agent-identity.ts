import { getChainByChainId } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { isMetaplexPrimaryListing } from "@/lib/metaplex/detect";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { normalizeAgentNameKey } from "@/lib/agent-name-key";
import { shouldShowOwnerVerifyCta } from "@/lib/agent-owner-cta";
import { collectUrlKeysForTwinMatch } from "@/lib/sap-twin-url-keys";
export { shouldShowOwnerVerifyCta } from "@/lib/agent-owner-cta";
export type IdentityConfidence = "High" | "Medium" | "Low";
export type RegistrationStatus =
  | "primary"
  | "linked"
  | "possible_duplicate"
  | "unverified"
  | "twin";
export type IdentityProtocol = "SAP" | "ERC-8004" | "MCP" | "x402" | "OASF" | "Metaplex";
export type AgentIdentityRegistration = {
  status: RegistrationStatus;
  statusLabel: string;
  protocol: IdentityProtocol;
  chainId: number;
  chainName: string;
  registrationId: string;
  ownerWallet: string | null;
  verified: boolean;
  verifiedOwner: boolean;
  explorerUrl: string | null;
  profilePath: string | null;
  agentDbId: number;
  matchReason: string | null;
};
export type AgentIdentitySummary = {
  primaryChainId: number;
  primaryChainName: string;
  primaryProtocol: IdentityProtocol;
  primaryRegistrationId: string;
  ownerWallet: string | null;
  agentWallet: string | null;
  confidence: IdentityConfidence;
  confidenceExplanation: string;
  verificationStatus: string;
  lastIndexedAt: string | null;
  registrationCount: number;
  possibleDuplicateCount: number;
  showClaimCta: boolean;
  x402Enabled: boolean;
  mcpEnabled: boolean;
};
export type AgentIdentityPayload = {
  summary: AgentIdentitySummary;
  registrations: AgentIdentityRegistration[];
};
export type RegistrationMetaEntry = {
  agentId?: number;
  agentRegistry?: string;
  chainId?: number;
};
export type RelatedSapIdentityRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  slug: string;
  profilePath: string;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  agentURI: string | null;
  sapLastSyncedAt: string | null;
  isVerified: boolean;
  matchReason: "primary" | "twin" | "url" | "owner";
};
export type BuildAgentIdentityInput = {
  id: number;
  agentId: number;
  chainId: number;
  chainName: string;
  name: string;
  owner: string;
  agentWallet: string | null;
  isVerified: boolean;
  isPremiumVerified: boolean;
  sapVerified: boolean;
  sapTwinMatch: boolean;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  sapLastSyncedAt: string | null;
  sapOperatorClaimed: boolean;
  sapClaimedByViewer: boolean;
  listingRegistrySource: string | null;
  metaplexVerified?: boolean | null;
  metaplexAssetAddress?: string | null;
  agentURI: string;
  x402Support: boolean;
  hasPublishedMcpOffers: boolean;
  hasDuplicateName: boolean;
  services: ReadonlyArray<{ name: string; endpoint: string }>;
  metadata: ReadonlyArray<{ key: string; value: string }>;
  etherscanExplorerUrl: string | null;
  relatedSapRows: RelatedSapIdentityRow[];
  registrationMeta: RegistrationMetaEntry[];
  claimedAgentDbIds: ReadonlySet<number>;
  /** Resolved multi-chain ERC-8004 siblings (from cluster loader). */
  clusterDeployments?: ReadonlyArray<{
    agentDbId: number;
    chainId: number;
    agentId: number;
    name: string;
    slug: string;
    profilePath: string;
    isVerified: boolean;
  }>;
};
const STATUS_LABELS: Record<RegistrationStatus, string> = {
  primary: "Primary registration",
  linked: "Linked registration",
  possible_duplicate: "Possible duplicate",
  unverified: "Unverified registration",
  twin: "Twin",
};
const AGENT_REGISTRY_RE = /^eip155:(\d+):0x[a-fA-F0-9]{40}$/;
/** Parse inline `registrations[]` from ERC-8004 agentURI (base64 data URI or raw JSON). */
export function extractRegistrationsFromAgentUri(
  agentURI: string | null | undefined,
): RegistrationMetaEntry[] {
  if (!agentURI?.trim()) return [];
  const uri = agentURI.trim();
  let jsonText: string | null = null;
  const dataPrefix = "data:application/json;base64,";
  if (uri.startsWith(dataPrefix)) {
    try {
      jsonText = Buffer.from(uri.slice(dataPrefix.length), "base64").toString("utf8");
    } catch {
      return [];
    }
  } else if (uri.startsWith("{")) {
    jsonText = uri;
  } else {
    return [];
  }
  if (jsonText == null) return [];
  try {
    const parsed = JSON.parse(jsonText) as { registrations?: unknown };
    if (!Array.isArray(parsed.registrations)) return [];
    return parseRegistrationMetadata(JSON.stringify(parsed.registrations));
  } catch {
    return [];
  }
}
export function parseRegistrationMetadata(value: string): RegistrationMetaEntry[] {
  try {
    const arr = JSON.parse(value) as RegistrationMetaEntry[];
    if (!Array.isArray(arr)) return [];
    const out: RegistrationMetaEntry[] = [];
    for (const raw of arr) {
      const agentId = Number(raw.agentId);
      if (!Number.isFinite(agentId) || agentId <= 0) continue;
      let chainId = raw.chainId != null && Number.isFinite(raw.chainId) ? Number(raw.chainId) : undefined;
      if (chainId == null && raw.agentRegistry) {
        const m = AGENT_REGISTRY_RE.exec(raw.agentRegistry.trim());
        if (m) chainId = Number(m[1]);
      }
      out.push({ agentId, chainId, agentRegistry: raw.agentRegistry });
    }
    return out;
  } catch {
    return [];
  }
}
export function registrationStatusLabel(status: RegistrationStatus): string {
  return STATUS_LABELS[status];
}
function chainLabel(chainId: number): string {
  return getChainByChainId(chainId)?.name ?? `Chain ${chainId}`;
}
export function evmExplorerTokenUrl(chainId: number, agentId: number): string | null {
  const chain = getChainByChainId(chainId);
  if (!chain?.identityRegistry) return null;
  const base = chainId === 1 ? "https://etherscan.io" : null;
  if (chainId === 8453) return `https://basescan.org/nft/${chain.identityRegistry}/${agentId}`;
  if (chainId === 1) return `${base}/nft/${chain.identityRegistry}/${agentId}`;
  return null;
}
export function sapExplorerUrl(pda: string): string {
  return `https://explorer.oobeprotocol.ai/account/${encodeURIComponent(pda)}`;
}
function isMetaplexListing(input: BuildAgentIdentityInput): boolean {
  return isMetaplexPrimaryListing({
    listingRegistrySource: input.listingRegistrySource,
    metaplexAssetAddress: input.metaplexAssetAddress,
    metaplexVerified: input.metaplexVerified,
  });
}
function isSapPrimaryProfile(input: BuildAgentIdentityInput): boolean {
  return (
    input.chainId === SOLANA_CHAIN_ID ||
    input.sapVerified === true ||
    input.listingRegistrySource === "sap"
  );
}
function computeVerificationStatus(input: BuildAgentIdentityInput): string {
  if (input.isPremiumVerified) return "Premium verified";
  if (input.sapOperatorClaimed && input.isVerified) return "Verified owner";
  if (input.sapOperatorClaimed || input.isVerified) return "Partially verified";
  return "Unverified";
}
function computeConfidence(
  input: BuildAgentIdentityInput,
  registrations: AgentIdentityRegistration[],
): { confidence: IdentityConfidence; explanation: string } {
  const linkedCount = registrations.filter((r) => r.status !== "primary").length;
  const hasTwin = registrations.some((r) => r.status === "twin");
  const hasDuplicate = registrations.some((r) => r.status === "possible_duplicate");
  const verifiedOwner =
    input.sapOperatorClaimed || input.isVerified || input.isPremiumVerified;
  const urlKeys = collectUrlKeysForTwinMatch({
    agentURI: input.agentURI,
    sapX402Endpoint: null,
    services: input.services,
  });
  if (
    verifiedOwner &&
    (linkedCount >= 1 || hasTwin) &&
    (urlKeys.length > 0 || input.sapTwinMatch)
  ) {
    return {
      confidence: "High",
      explanation: `This profile links ${Math.max(1, linkedCount)} matching on-chain registration${linkedCount === 1 ? "" : "s"}, a verified owner signal, and matching listing metadata.`,
    };
  }
  if (verifiedOwner) {
    return {
      confidence: "High",
      explanation: "A verified owner wallet or claim is associated with this canonical profile.",
    };
  }
  if (linkedCount >= 1 || hasTwin || input.sapTwinMatch || urlKeys.length > 0) {
    return {
      confidence: "Medium",
      explanation: hasDuplicate
        ? "Multiple registrations share name, website, endpoint, or owner wallet signals."
        : "Registry metadata and endpoints suggest related on-chain identities.",
    };
  }
  if (input.sapVerified || input.agentURI.trim() || input.services.length > 0) {
    return {
      confidence: "Medium",
      explanation: "Indexed registry metadata is present, but owner verification is limited.",
    };
  }
  return {
    confidence: "Low",
    explanation: "Only a single weakly linked registration was detected for this profile.",
  };
}
function resolveLastIndexed(input: BuildAgentIdentityInput): string | null {
  const candidates = [input.sapLastSyncedAt];
  for (const row of input.relatedSapRows) {
    if (row.sapLastSyncedAt) candidates.push(row.sapLastSyncedAt);
  }
  const valid = candidates.filter((v): v is string => Boolean(v));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}
function buildErc8004Registration(
  input: BuildAgentIdentityInput,
  status: RegistrationStatus,
  matchReason: string | null,
): AgentIdentityRegistration {
  const explorer =
    input.etherscanExplorerUrl ??
    evmExplorerTokenUrl(input.chainId, input.agentId) ??
    null;
  const verifiedOwner = input.claimedAgentDbIds.has(input.id) || input.isVerified;
  return {
    status,
    statusLabel: registrationStatusLabel(status),
    protocol: "ERC-8004",
    chainId: input.chainId,
    chainName: input.chainName,
    registrationId: `#${input.agentId}`,
    ownerWallet: input.owner?.trim() || null,
    verified: input.isVerified || input.isPremiumVerified,
    verifiedOwner,
    explorerUrl: explorer,
    profilePath: agentPublicPath(input),
    agentDbId: input.id,
    matchReason,
  };
}
function buildSapRegistration(
  row: RelatedSapIdentityRow,
  status: RegistrationStatus,
  claimedAgentDbIds: ReadonlySet<number>,
): AgentIdentityRegistration {
  const pda = row.sapAgentPda?.trim() ?? "";
  const owner = row.sapOwnerWallet?.trim() || null;
  return {
    status,
    statusLabel: registrationStatusLabel(status),
    protocol: "SAP",
    chainId: row.chainId,
    chainName: chainLabel(row.chainId),
    registrationId: pda || `#${row.agentId}`,
    ownerWallet: owner,
    verified: row.isVerified,
    verifiedOwner: claimedAgentDbIds.has(row.id),
    explorerUrl: pda ? sapExplorerUrl(pda) : null,
    profilePath: row.profilePath,
    agentDbId: row.id,
    matchReason: row.matchReason === "primary" ? null : row.matchReason,
  };
}
export function buildAgentIdentity(input: BuildAgentIdentityInput): AgentIdentityPayload {
  const registrations: AgentIdentityRegistration[] = [];
  const seenDbIds = new Set<number>();
  const sapPrimary = isSapPrimaryProfile(input);
  const canonicalSlug = toAgentUrlSlug(input.name);
  const addRegistration = (reg: AgentIdentityRegistration) => {
    if (seenDbIds.has(reg.agentDbId)) return;
    seenDbIds.add(reg.agentDbId);
    registrations.push(reg);
  };
  if (sapPrimary) {
    const primarySap =
      input.relatedSapRows.find((r) => r.id === input.id) ??
      input.relatedSapRows.find((r) => r.sapAgentPda && r.sapAgentPda === input.sapAgentPda) ??
      input.relatedSapRows[0];
    if (primarySap) {
      addRegistration(buildSapRegistration(primarySap, "primary", input.claimedAgentDbIds));
    } else if (input.sapAgentPda) {
      addRegistration(
        buildSapRegistration(
          {
            id: input.id,
            agentId: input.agentId,
            chainId: input.chainId,
            name: input.name,
            slug: canonicalSlug,
            profilePath: agentPublicPath(input),
            sapAgentPda: input.sapAgentPda,
            sapOwnerWallet: input.sapOwnerWallet,
            agentURI: input.agentURI,
            sapLastSyncedAt: input.sapLastSyncedAt,
            isVerified: input.isVerified,
            matchReason: "primary",
          },
          "primary",
          input.claimedAgentDbIds,
        ),
      );
    }
    for (const row of input.relatedSapRows) {
      if (row.id === input.id) continue;
      const sameName = normalizeAgentNameKey(row.name) === normalizeAgentNameKey(input.name);
      const status: RegistrationStatus =
        row.matchReason === "twin"
          ? "twin"
          : sameName || row.matchReason === "owner" || row.matchReason === "url"
            ? "possible_duplicate"
            : "linked";
      addRegistration(buildSapRegistration(row, status, input.claimedAgentDbIds));
    }
  } else {
    addRegistration(buildErc8004Registration(input, "primary", null));
    for (const row of input.relatedSapRows) {
      const status: RegistrationStatus = row.matchReason === "twin" ? "twin" : "linked";
      addRegistration(buildSapRegistration(row, status, input.claimedAgentDbIds));
    }
  }
  const clusterByKey = new Map<string, NonNullable<BuildAgentIdentityInput["clusterDeployments"]>[number]>();
  for (const d of input.clusterDeployments ?? []) {
    clusterByKey.set(`${d.chainId}:${d.agentId}`, d);
  }
  for (const meta of input.registrationMeta) {
    const chainId = meta.chainId != null && Number.isFinite(meta.chainId) ? Number(meta.chainId) : null;
    const regAgentId = Number(meta.agentId);
    if (chainId == null) continue;
    if (chainId === input.chainId && regAgentId === input.agentId) continue;
    const resolved = clusterByKey.get(`${chainId}:${regAgentId}`);
    const chainName = chainLabel(chainId);
    addRegistration({
      status: "linked",
      statusLabel: registrationStatusLabel("linked"),
      protocol: "ERC-8004",
      chainId,
      chainName,
      registrationId: `#${regAgentId}`,
      ownerWallet: null,
      verified: resolved?.isVerified ?? false,
      verifiedOwner: resolved ? input.claimedAgentDbIds.has(resolved.agentDbId) : false,
      explorerUrl: evmExplorerTokenUrl(chainId, regAgentId),
      profilePath: resolved?.profilePath ?? null,
      agentDbId: resolved?.agentDbId ?? -chainId * 1_000_000 - regAgentId,
      matchReason: "metadata_registrations",
    });
  }
  for (const d of input.clusterDeployments ?? []) {
    if (d.chainId === input.chainId && d.agentId === input.agentId) continue;
    const chainName = chainLabel(d.chainId);
    addRegistration({
      status: "linked",
      statusLabel: registrationStatusLabel("linked"),
      protocol: "ERC-8004",
      chainId: d.chainId,
      chainName,
      registrationId: `#${d.agentId}`,
      ownerWallet: null,
      verified: d.isVerified,
      verifiedOwner: input.claimedAgentDbIds.has(d.agentDbId),
      explorerUrl: evmExplorerTokenUrl(d.chainId, d.agentId),
      profilePath: d.profilePath,
      agentDbId: d.agentDbId,
      matchReason: "cluster",
    });
  }
  registrations.sort((a, b) => {
    const order: Record<RegistrationStatus, number> = {
      primary: 0,
      twin: 1,
      linked: 2,
      possible_duplicate: 3,
      unverified: 4,
    };
    return order[a.status] - order[b.status];
  });
  const possibleDuplicateCount = registrations.filter(
    (r) => r.status === "possible_duplicate",
  ).length;
  const sapBacked = input.sapVerified || input.sapTwinMatch;
  const metaplexListing = isMetaplexListing(input);
  const primaryProtocol: IdentityProtocol = sapPrimary && sapBacked
    ? "SAP"
    : metaplexListing
      ? "Metaplex"
      : "ERC-8004";
  const primaryChainName = chainLabel(input.chainId);
  const primaryRegistrationId = sapPrimary && input.sapAgentPda?.trim()
    ? input.sapAgentPda.trim()
    : metaplexListing && input.metaplexAssetAddress?.trim()
      ? input.metaplexAssetAddress.trim()
      : `#${input.agentId}`;
  const ownerWallet =
    (input.sapOwnerWallet?.trim() || input.owner?.trim() || null) ?? null;
  const { confidence, explanation } = computeConfidence(input, registrations);
  const mcpEnabled =
    input.hasPublishedMcpOffers ||
    input.services.some((s) => s.name.toUpperCase() === "MCP") ||
    input.metadata.some((m) => m.key === "mcpTools" && m.value.trim() && m.value !== "[]");
  const summary: AgentIdentitySummary = {
    primaryChainId: input.chainId,
    primaryChainName,
    primaryProtocol,
    primaryRegistrationId,
    ownerWallet,
    agentWallet: input.agentWallet,
    confidence,
    confidenceExplanation: explanation,
    verificationStatus: computeVerificationStatus(input),
    lastIndexedAt: resolveLastIndexed(input),
    registrationCount: registrations.length,
    possibleDuplicateCount,
    showClaimCta: shouldShowOwnerVerifyCta(input),
    x402Enabled: input.x402Support,
    mcpEnabled,
  };
  return { summary, registrations };
}
