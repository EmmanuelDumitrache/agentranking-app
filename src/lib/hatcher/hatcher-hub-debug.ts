/**
 * Hub loader diagnostics — safe for scripts (no server-only).
 * Mirrors stats logic in hatcher-dashboard.ts.
 */
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { hatcherAgentListingWhere } from "@/lib/hatcher/detect";
import { buildHatcherDetail, parseHatcherMetadata } from "@/lib/hatcher/snapshot";
import { isHatcherActiveStatus, isHatcherSleepingStatus } from "@/lib/hatcher/hatcher-status";
export type HatcherHubAgentDebugRow = {
  id: number;
  name: string;
  slug: string;
  profilePath: string;
  isActive: boolean;
  listingRegistrySource: string | null;
  chainId: number;
  excludeReason: string | null;
  status: string | null;
  messageCount: number;
  hasPassport: boolean;
  hasMcp: boolean;
};
export type HatcherHubLoaderSimulation = {
  hubWhereCount: number;
  agentRowsLoaded: number;
  totalMessages: number;
  activeCount: number;
  sleepingCount: number;
  passportCount: number;
  mcpCount: number;
  wouldHubShowZero: boolean;
  agents: HatcherHubAgentDebugRow[];
};
export function simulateHatcherHubFromAgents(
  agents: Array<{
    id: number;
    chainId: number;
    agentId: number;
    name: string;
    isActive: boolean;
    listingRegistrySource: string | null;
    metadata: Array<{ key: string; value: string }>;
  }>,
  hubWhereCount: number,
): HatcherHubLoaderSimulation {
  const hubWhere = hatcherAgentListingWhere();
  let totalMessages = 0;
  let activeCount = 0;
  let sleepingCount = 0;
  let passportCount = 0;
  let mcpCount = 0;
  const debugAgents: HatcherHubAgentDebugRow[] = agents.map((agent) => {
    let excludeReason: string | null = null;
    if (!agent.isActive) {
      excludeReason = "isActive=false (excluded from hatcherAgentListingWhere)";
    }
    const parsed = parseHatcherMetadata(agent.metadata);
    const detail = buildHatcherDetail(
      { chainId: agent.chainId, listingRegistrySource: agent.listingRegistrySource },
      agent.metadata,
    );
    const snap = detail.hatcher;
    const status = snap?.status ?? null;
    if (!parsed && !excludeReason) {
      excludeReason = "missing or invalid hatcher metadata JSON";
    }
    const messages = snap?.messageCount ?? 0;
    totalMessages += messages;
    if (isHatcherActiveStatus(status)) activeCount += 1;
    else if (isHatcherSleepingStatus(status)) sleepingCount += 1;
    const passportSnap = snap?.passportSnapshot;
    const mcpSnap = snap?.mcpManifestSnapshot;
    const hasPassport = passportSnap != null && typeof passportSnap === "object";
    const hasMcp = mcpSnap != null && typeof mcpSnap === "object";
    if (hasPassport) passportCount += 1;
    if (hasMcp) mcpCount += 1;
    return {
      id: agent.id,
      name: agent.name,
      slug: toAgentUrlSlug(agent.name),
      profilePath: agentPublicPath(agent),
      isActive: agent.isActive,
      listingRegistrySource: agent.listingRegistrySource,
      chainId: agent.chainId,
      excludeReason,
      status,
      messageCount: messages,
      hasPassport,
      hasMcp,
    };
  });
  void hubWhere;
  return {
    hubWhereCount,
    agentRowsLoaded: agents.filter((a) => a.isActive).length,
    totalMessages,
    activeCount,
    sleepingCount,
    passportCount,
    mcpCount,
    wouldHubShowZero: hubWhereCount === 0,
    agents: debugAgents,
  };
}
