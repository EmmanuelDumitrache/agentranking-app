import { AdminDashboardClient } from "@/lib/admin/operations/admin-dashboard-client";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
import { readAdminDashboardSummary } from "@/lib/admin/operations/dashboard.server";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const initialData = await loadAdminOperationsPage(() => readAdminDashboardSummary());
  return <AdminDashboardClient initialData={initialData} />;
}
