import "server-only";
import { prisma } from "@/lib/db";
import { buildServiceMetadataSnapshot, type ServiceMetadataSnapshot } from "@/lib/dashboard/service-metadata";
import { discoverAgentServices, type ServiceDiscoveryResult } from "@/lib/dashboard/service-discovery";
import { getDashboardServiceAnalyticsSummary, type DashboardServiceAnalyticsSummary } from "@/lib/dashboard/service-analytics";
import { listAgentSignals } from "@/lib/signals/store";
import { getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicUrl } from "@/lib/agent-public-url";

const EDITOR_SIGNAL_TYPES = new Set(["endpoint_live", "endpoint_failing", "x402_detected"]);
const USAGE_DAYS = 30;

export type DashboardServiceSignalDto = {
  signalType: string;
  status: string;
  value: string;
  payloadJson: unknown;
  lastCheckedAt: string | null;
  expiresAt: string | null;
};

export type DashboardServiceUsageDto = {
  analytics: DashboardServiceAnalyticsSummary;
  publicProfileHref: string;
};

export type DashboardServicesWorkspaceDto = {
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
  metadata: ServiceMetadataSnapshot;
  x402Support: boolean;
  signals: DashboardServiceSignalDto[];
  publicProfileHref: string;
  discovered: ServiceDiscoveryResult;
  usage: DashboardServiceUsageDto;
};

export async function loadDashboardServicesWorkspace(
  agentDbId: number,
): Promise<DashboardServicesWorkspaceDto | null> {
  const [services, agent, metadataRows, signals, discovered] = await Promise.all([
    prisma.agentService.findMany({
      where: { agentId: agentDbId },
      orderBy: { id: "asc" },
      select: { id: true, name: true, endpoint: true, version: true },
    }),
    prisma.agent.findUnique({
      where: { id: agentDbId },
      select: { x402Support: true, chainId: true, agentId: true, name: true },
    }),
    prisma.agentMetadata.findMany({
      where: { agentId: agentDbId, key: { in: ["mcpTools", "a2aSkills", "oasfSkills"] } },
      select: { key: true, value: true },
    }),
    listAgentSignals(agentDbId),
    discoverAgentServices(agentDbId),
  ]);
  if (!agent) return null;
  const publicProfileHref = agentPublicUrl(getPublicSiteUrl(), agent);
  const [analytics] = await Promise.all([
    getDashboardServiceAnalyticsSummary(agentDbId, USAGE_DAYS, agent.x402Support),
  ]);
  return {
    services,
    metadata: buildServiceMetadataSnapshot(metadataRows),
    x402Support: agent.x402Support,
    signals: signals
      .filter((signal) => EDITOR_SIGNAL_TYPES.has(signal.signalType))
      .map((signal) => ({
        signalType: signal.signalType,
        status: signal.status,
        value: signal.value,
        payloadJson: signal.payloadJson,
        lastCheckedAt: signal.lastCheckedAt?.toISOString() ?? null,
        expiresAt: signal.expiresAt?.toISOString() ?? null,
      })),
    publicProfileHref,
    discovered,
    usage: { analytics, publicProfileHref },
  };
}

export async function loadDashboardServiceUsage(
  agentDbId: number,
): Promise<DashboardServiceUsageDto | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { x402Support: true, chainId: true, agentId: true, name: true },
  });
  if (!agent) return null;
  const analytics = await getDashboardServiceAnalyticsSummary(
    agentDbId,
    USAGE_DAYS,
    agent.x402Support,
  );
  return {
    analytics,
    publicProfileHref: agentPublicUrl(getPublicSiteUrl(), agent),
  };
}
