import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { deploymentKey, parseRegistrationRef, type AgentChainCluster, type ChainLogoStackItem } from "@/lib/agent-chain-cluster";
import { parseRegistrationMetadata } from "@/lib/agent-identity";
import { parsePublicAgentId } from "@/lib/agent-public-identity";
import { parseAgentFromUrl } from "@/lib/agent-url-parse";
import type { RegistrationMetaEntry, RegistrationStatus } from "@/lib/agent-identity";
export type SapTwinRefLite = { id: number; chainId: number; agentId: number };
export type ProfileDeployment = {
  chainId: number;
  agentId: number;
  slug: string;
  /** Current AgentRanking profile path when this deployment is indexed. */
  profilePath: string | null;
  chainName: string;
  chainShortName: string;
  chainIcon: string;
  chainColor: string;
  isCurrent: boolean;
  /** EVM cluster sibling vs SAP / Metaplex Solana deployment. */
  kind: "evm" | "sap" | "metaplex";
  /** Per-deployment ERC-8004 Validation Registry attestation (not cluster-propagated). */
  chainVerified: boolean;
  /** False when row comes from metadata/identity only and is not indexed in Agent table. */
  indexed?: boolean;
  /** Metaplex Core asset when kind is metaplex (external profile link). */
  metaplexAssetAddress?: string | null;
};
export type LinkedRegistrationLite = {
  status: RegistrationStatus;
  protocol: string;
  chainId: number;
  registrationId: string;
  profilePath: string | null;
};
export type BuildProfileDeploymentsInput = {
  chainId: number;
  agentId: number;
  slug: string;
  profilePath: string;
  chainCluster?: AgentChainCluster | null;
  sapTwinMatch?: boolean;
  sapGraphChainId?: number;
  sapGraphAgentId?: number;
  sapGraphSlug?: string | null;
  /** Primary row is SAP on Solana (no EVM twin view). */
  sapVerified?: boolean;
  /** Non-primary identity registrations (linked ERC-8004 twins, SAP twins). */
  linkedRegistrations?: readonly LinkedRegistrationLite[];
  /** Raw ERC-8004 `registrations` metadata when identity omits linked twins. */
  registrationMeta?: readonly RegistrationMetaEntry[];
  /** Deployments that exist in Agent table (promote ghost rows to indexed). */
  indexedDeploymentKeys?: ReadonlySet<string>;
  /** Per-deployment ERC-8004 Validation Registry attestation. */
  chainVerifiedByKey?: ReadonlyMap<string, boolean>;
  /** Canonical slugs for indexed deployments from DB names. */
  slugByDeploymentKey?: ReadonlyMap<string, string>;
  /** Canonical profile paths for indexed deployments from DB names. */
  profilePathByDeploymentKey?: ReadonlyMap<string, string>;
  /** Metaplex Agent Registry indexed on this profile (primary or twin-attached). */
  metaplexAttached?: boolean;
  metaplexPrimary?: boolean;
  metaplexAssetAddress?: string | null;
  metaplexGraphChainId?: number;
  metaplexGraphAgentId?: number;
  metaplexGraphSlug?: string | null;
};
export type PartitionedProfileDeployments = {
  evm: ProfileDeployment[];
  sap: ProfileDeployment[];
  metaplex: ProfileDeployment[];
};
/** ERC-8004 EVM deployments vs SAP Solana protocol twins. */
export function partitionProfileDeployments(
  deployments: readonly ProfileDeployment[],
): PartitionedProfileDeployments {
  const evm: ProfileDeployment[] = [];
  const sap: ProfileDeployment[] = [];
  const metaplex: ProfileDeployment[] = [];
  for (const d of deployments) {
    if (d.kind === "metaplex") metaplex.push(d);
    else if (d.kind === "sap") sap.push(d);
    else evm.push(d);
  }
  return { evm, sap, metaplex };
}
export function evmProfileDeployments(
  deployments: readonly ProfileDeployment[],
): ProfileDeployment[] {
  return partitionProfileDeployments(deployments).evm;
}
export function evmProfileDeploymentCount(deployments: readonly ProfileDeployment[]): number {
  return evmProfileDeployments(deployments).length;
}
function parseNumericRegistrationId(registrationId: string): number | null {
  const trimmed = registrationId.trim();
  return parsePublicAgentId(trimmed.startsWith("#") ? trimmed.slice(1) : trimmed);
}
function slugFromProfilePath(
  profilePath: string | null,
  expectedChainId: number,
  expectedAgentId: number,
): string | null {
  if (!profilePath?.trim()) return null;
  const parsed = parseAgentFromUrl(profilePath);
  if (
    !parsed ||
    parsed.chainId !== expectedChainId ||
    parsed.agentId !== expectedAgentId
  ) {
    return null;
  }
  return parsed.slug;
}
function mergeLinkedRegistrationsIntoDeployments(
  byKey: Map<string, ProfileDeployment>,
  linkedRegistrations: readonly LinkedRegistrationLite[],
  currentChainId: number,
  currentAgentId: number,
  fallbackSlug: string,
): void {
  const add = (d: ProfileDeployment) => {
    byKey.set(deploymentKey(d.chainId, d.agentId), d);
  };
  for (const reg of linkedRegistrations) {
    const isErc8004 =
      reg.protocol === "ERC-8004" || reg.protocol.toUpperCase() === "ERC8004";
    if (
      reg.status !== "linked" &&
      reg.status !== "twin" &&
      !(reg.status === "possible_duplicate" && isErc8004)
    ) {
      continue;
    }
    const regAgentId = parseNumericRegistrationId(reg.registrationId);
    if (regAgentId == null) continue;
    if (reg.chainId === currentChainId && regAgentId === currentAgentId) continue;
    const key = deploymentKey(reg.chainId, regAgentId);
    if (byKey.has(key)) continue;
    const regSlug =
      slugFromProfilePath(reg.profilePath, reg.chainId, regAgentId) ?? fallbackSlug;
    const isSap = reg.chainId === SOLANA_CHAIN_ID || reg.protocol === "SAP";
    add({
      chainId: reg.chainId,
      agentId: regAgentId,
      slug: regSlug,
      profilePath: null,
      isCurrent: false,
      kind: isSap ? "sap" : "evm",
      chainVerified: false,
      indexed: false,
      ...chainFields(reg.chainId),
    });
  }
}
function chainFields(chainId: number) {
  const chain = getChainByChainId(chainId);
  return {
    chainName: chain?.name ?? `Chain ${chainId}`,
    chainShortName: chain?.shortName ?? String(chainId),
    chainIcon: chain?.icon ?? "",
    chainColor: chain?.color ?? "#888",
  };
}
function sapDeployment(
  chainId: number,
  agentId: number,
  slug: string,
  profilePath: string | null,
  isCurrent: boolean,
): ProfileDeployment {
  return {
    chainId,
    agentId,
    slug,
    profilePath,
    isCurrent,
    kind: "sap",
    chainVerified: false,
    indexed: true,
    ...chainFields(chainId),
  };
}
function metaplexDeployment(
  chainId: number,
  agentId: number,
  slug: string,
  profilePath: string | null,
  isCurrent: boolean,
  indexed: boolean,
  metaplexAssetAddress?: string | null,
): ProfileDeployment {
  return {
    chainId,
    agentId,
    slug,
    profilePath,
    isCurrent,
    kind: "metaplex",
    chainVerified: false,
    indexed,
    metaplexAssetAddress: metaplexAssetAddress?.trim() || null,
    ...chainFields(chainId),
  };
}
function deploymentKindForSolanaRow(metaplexPrimary: boolean): ProfileDeployment["kind"] {
  return metaplexPrimary ? "metaplex" : "sap";
}
function slugMapFromCluster(
  chainCluster: AgentChainCluster | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of chainCluster?.deployments ?? []) {
    map.set(deploymentKey(d.chainId, d.agentId), d.slug);
  }
  return map;
}
function supplementDeploymentsFromRegistrationMeta(
  byKey: Map<string, ProfileDeployment>,
  registrationMeta: readonly RegistrationMetaEntry[],
  currentChainId: number,
  currentAgentId: number,
  fallbackSlug: string,
  slugByDeployment: Map<string, string>,
): void {
  const add = (d: ProfileDeployment) => {
    byKey.set(deploymentKey(d.chainId, d.agentId), d);
  };
  for (const meta of registrationMeta) {
    const ref = parseRegistrationRef(meta);
    if (!ref) continue;
    const { chainId: metaChainId, agentId: metaAgentId } = ref;
    if (metaChainId === currentChainId && metaAgentId === currentAgentId) continue;
    const key = deploymentKey(metaChainId, metaAgentId);
    if (byKey.has(key)) continue;
    const refSlug = slugByDeployment.get(key) ?? fallbackSlug;
    const isSap = metaChainId === SOLANA_CHAIN_ID;
    add({
      chainId: metaChainId,
      agentId: metaAgentId,
      slug: refSlug,
      profilePath: null,
      isCurrent: false,
      kind: isSap ? "sap" : "evm",
      chainVerified: false,
      indexed: false,
      ...chainFields(metaChainId),
    });
  }
}
/**
 * When exactly one EVM deployment is chain-verified, treat it as the operational "current" chain.
 * Otherwise keep the route the user opened.
 */
