import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { parseRegistrationRef } from "@/lib/agent-chain-cluster";
import {
  loadAgentChainClusterDeployments,
  loadDeploymentDbHints,
  loadExpandedRegistrationMeta,
} from "@/lib/agent-chain-cluster-server";
import { resolveAgentDeployments } from "@/lib/resolve-agent-deployments";
import {
  deploymentIdentityStatus,
  deploymentValidatorStatus,
  hasErc8004IdentityRegistered,
} from "@/lib/profile-deployment-status";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import {
  getCachedSapTwinIndex,
  resolveUniqueSapTwinForEvmRow,
} from "@/lib/sap-name-twin";
import { toPublicAgentCredential, type PublicAgentCredential } from "@/lib/verification/public-agent-credential";
import { OWNER_CREDENTIAL_SELECT } from "@/lib/verification/public-agent-credential.server";
export type AgentVerificationChainRow = {
  chainId: number;
  agentId: number;
  slug: string;
  profilePath: string | null;
  chainShortName: string;
  kind: "evm" | "sap" | "metaplex";
  identityRegistered: boolean;
  validatorAttested: boolean;
  indexed: boolean;
};
export type AgentVerificationPayload = {
  site: {
    verified: boolean;
    premiumVerified: boolean;
    label: string;
  };
  chain: AgentVerificationChainRow[];
  sap: {
    verified: boolean;
    twinMatch: boolean;
  };
  clusterChainVerified: boolean;
  clusterIdentityRegistered: boolean;
  credential: PublicAgentCredential;
};
function siteVerificationLabel(input: {
  isPremiumVerified: boolean;
  isVerified: boolean;
  clusterChainVerified: boolean;
  clusterIdentityRegistered: boolean;
}): string {
  if (input.isPremiumVerified) return "Premium verified";
  if (input.isVerified) return "Verified";
  if (input.clusterChainVerified) return "Validator attested";
  if (input.clusterIdentityRegistered) return "Identity registered";
  return "Unverified";
}
export async function getAgentVerificationPayload(
  chainId: number,
  agentId: number,
): Promise<AgentVerificationPayload | null> {
  const agent = await withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      select: {
        id: true,
        chainId: true,
        agentId: true,
        name: true,
        clusterKey: true,
        agentURI: true,
        isVerified: true,
        isPremiumVerified: true,
        sapVerified: true,
        isActive: true,
        metadata: { select: { key: true, value: true } },
        services: { select: { name: true, endpoint: true } },
        sapX402Endpoint: true,
        ownerAccount: { select: OWNER_CREDENTIAL_SELECT },
      },
    }),
  );
  if (!agent?.isActive) return null;
  const slug = toAgentUrlSlug(agent.name);
  const sapTwinIndex = await getCachedSapTwinIndex();
  const sapTwinRef =
    agent.sapVerified !== true && agent.chainId !== SOLANA_CHAIN_ID
      ? resolveUniqueSapTwinForEvmRow(
          {
            name: agent.name,
            chainId: agent.chainId,
            sapVerified: agent.sapVerified,
            agentURI: agent.agentURI,
            sapX402Endpoint: agent.sapX402Endpoint,
            services: agent.services,
          },
          sapTwinIndex,
        )
      : null;
  const sapTwinMatch = Boolean(sapTwinRef);
  const effectiveSapVerified = agent.sapVerified === true || sapTwinMatch;
  const registrationMeta = await loadExpandedRegistrationMeta(
    agent.chainId,
    agent.agentId,
    agent.metadata,
    agent.agentURI,
  );
  const chainClusterFull = await loadAgentChainClusterDeployments(
    agent.chainId,
    agent.agentId,
    agent.clusterKey ? { clusterKey: agent.clusterKey } : undefined,
  );
  const deploymentHandleMap = new Map<string, { chainId: number; agentId: number }>();
  const addDeploymentHandle = (handleChainId: number, handleAgentId: number) => {
    deploymentHandleMap.set(`${handleChainId}:${handleAgentId}`, {
      chainId: handleChainId,
      agentId: handleAgentId,
    });
  };
  addDeploymentHandle(agent.chainId, agent.agentId);
  for (const entry of registrationMeta) {
    const ref = parseRegistrationRef(entry);
    if (ref) addDeploymentHandle(ref.chainId, ref.agentId);
  }
  for (const deployment of chainClusterFull?.deployments ?? []) {
    addDeploymentHandle(deployment.chainId, deployment.agentId);
  }
  if (sapTwinMatch && sapTwinRef) {
    addDeploymentHandle(sapTwinRef.chainId, sapTwinRef.agentId);
  }
  const deploymentDbHints = await loadDeploymentDbHints([...deploymentHandleMap.values()]);
  const { profileDeployments } = await resolveAgentDeployments({
    chainId: agent.chainId,
    agentId: agent.agentId,
    slug,
    profilePath: agentPublicPath(agent),
    clusterKey: agent.clusterKey,
    chainClusterFull,
    sapTwinMatch,
    sapGraphChainId: sapTwinMatch && sapTwinRef ? sapTwinRef.chainId : undefined,
    sapGraphAgentId: sapTwinMatch && sapTwinRef ? sapTwinRef.agentId : undefined,
    sapGraphSlug: sapTwinMatch && sapTwinRef ? slug : null,
    sapVerified: effectiveSapVerified,
    registrationMeta,
    deploymentDbHints,
  });
  const clusterChainVerified =
    chainClusterFull?.clusterChainVerified ??
    profileDeployments.some((deployment) => deployment.chainVerified);
  const clusterIdentityRegistered = hasErc8004IdentityRegistered(profileDeployments);
  return {
    site: {
      verified: agent.isVerified,
      premiumVerified: agent.isPremiumVerified,
      label: siteVerificationLabel({
        isPremiumVerified: agent.isPremiumVerified,
        isVerified: agent.isVerified,
        clusterChainVerified,
        clusterIdentityRegistered,
      }),
    },
    chain: profileDeployments.map((deployment) => {
      const identityRegistered = deploymentIdentityStatus(deployment) === "registered";
      const validatorAttested = deploymentValidatorStatus(deployment) === "attested";
      return {
        chainId: deployment.chainId,
        agentId: deployment.agentId,
        slug: deployment.slug,
        profilePath: deployment.profilePath,
        chainShortName: deployment.chainShortName,
        kind: deployment.kind,
        identityRegistered,
        validatorAttested,
        indexed: deployment.indexed !== false,
      };
    }),
    sap: {
      verified: effectiveSapVerified,
      twinMatch: sapTwinMatch,
    },
    clusterChainVerified,
    clusterIdentityRegistered,
    credential: toPublicAgentCredential(agent.ownerAccount),
  };
}
