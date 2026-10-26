import { redirect } from "next/navigation";
import { McpConnectionsPage } from "@/components/dashboard/mcp-connections-page";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { toDashboardMcpConnection } from "@/features/agent-chat/server/mcp/dashboard-dto";
import { getDashboardMcpProviderCatalog } from "@/features/agent-chat/server/mcp/dashboard-provider-catalog";
import { listMcpConnections } from "@/features/agent-chat/server/mcp/repository";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;
type Props = {
  searchParams: Promise<{
    agentId?: SearchValue;
    mcp?: SearchValue;
    code?: SearchValue;
    connectionId?: SearchValue;
    focus?: SearchValue;
  }>;
};

function first(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function DashboardConnectionsPage({ searchParams }: Props) {
  const query = await searchParams;
  const { ownedAgents } = await requireDashboardWorkspace();
  const rawAgentId = first(query.agentId);
  const requestedAgentId = /^[1-9]\d*$/u.test(rawAgentId) ? Number(rawAgentId) : Number.NaN;
  const contextAgent = ownedAgents.find((agent) => agent.id === requestedAgentId) ?? null;
  const session = await getCachedDashboardSession();
  const access = await assertDashboardMcpAccountAccess(session);
  if (!access.ok) redirect("/dashboard");
  const [connections, providerCatalog] = await Promise.all([
    listMcpConnections({ appAccountId: access.appAccountId }),
    getDashboardMcpProviderCatalog(access.appAccountId),
  ]);
  const dashboardConnections = connections.map(toDashboardMcpConnection);
  const rawOAuthResult = first(query.mcp);
  const oauthResult = ["connected", "error", "auth-session-required"].includes(rawOAuthResult)
    ? rawOAuthResult as "connected" | "error" | "auth-session-required"
    : null;
  const rawOAuthCode = first(query.code);
  const oauthCode = /^[A-Za-z0-9_-]{1,80}$/u.test(rawOAuthCode) ? rawOAuthCode : null;
  const rawOAuthConnectionId = first(query.connectionId);
  const oauthConnectionId = dashboardConnections.some((connection) => connection.id === rawOAuthConnectionId)
    ? rawOAuthConnectionId
    : null;
  const rawFocusConnectionId = first(query.focus);
  const focusConnectionId = dashboardConnections.some((connection) => connection.id === rawFocusConnectionId)
    ? rawFocusConnectionId
    : null;
  return (
    <McpConnectionsPage
      initialConnections={dashboardConnections}
      initialProviders={providerCatalog.providers}
      initialCustomConnectionsAllowed={providerCatalog.customAllowed}
      availableAgents={ownedAgents.map((agent) => ({ id: agent.id, name: agent.name }))}
      contextAgentId={contextAgent?.id ?? null}
      initialUrlState={{
        oauthResult,
        oauthCode,
        oauthConnectionId,
        focusConnectionId,
      }}
    />
  );
}
