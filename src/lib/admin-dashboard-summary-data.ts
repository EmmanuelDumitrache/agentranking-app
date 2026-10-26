import { prisma } from "@/lib/db";
export type FunnelRow = { eventType: string; _count: { id: number } };
export function toFunnelObj(rows: FunnelRow[]) {
  const obj: Record<string, number> = {
    page_view_advertise: 0,
    page_view_boost: 0,
    page_view_verify: 0,
    order_created: 0,
  };
  for (const r of rows) {
    if (r.eventType in obj) obj[r.eventType] = r._count.id;
  }
  return obj;
}
async function conversionFunnelSince(since: Date): Promise<FunnelRow[]> {
  const rows = await prisma.conversionEvent.groupBy({
    by: ["eventType"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
  });
  return rows.map((row) => ({
    eventType: row.eventType,
    _count: { id: row._count.id },
  }));
}
export async function loadAdminDashboardCounts(now: Date) {
  return Promise.all([
    prisma.order.count({ where: { status: "pending" } }),
    prisma.order.count({ where: { status: "paid" } }),
    prisma.adOrder.count({ where: { expiresAt: { gt: now } } }),
    prisma.adPackage.count({
      where: { expiresAt: { gt: now }, order: { status: "paid" } },
    }),
    prisma.userProfile.count(),
    prisma.contactInquiry.count({ where: { status: "open" } }),
    prisma.agentReport.count({ where: { status: "open" } }),
  ]);
}
export async function loadAdminDashboardFunnel(now: Date) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [last7d, last30d] = await Promise.all([
    conversionFunnelSince(sevenDaysAgo),
    conversionFunnelSince(thirtyDaysAgo),
  ]);
  const funnel7 = toFunnelObj(last7d);
  const funnel30 = toFunnelObj(last30d);
  return {
    last7d: funnel7,
    last30d: funnel30,
  };
}
