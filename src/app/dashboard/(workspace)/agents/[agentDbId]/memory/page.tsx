import { AgentMemoryPage } from "@/components/dashboard/agent-memory-page";
import { readAgentMemoryPageData } from "@/features/agent-memory/server/repository";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = Readonly<{ params: Promise<{ agentDbId: string }> }>;

export default async function DashboardMemoryPage({ params }: Props) {
  const agentDbId = agentDbIdSchema.parse((await params).agentDbId);
  const workspace = await requireDashboardAgentPage(agentDbId);
  const appAccount = await prisma.appAccount.findUniqueOrThrow({
    where: { userProfileId: workspace.access.profileId! },
    select: { id: true },
  });
  const initialData = await readAgentMemoryPageData(
    prisma,
    agentDbId,
    appAccount.id,
  );
  return <AgentMemoryPage agentDbId={agentDbId} initialData={initialData} />;
}
