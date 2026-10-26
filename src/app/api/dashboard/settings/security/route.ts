import { securityJsonResponse } from "@/lib/account-security/http-response";
import {
  DashboardAccountReadError,
  loadDashboardSecurityStatus,
} from "@/lib/dashboard/account-settings.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return securityJsonResponse(await loadDashboardSecurityStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof DashboardAccountReadError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load security status";
    return securityJsonResponse({ error: message }, { status });
  }
}
