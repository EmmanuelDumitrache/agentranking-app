import { prisma } from "@/lib/db";
import { parseNumericAgentLaunchAgentDbId } from "@/lib/agent-launch/agent-db-id";
import { agentPublicPath } from "@/lib/agent-public-url";
export type LaunchLinkedAgentSummary = {
  readonly agentDbId: number;
  readonly chainId: number;
  readonly onChainAgentId: number;
  readonly name: string;
  readonly image: string;
  readonly publicHref: string;
  readonly isVerified: boolean;
  readonly isPremiumVerified: boolean;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus: string | null;
};
const LINKED_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  isVerified: true,
  isPremiumVerified: true,
  publicVerificationStatus: true,
  arVerificationStatus: true,
} as const;
type LinkedAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  publicVerificationStatus: string;
  arVerificationStatus: string | null;
};
export function buildLaunchLinkedAgentSummary(
  agent: LinkedAgentRow,
): LaunchLinkedAgentSummary {
  return {
    agentDbId: agent.id,
    chainId: agent.chainId,
    onChainAgentId: agent.agentId,
    name: agent.name,
    image: agent.image,
    publicHref: agentPublicPath(agent),
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    publicVerificationStatus: agent.publicVerificationStatus,
    arVerificationStatus: agent.arVerificationStatus,
  };
}
export function resolveLaunchAgentDbId(launch: {
  agentDbId: number | null;
  agentId: string | null;
}): number | null {
  if (launch.agentDbId != null) return launch.agentDbId;
  return parseNumericAgentLaunchAgentDbId(launch.agentId);
}
export async function loadLaunchLinkedAgentSummary(
  launch: {
    agentDbId: number | null;
    agentId: string | null;
  },
): Promise<LaunchLinkedAgentSummary | null> {
  const agentDbId = resolveLaunchAgentDbId(launch);
  if (!agentDbId) return null;
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: LINKED_AGENT_SELECT,
  });
  if (!agent) return null;
  return buildLaunchLinkedAgentSummary(agent);
}
export async function loadLaunchLinkedAgentSummariesByDbId(
  agentDbIds: ReadonlyArray<number>,
): Promise<Map<number, LaunchLinkedAgentSummary>> {
  const uniqueIds = [...new Set(agentDbIds.filter((id) => id > 0))];
  if (uniqueIds.length === 0) return new Map();
  const agents = await prisma.agent.findMany({
    where: { id: { in: uniqueIds } },
    select: LINKED_AGENT_SELECT,
  });
  return new Map(
    agents.map((agent) => [agent.id, buildLaunchLinkedAgentSummary(agent)]),
  );
}
