import { redirect } from "next/navigation";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";

export const dynamic = "force-dynamic";

type Props = Readonly<{ params: Promise<{ agentDbId: string }> }>;

/** Legacy path before Schedule moved under Agent nav. */
export default async function LegacyTradeScheduleRedirect({ params }: Props) {
  const agentDbId = agentDbIdSchema.parse((await params).agentDbId);
  redirect(`/dashboard/agents/${agentDbId}/schedule`);
}
