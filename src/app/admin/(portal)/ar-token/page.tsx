import { AdminArTokenClient } from "./admin-ar-token-client";
import { readAdminArTokenMetrics } from "@/lib/admin/operations/ar-token.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminArTokenPage() {
  const initialMetrics = await loadAdminOperationsPage(readAdminArTokenMetrics);
  return <AdminArTokenClient initialMetrics={initialMetrics} />;
}
