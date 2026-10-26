import { dashboardAbsoluteUrl, getDashboardHomeUrl } from "@/lib/site-url";
/** Creator dashboard home (sign-in when logged out). */
export function dashboardHomeUrl(): string {
  return getDashboardHomeUrl();
}
/** Claim / verify flow for an indexed agent profile path (e.g. `/agents/8453/123/my-agent`). */
export function dashboardClaimAgentUrl(agentPath: string): string {
  return dashboardAbsoluteUrl(`/dashboard?claimAgent=${encodeURIComponent(agentPath)}`);
}
/** Agents workspace in the creator dashboard. */
export function dashboardAgentsUrl(): string {
  return dashboardAbsoluteUrl("/dashboard");
}
/** Single agent management surface in the creator dashboard. */
export function dashboardAgentUrl(agentDbId: number): string {
  return dashboardAbsoluteUrl(`/dashboard/agents/${agentDbId}`);
}
/** MCP capability editor in the creator dashboard. */
export function dashboardMcpListingsUrl(agentDbId: number): string {
  return dashboardAbsoluteUrl(`/dashboard/agents/${agentDbId}/services`);
}
/** SAP claim entry on the creator dashboard. */
export function dashboardSapClaimUrl(): string {
  return dashboardAbsoluteUrl("/dashboard?claim=sap");
}
