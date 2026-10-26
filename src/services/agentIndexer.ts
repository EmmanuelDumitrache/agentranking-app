import "server-only";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { mapWithConcurrency } from "@/lib/async-pool";
import { deploymentKey, parseRegistrationRef } from "@/lib/agent-chain-cluster";
import { loadAgentChainCluster } from "@/lib/agent-chain-cluster-server";
import { walletMatchesAgent } from "@/lib/verify-ownership";
import { computeRankingTier } from "@/utils/rankWeights";
import { createErc8004Provider } from "@/services/providers/erc8004Provider";
import type {
  AgentHandle,
  ChainFetchError,
  ChainIdentityDeployment,
  ChainReputationFootprint,
  ChainValidationFootprint,
  EvmAddress,
  UnifiedAgentProfile,
} from "@/types/agent";
import { normalizeEvmAddress } from "@/types/agent";
const DEFAULT_CHAINS = [8453, 56, 1] as const;
export type FetchFullAgentFootprintOptions = {
  chains?: number[];
  preferDb?: boolean;
  hydrateValidation?: boolean;
  maxValidationRecordsPerChain?: number;
};
type ResolvedHandle = AgentHandle & {
  agentDbId?: number;
  clusterKey?: string | null;
};
async function findAgentsByWallet(wallet: EvmAddress) {
  return withTransientPoolRetry(() =>
    prisma.agent.findMany({
      where: {
        isActive: true,
        OR: [
          { owner: { equals: wallet, mode: "insensitive" } },
          { verifiedWallet: { equals: wallet, mode: "insensitive" } },
          {
            metadata: {
              some: {
                key: "agentWallet",
                value: { equals: wallet, mode: "insensitive" },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        chainId: true,
        agentId: true,
        name: true,
        owner: true,
        clusterKey: true,
        metadata: { select: { key: true, value: true } },
      },
      take: 50,
    }),
  );
}
async function resolveHandlesForWallet(
  wallet: EvmAddress,
  targetChains: readonly number[],
): Promise<ResolvedHandle[]> {
  const rows = await findAgentsByWallet(wallet);
  const matched = rows.filter((row) =>
    walletMatchesAgent(wallet, { owner: row.owner, metadata: row.metadata }),
  );
  const handleMap = new Map<string, ResolvedHandle>();
  const addHandle = (handle: ResolvedHandle) => {
    const key = deploymentKey(handle.chainId, handle.agentId);
    const existing = handleMap.get(key);
    if (!existing) {
      handleMap.set(key, handle);
      return;
    }
    handleMap.set(key, {
      ...existing,
      agentDbId: existing.agentDbId ?? handle.agentDbId,
      clusterKey: existing.clusterKey ?? handle.clusterKey,
    });
  };
  for (const row of matched) {
    const cluster = await loadAgentChainCluster(row.chainId, row.agentId);
    if (cluster) {
      for (const deployment of cluster.deployments) {
        if (!targetChains.includes(deployment.chainId)) continue;
        addHandle({
          chainId: deployment.chainId,
          agentId: deployment.agentId,
          agentDbId: deployment.agentDbId,
          clusterKey: cluster.clusterKey,
        });
      }
      continue;
    }
    if (targetChains.includes(row.chainId)) {
      addHandle({
        chainId: row.chainId,
        agentId: row.agentId,
        agentDbId: row.id,
        clusterKey: row.clusterKey,
      });
    }
  }
  return [...handleMap.values()];
}
function expandHandlesFromRegistrations(
  deployments: ChainIdentityDeployment[],
  targetChains: readonly number[],
  existing: Map<string, ResolvedHandle>,
): void {
  for (const deployment of deployments) {
    for (const ref of deployment.registrationRefs) {
      const parsed = parseRegistrationRef(ref);
      if (!parsed || !targetChains.includes(parsed.chainId)) continue;
      const key = deploymentKey(parsed.chainId, parsed.agentId);
      if (existing.has(key)) continue;
      existing.set(key, {
        chainId: parsed.chainId,
        agentId: parsed.agentId,
        clusterKey: null,
      });
    }
  }
}
export async function fetchFullAgentFootprint(
  agentAddress: string,
  options?: FetchFullAgentFootprintOptions,
): Promise<UnifiedAgentProfile> {
  const wallet = normalizeEvmAddress(agentAddress);
  if (!wallet) {
    throw new Error("Invalid EVM agent address");
  }
  const targetChains = options?.chains?.length ? options.chains : [...DEFAULT_CHAINS];
  const provider = createErc8004Provider();
  const partialErrors: ChainFetchError[] = [];
  const resolved = options?.preferDb === false ? [] : await resolveHandlesForWallet(wallet, targetChains);
  const handleMap = new Map<string, ResolvedHandle>();
  for (const handle of resolved) {
    handleMap.set(deploymentKey(handle.chainId, handle.agentId), handle);
  }
  const deployments: ChainIdentityDeployment[] = [];
  const reputationByChain: ChainReputationFootprint[] = [];
  const validationByChain: ChainValidationFootprint[] = [];
  const fetchDeploymentBundle = async (handle: ResolvedHandle) => {
    const identityResult = await provider.getIdentity(handle);
    if (identityResult.error) partialErrors.push(identityResult.error);
    deployments.push(identityResult.deployment);
    const [reputationResult, validationResult] = await Promise.all([
      provider.getReputation(handle),
      provider.getValidation(handle, {
        hydrateValidation: options?.hydrateValidation ?? true,
        maxValidationRecordsPerChain: options?.maxValidationRecordsPerChain,
      }),
    ]);
    if (reputationResult.error) partialErrors.push(reputationResult.error);
    if (validationResult.error) partialErrors.push(validationResult.error);
    reputationByChain.push(reputationResult.footprint);
    validationByChain.push(validationResult.footprint);
  };
  if (handleMap.size === 0) {
    return {
      wallet,
      deployments: [],
      reputationByChain: [],
      validationByChain: [],
      clusterKey: null,
      sourceChains: [],
      fetchedAt: new Date().toISOString(),
      partialErrors: [
        {
          chainId: 0,
          stage: "identity",
          message: "No indexed deployments found for wallet",
          retryable: false,
        },
      ],
      ranking: computeRankingTier({
        wallet,
        deployments: [],
        reputationByChain: [],
        validationByChain: [],
        clusterKey: null,
        sourceChains: [],
        fetchedAt: new Date().toISOString(),
        partialErrors: [],
      }),
    };
  }
  await mapWithConcurrency([...handleMap.values()], 3, fetchDeploymentBundle);
  expandHandlesFromRegistrations(deployments, targetChains, handleMap);
  const missing = [...handleMap.values()].filter(
    (handle) => !deployments.some((d) => d.handle.chainId === handle.chainId && d.handle.agentId === handle.agentId),
  );
  if (missing.length > 0) {
    await mapWithConcurrency(missing, 3, fetchDeploymentBundle);
  }
  const clusterKey = resolved.find((handle) => handle.clusterKey)?.clusterKey ?? null;
  const sourceChains = [...new Set(deployments.map((d) => d.handle.chainId))].sort((a, b) => a - b);
  const profile: UnifiedAgentProfile = {
    wallet,
    deployments,
    reputationByChain,
    validationByChain,
    clusterKey,
    sourceChains,
    fetchedAt: new Date().toISOString(),
    partialErrors,
  };
  profile.ranking = computeRankingTier(profile);
  return profile;
}
