import type { AgentChainCluster } from "@/lib/agent-chain-cluster";
import {
  loadAgentChainClusterDeployments,
  type LoadClusterDeploymentsOptions,
} from "@/lib/agent-chain-cluster-server";
import {
  buildProfileDeployments,
  type LinkedRegistrationLite,
  type ProfileDeployment,
} from "@/lib/agent-profile-deployments";
import type { RegistrationMetaEntry } from "@/lib/agent-identity";
import type { DeploymentDbHints } from "@/lib/agent-chain-cluster-server";
export type ResolveAgentDeploymentsInput = {
  chainId: number;
  agentId: number;
  slug: string;
  profilePath: string;
  clusterKey?: string | null;
  chainClusterFull?: AgentChainCluster | null;
  sapTwinMatch?: boolean;
  sapGraphChainId?: number;
  sapGraphAgentId?: number;
  sapGraphSlug?: string | null;
  sapVerified?: boolean;
  metaplexAttached?: boolean;
  metaplexPrimary?: boolean;
  metaplexAssetAddress?: string | null;
  metaplexGraphChainId?: number;
  metaplexGraphAgentId?: number;
  metaplexGraphSlug?: string | null;
  linkedRegistrations?: readonly LinkedRegistrationLite[];
  registrationMeta?: readonly RegistrationMetaEntry[];
  deploymentDbHints?: DeploymentDbHints;
};
/** Unified profile + list deployment resolution (EVM cluster + SAP twin). */
export async function resolveAgentDeployments(
  input: ResolveAgentDeploymentsInput,
): Promise<{
  profileDeployments: ProfileDeployment[];
  chainClusterFull: AgentChainCluster | null;
}> {
  const loadOptions: LoadClusterDeploymentsOptions | undefined = input.clusterKey
    ? { clusterKey: input.clusterKey }
    : undefined;
  const chainClusterFull =
    input.chainClusterFull ??
    (await loadAgentChainClusterDeployments(input.chainId, input.agentId, loadOptions));
  const profileDeployments = buildProfileDeployments({
    chainId: input.chainId,
    agentId: input.agentId,
    slug: input.slug,
    profilePath: input.profilePath,
    chainCluster: chainClusterFull,
    sapTwinMatch: input.sapTwinMatch,
    sapGraphChainId: input.sapGraphChainId,
    sapGraphAgentId: input.sapGraphAgentId,
    sapGraphSlug: input.sapGraphSlug,
    sapVerified: input.sapVerified,
    metaplexAttached: input.metaplexAttached,
    metaplexPrimary: input.metaplexPrimary,
    metaplexAssetAddress: input.metaplexAssetAddress,
    metaplexGraphChainId: input.metaplexGraphChainId,
    metaplexGraphAgentId: input.metaplexGraphAgentId,
    metaplexGraphSlug: input.metaplexGraphSlug,
    linkedRegistrations: input.linkedRegistrations,
    registrationMeta: input.registrationMeta,
    indexedDeploymentKeys: input.deploymentDbHints?.indexedKeys,
    chainVerifiedByKey: input.deploymentDbHints?.chainVerifiedByKey,
    slugByDeploymentKey: input.deploymentDbHints?.slugByKey,
    profilePathByDeploymentKey: input.deploymentDbHints?.profilePathByKey,
  });
  return { profileDeployments, chainClusterFull };
}
