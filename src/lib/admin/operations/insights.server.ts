import "server-only";

import { loadAdminDashboardFunnel } from "@/lib/admin-dashboard-summary-data";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminConversionStats() {
  await requireAdminOperationsSession();
  return loadAdminDashboardFunnel(new Date());
}
