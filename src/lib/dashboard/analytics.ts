import { prisma } from "@/lib/db";
export type DashboardAnalyticsSummary = {
  profileViews: number;
  linkClicks: number;
  serviceClicks: number;
  x402Clicks: number;
  paidServiceViews: number;
  paidServiceClicks: number;
  searchImpressions: number;
  engagementClicks: number;
  serviceConversionRate: number;
  x402ConversionRate: number;
  engagementRate: number;
  days: Array<{
    date: string;
    profileViews: number;
    linkClicks: number;
    serviceClicks: number;
    x402Clicks: number;
    paidServiceViews: number;
    paidServiceClicks: number;
    searchImpressions: number;
  }>;
  serviceBreakdown: Array<{
    serviceId: number;
    serviceName: string;
    endpoint: string;
    clicks: number;
  }>;
};
type AnalyticsRollupField =
  | "profileViews"
  | "searchImpressions"
  | "linkClicks"
  | "serviceClicks"
  | "x402Clicks"
  | "paidServiceViews"
  | "paidServiceClicks";
const EVENT_FIELD_MAP: Record<string, AnalyticsRollupField> = {
  view: "profileViews",
  search_impression: "searchImpressions",
  click_endpoint: "linkClicks",
  click_service: "serviceClicks",
  click_x402: "x402Clicks",
  paid_service_view: "paidServiceViews",
  paid_service_click: "paidServiceClicks",
};
function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
export async function getDashboardAnalyticsSummary(
  agentId: number,
  daysBack = 30,
): Promise<DashboardAnalyticsSummary> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysBack);
  const [daily, rawEvents, serviceClicksById, services] = await Promise.all([
    prisma.agentAnalyticsDaily.findMany({
      where: { agentId, date: { gte: since } },
      orderBy: { date: "asc" },
    }),
    prisma.agentAnalyticsEvent.groupBy({
      by: ["eventType"],
      where: { agentId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.agentAnalyticsEvent.groupBy({
      by: ["serviceId"],
      where: {
        agentId,
        eventType: "click_service",
        serviceId: { not: null },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.agentService.findMany({
      where: { agentId },
      select: { id: true, name: true, endpoint: true },
    }),
  ]);
  const countFor = (type: string) =>
    rawEvents.find((e) => e.eventType === type)?._count._all ?? 0;
  const profileViews =
    daily.reduce((s, d) => s + d.profileViews, 0) || countFor("view");
  const linkClicks = daily.reduce((s, d) => s + d.linkClicks, 0) || countFor("click_endpoint");
  const serviceClicks =
    daily.reduce((s, d) => s + d.serviceClicks, 0) || countFor("click_service");
  const x402Clicks = daily.reduce((s, d) => s + d.x402Clicks, 0) || countFor("click_x402");
  const paidServiceViews =
    daily.reduce((s, d) => s + d.paidServiceViews, 0) || countFor("paid_service_view");
  const paidServiceClicks =
    daily.reduce((s, d) => s + d.paidServiceClicks, 0) || countFor("paid_service_click");
  const searchImpressions =
    daily.reduce((s, d) => s + d.searchImpressions, 0) || countFor("search_impression");
  const engagementClicks = linkClicks + serviceClicks + x402Clicks + paidServiceClicks;
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const serviceBreakdown = serviceClicksById
    .map((row) => {
      const serviceId = row.serviceId;
      if (serviceId == null) return null;
      const service = serviceById.get(serviceId);
      return {
        serviceId,
        serviceName: service?.name ?? `Service ${serviceId}`,
        endpoint: service?.endpoint ?? "",
        clicks: row._count._all,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.clicks - a.clicks);
  return {
    profileViews,
    linkClicks,
    serviceClicks,
    x402Clicks,
    paidServiceViews,
    paidServiceClicks,
    searchImpressions,
    engagementClicks,
    serviceConversionRate: pct(serviceClicks + paidServiceClicks, profileViews),
    x402ConversionRate: pct(x402Clicks, profileViews),
    engagementRate: pct(engagementClicks, profileViews),
    days: daily.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      profileViews: d.profileViews,
      linkClicks: d.linkClicks,
      serviceClicks: d.serviceClicks,
      x402Clicks: d.x402Clicks,
      paidServiceViews: d.paidServiceViews,
      paidServiceClicks: d.paidServiceClicks,
      searchImpressions: d.searchImpressions,
    })),
    serviceBreakdown,
  };
}
export async function recordDashboardAnalyticsEvent(
  agentId: number,
  eventType: string,
  serviceId?: number | null,
): Promise<void> {
  await prisma.agentAnalyticsEvent.create({
    data: {
      agentId,
      eventType,
      ...(serviceId != null ? { serviceId } : {}),
    },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const field = EVENT_FIELD_MAP[eventType];
  if (!field) return;
  await prisma.agentAnalyticsDaily.upsert({
    where: { agentId_date: { agentId, date: today } },
    create: { agentId, date: today, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
}
