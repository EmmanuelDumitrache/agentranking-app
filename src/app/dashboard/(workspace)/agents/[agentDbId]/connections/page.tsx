import { redirect } from "next/navigation";
import { AgentMcpConnectionsPage } from "@/components/dashboard/agent-mcp-connections-page";
import { listAgentMcpBindings } from "@/features/agent-chat/server/mcp/binding-repository";
import { assertDashboardMcpAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { getDashboardMcpProviderCatalog } from "@/features/agent-chat/server/mcp/dashboard-provider-catalog";
import { parsePositiveAgentId } from "@/features/agent-chat/server/mcp/route-helpers";
import {
  toDashboardMcpBinding,
  toDashboardMcpConnection,
} from "@/features/agent-chat/server/mcp/dashboard-dto";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;
type Props = {
  params: Promise<{ agentDbId: string }>;
  searchParams: Promise<{
    mcp?: SearchValue;
    code?: SearchValue;
    connectionId?: SearchValue;
  }>;
};

function first(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function DashboardAgentConnectionsPage({ params, searchParams }: Props) {
  let id: number;
  try {
    id = parsePositiveAgentId((await params).agentDbId);
  } catch {
    redirect("/dashboard");
  }
  const { agent } = await requireDashboardAgentPage(id);
  const session = await getCachedDashboardSession();
  const access = await assertDashboardMcpAccess(session, id);
  if (!access.ok) redirect("/dashboard");
  const [items, providerCatalog, query] = await Promise.all([
    listAgentMcpBindings({ appAccountId: access.appAccountId, agentDbId: id }),
    getDashboardMcpProviderCatalog(access.appAccountId),
    searchParams,
  ]);
  const dashboardItems = items.map((item) => ({
    connection: {
      ...toDashboardMcpConnection(item.connection),
      attachedAgentCount: item.attachedAgentCount,
    },
    binding: toDashboardMcpBinding(item.binding),
    canEnable: item.canEnable,
    enableBlockedReason: item.enableBlockedReason,
    enableBlockedCode: item.enableBlockedCode,
    enabledToolCount: item.enabledToolCount,
    highestEnabledRisk: item.highestEnabledRisk,
  }));
  const rawOAuthResult = first(query.mcp);
  const oauthResult = ["connected", "error", "auth-session-required"].includes(rawOAuthResult)
    ? rawOAuthResult as "connected" | "error" | "auth-session-required"
    : null;
  const rawOAuthCode = first(query.code);
  const oauthCode = /^[A-Za-z0-9_-]{1,80}$/u.test(rawOAuthCode) ? rawOAuthCode : null;
  const rawOAuthConnectionId = first(query.connectionId);
  const oauthConnectionId = dashboardItems.some((item) => item.connection.id === rawOAuthConnectionId)
    ? rawOAuthConnectionId
    : null;

  return (
    <AgentMcpConnectionsPage
      agentDbId={id}
      agentName={agent.name}
      initialItems={dashboardItems}
      initialProviders={providerCatalog.providers}
      initialCustomConnectionsAllowed={providerCatalog.customAllowed}
      initialUrlState={{ oauthResult, oauthCode, oauthConnectionId }}
    />
  );
}
