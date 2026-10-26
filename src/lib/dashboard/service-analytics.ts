import { prisma } from "@/lib/db";
import {
  classifyDashboardServiceType,
  type DashboardServiceType,
} from "@/lib/dashboard/service-type";
export type ServiceUsageRow = {
  serviceId: number;
  serviceName: string;
  serviceType: DashboardServiceType;
  clicks: number;
};
export type ServiceCategoryUsageRow = {
  serviceType: DashboardServiceType;
  label: string;
  clicks: number;
};
export type DashboardServiceAnalyticsSummary = {
  totalServiceClicks: number;
  byService: ServiceUsageRow[];
  byCategory: ServiceCategoryUsageRow[];
  days: Array<{ date: string; serviceClicks: number }>;
};
export async function getDashboardServiceAnalyticsSummary(
  agentId: number,
  daysBack = 30,
  x402Detected = false,
): Promise<DashboardServiceAnalyticsSummary> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysBack);
  const [services, events, daily] = await Promise.all([
    prisma.agentService.findMany({
      where: { agentId },
      select: { id: true, name: true, endpoint: true },
    }),
    prisma.agentAnalyticsEvent.findMany({
      where: {
        agentId,
        eventType: "click_service",
        createdAt: { gte: since },
      },
      select: { serviceId: true, createdAt: true },
    }),
    prisma.agentAnalyticsDaily.findMany({
      where: { agentId, date: { gte: since } },
      orderBy: { date: "asc" },
      select: { date: true, serviceClicks: true },
    }),
  ]);
  const clicksByService = new Map<number, number>();
  let unattributed = 0;
  for (const event of events) {
    if (event.serviceId == null) {
      unattributed += 1;
      continue;
    }
    clicksByService.set(event.serviceId, (clicksByService.get(event.serviceId) ?? 0) + 1);
  }
  const byService: ServiceUsageRow[] = services
    .map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      serviceType: classifyDashboardServiceType({
        name: service.name,
        endpoint: service.endpoint,
        x402Detected,
      }),
      clicks: clicksByService.get(service.id) ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || a.serviceName.localeCompare(b.serviceName));
  const categoryMap = new Map<DashboardServiceType, number>();
  for (const row of byService) {
    categoryMap.set(row.serviceType, (categoryMap.get(row.serviceType) ?? 0) + row.clicks);
  }
  if (unattributed > 0) {
    categoryMap.set("custom", (categoryMap.get("custom") ?? 0) + unattributed);
  }
  const byCategory: ServiceCategoryUsageRow[] = Array.from(categoryMap.entries())
    .map(([serviceType, clicks]) => ({
      serviceType,
      label: serviceType.toUpperCase(),
      clicks,
    }))
    .sort((a, b) => b.clicks - a.clicks);
  return {
    totalServiceClicks:
      events.length ||
      daily.reduce((sum, row) => sum + row.serviceClicks, 0),
    byService,
    byCategory,
    days: daily.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      serviceClicks: row.serviceClicks,
    })),
  };
}
