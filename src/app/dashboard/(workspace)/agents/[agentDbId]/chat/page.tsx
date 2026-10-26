import { HydrationBoundary, QueryClient, dehydrate } from "@tanstack/react-query";
import { getServerSession } from "next-auth";
import { AgentChatShell } from "@/features/agent-chat/client/AgentChatShell";
import { agentChatKeys } from "@/features/agent-chat/client/query-keys";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { loadAgentChatBootstrap } from "@/features/agent-chat/server/dashboard-bootstrap";
import { entityIdSchema } from "@/features/agent-chat/shared/schemas";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ agentDbId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AgentChatPage({ params, searchParams }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  const { agent } = await requireDashboardAgentPage(id);
  const paramsValue = await searchParams;
  const requestedRaw = typeof paramsValue.conversation === "string"
    ? paramsValue.conversation
    : null;
  const requestedConversationId = requestedRaw && entityIdSchema.safeParse(requestedRaw).success
    ? requestedRaw
    : null;
  const preferNewConversation = paramsValue.new === "1";
  const access = await getAgentChatAccess(
    await getServerSession(authOptions),
    id,
    { allowDisabled: true },
  );
  const bootstrap = await loadAgentChatBootstrap(access, {
    requestedConversationId,
    preferNewConversation,
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(agentChatKeys.models(id), bootstrap.models);
  queryClient.setQueryData(agentChatKeys.settings(id), bootstrap.settings);
  queryClient.setQueryData(agentChatKeys.conversations(id), {
    pages: [bootstrap.conversations],
    pageParams: [null],
  });
  if (bootstrap.selectedConversationId && bootstrap.selectedConversation) {
    queryClient.setQueryData(
      agentChatKeys.conversation(id, bootstrap.selectedConversationId),
      bootstrap.selectedConversation,
    );
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AgentChatShell agent={agent} />
    </HydrationBoundary>
  );
}
