import "server-only";
import { prisma } from "@/lib/db";
import { formatAnalyticsEventLabel } from "@/lib/dashboard/analytics-events";
import type {
  PortfolioActivityItem,
  PortfolioActivityItemDto,
} from "@/lib/dashboard/portfolio-activity-shared";
export type {
  AgentActivityStats,
  PortfolioActivityCategory,
  PortfolioActivityItem,
  PortfolioActivityItemDto,
} from "@/lib/dashboard/portfolio-activity-shared";
export {
  groupActivityByDay,
  summarizeActivityByAgent,
} from "@/lib/dashboard/portfolio-activity-shared";
const SIGNAL_LABELS: Record<string, string> = {
  endpoint_live: "Endpoint health check passed",
  endpoint_failing: "Endpoint health check failed",
  x402_detected: "x402 readiness detected",
  x402_payable: "x402 payable signal updated",
  devproof_active: "DevProof signal active",
  repo_connected: "GitHub repo connected",
  github_verified: "GitHub verified",
  official_links_locked: "Official links locked",
};
export type GetDashboardPortfolioActivityOptions = {
  agentIds: number[];
  agentNames: Map<number, string>;
  limit?: number;
  filterAgentId?: number | null;
  sinceDays?: number;
};
function agentNameFor(agentNames: Map<number, string>, agentId: number): string {
  return agentNames.get(agentId) ?? `Agent #${agentId}`;
}
export async function getDashboardPortfolioActivity(
  options: GetDashboardPortfolioActivityOptions,
): Promise<PortfolioActivityItem[]> {
  const {
    agentIds,
    agentNames,
    limit = 50,
    filterAgentId = null,
    sinceDays = 30,
  } = options;
  const scopedIds =
    filterAgentId != null && Number.isFinite(filterAgentId)
      ? agentIds.filter((id) => id === filterAgentId)
      : agentIds;
  if (scopedIds.length === 0) return [];
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const [analyticsEvents, signals, githubSnapshots, paidOrders] = await Promise.all([
      prisma.agentAnalyticsEvent.findMany({
        where: { agentId: { in: scopedIds }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit * 2, 80),
        select: { id: true, agentId: true, eventType: true, createdAt: true },
      }),
      prisma.agentVerificationSignal.findMany({
        where: {
          agentId: { in: scopedIds },
          OR: [
            { lastCheckedAt: { gte: since } },
            { verifiedAt: { gte: since } },
            { updatedAt: { gte: since } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: Math.min(limit * 2, 80),
        select: {
          id: true,
          agentId: true,
          signalType: true,
          lastCheckedAt: true,
          verifiedAt: true,
          updatedAt: true,
        },
      }),
      prisma.agentGithubSnapshot.findMany({
        where: { agentId: { in: scopedIds }, capturedAt: { gte: since } },
        orderBy: { capturedAt: "desc" },
        take: Math.min(limit, 40),
        select: { id: true, agentId: true, capturedAt: true },
      }),
      prisma.order.findMany({
        where: {
          agentId: { in: scopedIds },
          status: "paid",
          paidAt: { gte: since },
          productType: { in: ["kya_verify", "verification_bundle"] },
        },
        orderBy: { paidAt: "desc" },
        take: 20,
        select: { id: true, agentId: true, paidAt: true, productType: true },
      }),
    ]);
    const items: PortfolioActivityItem[] = [];
    for (const event of analyticsEvents) {
      items.push({
        id: `analytics-${event.id}`,
        agentId: event.agentId,
        agentName: agentNameFor(agentNames, event.agentId),
        label: formatAnalyticsEventLabel(event.eventType),
        category: "analytics",
        at: event.createdAt,
      });
    }
    for (const signal of signals) {
      const at = signal.lastCheckedAt ?? signal.verifiedAt ?? signal.updatedAt;
      if (!at || at < since) continue;
      items.push({
        id: `signal-${signal.id}-${at.getTime()}`,
        agentId: signal.agentId,
        agentName: agentNameFor(agentNames, signal.agentId),
        label: SIGNAL_LABELS[signal.signalType] ?? `Signal updated: ${signal.signalType}`,
        category: "signal",
        at,
      });
    }
    for (const snapshot of githubSnapshots) {
      items.push({
        id: `github-${snapshot.id}`,
        agentId: snapshot.agentId,
        agentName: agentNameFor(agentNames, snapshot.agentId),
        label: "GitHub DevProof synced",
        category: "github",
        at: snapshot.capturedAt,
      });
    }
    for (const order of paidOrders) {
      if (!order.paidAt || order.agentId == null) continue;
      items.push({
        id: `order-${order.id}`,
        agentId: order.agentId,
        agentName: agentNameFor(agentNames, order.agentId),
        label:
          order.productType === "verification_bundle"
            ? "Verification bundle completed"
            : "Agent verification completed",
        category: "verification",
        at: order.paidAt,
      });
    }
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    const seen = new Set<string>();
    const deduped: PortfolioActivityItem[] = [];
    for (const item of items) {
      const key = `${item.agentId}:${item.label}:${item.at.toISOString().slice(0, 16)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= limit) break;
    }
  return deduped;
}
export async function loadDashboardAgentActivityDto(
  agentId: number,
  agentName: string,
  limit = 30,
): Promise<PortfolioActivityItemDto[]> {
  const items = await getDashboardPortfolioActivity({
    agentIds: [agentId],
    agentNames: new Map([[agentId, agentName]]),
    limit,
    filterAgentId: agentId,
  });
  return items.map((item) => ({ ...item, at: item.at.toISOString() }));
}