function resolveCurrentDeploymentKey(
  deployments: readonly ProfileDeployment[],
  routeChainId: number,
  routeAgentId: number,
  chainVerifiedByKey?: ReadonlyMap<string, boolean>,
): string {
  const routeKey = deploymentKey(routeChainId, routeAgentId);
  if (!chainVerifiedByKey?.size) return routeKey;
  const verifiedEvm = deployments.filter(
    (d) =>
      d.kind === "evm" &&
      chainVerifiedByKey.get(deploymentKey(d.chainId, d.agentId)) === true,
  );
  if (verifiedEvm.length === 0) return routeKey;
  const sorted = [...verifiedEvm].sort((a, b) => {
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    return a.agentId - b.agentId;
  });
  const pick = sorted[0]!;
  return deploymentKey(pick.chainId, pick.agentId);
}
function sortProfileDeployments(
  deployments: ProfileDeployment[],
  currentChainId: number,
  currentAgentId: number,
): ProfileDeployment[] {
  const currentKey = deploymentKey(currentChainId, currentAgentId);
  return [...deployments].sort((a, b) => {
    const aCurrent = deploymentKey(a.chainId, a.agentId) === currentKey;
    const bCurrent = deploymentKey(b.chainId, b.agentId) === currentKey;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    const aSolana = a.kind === "sap" || a.kind === "metaplex";
    const bSolana = b.kind === "sap" || b.kind === "metaplex";
    if (aSolana && !bSolana) return 1;
    if (bSolana && !aSolana) return -1;
    return a.chainName.localeCompare(b.chainName);
  });
}
function evmDeploymentFromCluster(
  d: AgentChainCluster["deployments"][number],
  isCurrent: boolean,
): ProfileDeployment {
  return {
    chainId: d.chainId,
    agentId: d.agentId,
    slug: d.slug,
    profilePath: d.profilePath,
    isCurrent,
    kind: "evm",
    chainVerified: d.rawChainVerified,
    indexed: true,
    chainName: d.chainName,
    chainShortName: d.chainShortName,
    chainIcon: d.chainIcon,
    chainColor: d.chainColor,
  };
}
/** Unified profile + list deployment stack (EVM cluster + SAP Solana twin). */
export function buildProfileDeployments(input: BuildProfileDeploymentsInput): ProfileDeployment[] {
  const {
    chainId,
    agentId,
    slug,
    profilePath,
    chainCluster,
    sapTwinMatch,
    sapGraphChainId,
    sapGraphAgentId,
    sapGraphSlug,
    sapVerified,
    linkedRegistrations,
    registrationMeta,
    indexedDeploymentKeys,
    chainVerifiedByKey,
    slugByDeploymentKey,
    profilePathByDeploymentKey,
    metaplexAttached,
    metaplexPrimary,
    metaplexAssetAddress,
    metaplexGraphChainId,
    metaplexGraphAgentId,
    metaplexGraphSlug,
  } = input;
  const mplPrimary = metaplexPrimary === true;
  const mplAttached = metaplexAttached === true && Boolean(metaplexAssetAddress?.trim());
  const byKey = new Map<string, ProfileDeployment>();
  const add = (d: ProfileDeployment) => {
    byKey.set(deploymentKey(d.chainId, d.agentId), d);
  };
  if (chainCluster?.deployments.length) {
    for (const d of chainCluster.deployments) {
      add(evmDeploymentFromCluster(d, d.chainId === chainId && d.agentId === agentId));
    }
  } else {
    const solanaKind =
      chainId === SOLANA_CHAIN_ID ? deploymentKindForSolanaRow(mplPrimary) : "evm";
    add({
      chainId,
      agentId,
      slug,
      profilePath,
      isCurrent: true,
      kind: solanaKind,
      chainVerified: false,
      indexed: true,
      ...(solanaKind === "metaplex"
        ? { metaplexAssetAddress: metaplexAssetAddress?.trim() || null }
        : {}),
      ...chainFields(chainId),
    });
  }
  const sapChainId = sapGraphChainId ?? (sapVerified && chainId === SOLANA_CHAIN_ID ? chainId : null);
  const sapAgentId =
    sapGraphAgentId ?? (sapVerified && chainId === SOLANA_CHAIN_ID ? agentId : null);
  const sapSlug = sapGraphSlug?.trim() || slug;
  if (sapTwinMatch && sapChainId != null && sapAgentId != null) {
    const key = deploymentKey(sapChainId, sapAgentId);
    if (!byKey.has(key)) {
      add(
        sapDeployment(
          sapChainId,
          sapAgentId,
          sapSlug,
          profilePathByDeploymentKey?.get(key) ?? null,
          sapChainId === chainId && sapAgentId === agentId,
        ),
      );
    }
  } else if (sapVerified && chainId === SOLANA_CHAIN_ID && !byKey.has(deploymentKey(chainId, agentId))) {
    if (mplPrimary) {
      add(metaplexDeployment(chainId, agentId, slug, profilePath, true, true, metaplexAssetAddress));
    } else {
      add(sapDeployment(chainId, agentId, slug, profilePath, true));
    }
  }
  if (mplAttached) {
    const mplChainId = metaplexGraphChainId ?? SOLANA_CHAIN_ID;
    const mplAgentId = metaplexGraphAgentId ?? agentId;
    const mplSlug = metaplexGraphSlug?.trim() || slug;
    const mplKey = deploymentKey(mplChainId, mplAgentId);
    const onSolanaPrimary = mplPrimary && chainId === SOLANA_CHAIN_ID && agentId === mplAgentId;
    if (!byKey.has(mplKey) && !onSolanaPrimary) {
      const mplIndexed =
        mplPrimary && mplChainId === chainId && mplAgentId === agentId
          ? true
          : Boolean(
              metaplexGraphChainId != null &&
                metaplexGraphAgentId != null &&
                indexedDeploymentKeys?.has(mplKey),
            );
      add(
        metaplexDeployment(
          mplChainId,
          mplAgentId,
          mplSlug,
          profilePathByDeploymentKey?.get(mplKey) ?? null,
          mplChainId === chainId && mplAgentId === agentId,
          mplIndexed,
          metaplexAssetAddress,
        ),
      );
    }
  }
  if (linkedRegistrations?.length) {
    mergeLinkedRegistrationsIntoDeployments(
      byKey,
      linkedRegistrations,
      chainId,
      agentId,
      slug,
    );
  }
  const slugByDeployment = slugMapFromCluster(chainCluster);
  if (registrationMeta?.length) {
    supplementDeploymentsFromRegistrationMeta(
      byKey,
      registrationMeta,
      chainId,
      agentId,
      slug,
      slugByDeployment,
    );
  }
  const currentKey = deploymentKey(chainId, agentId);
  if (![...byKey.values()].some((d) => deploymentKey(d.chainId, d.agentId) === currentKey)) {
    const solanaKind =
      chainId === SOLANA_CHAIN_ID ? deploymentKindForSolanaRow(mplPrimary) : "evm";
    add({
      chainId,
      agentId,
      slug,
      profilePath,
      isCurrent: true,
      kind: solanaKind,
      chainVerified: false,
      indexed: true,
      ...(solanaKind === "metaplex"
        ? { metaplexAssetAddress: metaplexAssetAddress?.trim() || null }
        : {}),
      ...chainFields(chainId),
    });
  }
  const effectiveIndexedKeys: Set<string> | undefined = indexedDeploymentKeys
    ? new Set(indexedDeploymentKeys)
    : undefined;
  if (sapTwinMatch && sapChainId != null && sapAgentId != null && effectiveIndexedKeys) {
    effectiveIndexedKeys.add(deploymentKey(sapChainId, sapAgentId));
  }
  const sorted = sortProfileDeployments([...byKey.values()], chainId, agentId);
  const withOverrides = applyDeploymentDbOverrides(
    sorted,
    effectiveIndexedKeys,
    chainVerifiedByKey,
    slugByDeploymentKey,
    profilePathByDeploymentKey,
  );
  const currentDeploymentKey = resolveCurrentDeploymentKey(
    withOverrides,
    chainId,
    agentId,
    chainVerifiedByKey,
  );
  return withOverrides.map((d) => ({
    ...d,
    isCurrent: deploymentKey(d.chainId, d.agentId) === currentDeploymentKey,
  }));
}
function applyDeploymentDbOverrides(
  deployments: ProfileDeployment[],
  indexedKeys?: ReadonlySet<string>,
  chainVerifiedByKey?: ReadonlyMap<string, boolean>,
  slugByKey?: ReadonlyMap<string, string>,
  profilePathByKey?: ReadonlyMap<string, string>,
): ProfileDeployment[] {
  if (
    !indexedKeys?.size &&
    !chainVerifiedByKey?.size &&
    !slugByKey?.size &&
    !profilePathByKey?.size
  ) {
    return deployments;
  }
  return deployments.map((d) => {
    const key = deploymentKey(d.chainId, d.agentId);
    const indexed = indexedKeys?.size ? indexedKeys.has(key) : d.indexed !== false;
    const chainVerified = chainVerifiedByKey?.has(key)
      ? (chainVerifiedByKey.get(key) ?? false)
      : d.chainVerified;
    const slug = slugByKey?.get(key) ?? d.slug;
    const profilePath = indexed ? (profilePathByKey?.get(key) ?? d.profilePath) : null;
    if (
      indexed === d.indexed &&
      chainVerified === d.chainVerified &&
      slug === d.slug &&
      profilePath === d.profilePath
    ) {
      return d;
    }
    return { ...d, indexed, chainVerified, slug, profilePath };
  });
}
export function profileDeploymentLogoStack(
  deployments: readonly ProfileDeployment[],
): ChainLogoStackItem[] {
  return deployments.map((d) => ({
    chainId: d.chainId,
    icon: d.chainIcon,
    chainShortName: d.chainShortName,
    chainName: d.chainName,
  }));
}
export type ListRowSapTwinMeta = {
  deploymentCount: number;
  chainLogoStack: ChainLogoStackItem[];
};
function appendChainToLogoStack(stack: ChainLogoStackItem[], chainId: number): void {
  if (stack.some((s) => s.chainId === chainId)) return;
  const chain = getChainByChainId(chainId);
  if (!chain) return;
  stack.push({
    chainId,
    icon: chain.icon,
    chainShortName: chain.shortName,
    chainName: chain.name,
  });
}
export function mergeListClusterMetaWithSapTwin<T extends ListRowSapTwinMeta & { chainId: number }>(
  row: T,
  sapTwinRef: SapTwinRefLite | null,
): T {
  if (!sapTwinRef) return row;
  const stack = [...row.chainLogoStack];
  appendChainToLogoStack(stack, row.chainId);
  appendChainToLogoStack(stack, SOLANA_CHAIN_ID);
  return {
    ...row,
    chainLogoStack: stack,
    deploymentCount: Math.max(row.deploymentCount, stack.length, 2),
  };
}
/** Append chain logos from expanded registration entries (metadata graph / agentURI). */
export function mergeListRegistrationEntries<T extends ListRowSapTwinMeta & { chainId: number }>(
  row: T,
  entries: readonly RegistrationMetaEntry[],
): T {
  if (entries.length === 0) return row;
  return mergeListRegistrationRefs(row, JSON.stringify(entries));
}
/** Append chain logos from ERC-8004 `registrations` metadata when cluster is a single deployment. */
export function mergeListRegistrationRefs<T extends ListRowSapTwinMeta & { chainId: number }>(
  row: T,
  registrationsMetaRaw: string | null | undefined,
): T {
  if (!registrationsMetaRaw?.trim()) return row;
  const refs = parseRegistrationMetadata(registrationsMetaRaw);
  if (refs.length === 0) return row;
  const stack = [...row.chainLogoStack];
  appendChainToLogoStack(stack, row.chainId);
  for (const meta of refs) {
    const ref = parseRegistrationRef(meta);
    if (!ref) continue;
    appendChainToLogoStack(stack, ref.chainId);
  }
  if (stack.length <= row.chainLogoStack.length) return row;
  return {
    ...row,
    chainLogoStack: stack,
    deploymentCount: Math.max(row.deploymentCount, stack.length),
  };
}
