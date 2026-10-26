import { DashboardCreateAgentEntry } from "@/components/dashboard/create-agent-entry";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { loadDashboardAgentCreationConfig } from "@/lib/dashboard/account-creation.server";
export const dynamic = "force-dynamic";
export default async function DashboardImportAgentPage() {
  await requireDashboardWorkspace();
  const creationConfig = await loadDashboardAgentCreationConfig();
  return <DashboardCreateAgentEntry creationConfig={creationConfig} initialMode="import" />;
}
