import "server-only";
import { getAdminSecurityDisplayHints } from "@/lib/admin-auth";
import { loadAdminCreatorMetrics } from "@/lib/admin-creators-data";
import {
  loadAdminDashboardCounts,
  loadAdminDashboardFunnel,
} from "@/lib/admin-dashboard-summary-data";
import { requireAdminOperationsSession } from "./auth.server";
import type { AdminDashboardSummary } from "./admin-dashboard-client";
export type AdminDashboardNotificationDto = {
  id: string;
  title: string;
  count: number;
  href: string;
};
function buildNotifications(
  pendingOrders: number,
  openInquiries: number,
  openReports: number,
): AdminDashboardNotificationDto[] {
  const notifications: AdminDashboardNotificationDto[] = [];
  if (pendingOrders > 0) {
    notifications.push({
      id: "orders-pending",
      title: "Pending orders",
      count: pendingOrders,
      href: "/admin/orders?status=pending",
    });
  }
  if (openInquiries > 0) {
    notifications.push({
      id: "support-open",
      title: "Open support tickets",
      count: openInquiries,
      href: "/admin/contact",
    });
  }
  if (openReports > 0) {
    notifications.push({
      id: "agent-reports-open",
      title: "Open agent reports",
      count: openReports,
      href: "/admin/agent-reports",
    });
  }
  return notifications;
}
type FunnelCounts = AdminDashboardSummary["funnel"]["last7d"];
function normalizeFunnelCounts(values: Record<string, number>): FunnelCounts {
  return {
    page_view_advertise: values.page_view_advertise ?? 0,
    page_view_boost: values.page_view_boost ?? 0,
    page_view_verify: values.page_view_verify ?? 0,
    order_created: values.order_created ?? 0,
  };
}
function emptyFunnel(): AdminDashboardSummary["funnel"] {
  return {
    last7d: {
      page_view_advertise: 0,
      page_view_boost: 0,
      page_view_verify: 0,
      order_created: 0,
    },
    last30d: {
      page_view_advertise: 0,
      page_view_boost: 0,
      page_view_verify: 0,
      order_created: 0,
    },
    loading: true,
  };
}
export async function readAdminDashboardSummary(
  options?: { readonly quick?: boolean },
): Promise<AdminDashboardSummary> {
  const session = await requireAdminOperationsSession();
  const now = new Date();
  const funnelPromise = options?.quick
    ? Promise.resolve(emptyFunnel())
    : loadAdminDashboardFunnel(now);
  const [
    [
      pendingOrders,
      paidOrders,
      activeDirectAds,
      activeCheckoutAds,
      totalUsers,
      openInquiries,
      openReports,
    ],
    creatorMetrics,
    funnel,
  ] = await Promise.all([
    loadAdminDashboardCounts(now),
    loadAdminCreatorMetrics(now),
    funnelPromise,
  ]);
  return {
    generatedAtMs: now.getTime(),
    session: {
      username: session.username,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastAccessIp: session.lastAccessIp ?? null,
      lastAccessAt: session.lastAccessAt ?? null,
    },
    security: getAdminSecurityDisplayHints(),
    notifications: buildNotifications(pendingOrders, openInquiries, openReports),
    counts: {
      pendingOrders,
      paidOrders,
      activeAds: activeDirectAds + activeCheckoutAds,
      totalUsers,
    },
    creators: creatorMetrics,
    funnel: {
      last7d: normalizeFunnelCounts(funnel.last7d),
      last30d: normalizeFunnelCounts(funnel.last30d),
      ...("loading" in funnel && funnel.loading === true ? { loading: true } : {}),
    },
  };
}