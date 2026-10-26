import { DashboardNoAgentOnboarding } from "@/components/dashboard/no-agent-onboarding";
import { pickNewestOwnedAgentId } from "@/lib/dashboard/default-agent";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { defaultDashboardAgentPath } from "@/lib/dashboard/navigation";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function DashboardHomePage() {
  const { access, ownedAgents } = await requireDashboardWorkspace();
  // Existing agent → open its overview (never a "create another" picker).
  const selectedId = pickNewestOwnedAgentId(ownedAgents);
  if (selectedId != null) {
    redirect(defaultDashboardAgentPath(selectedId));
  }
  // Redirect new users to first-time onboarding
  if (access.profileId) {
    const needsOnboarding = await shouldShowOnboarding(access.profileId);
    if (needsOnboarding) {
      redirect("/onboarding");
    }
  }
  return <DashboardNoAgentOnboarding />;
}