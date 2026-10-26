import { redirect } from "next/navigation";
import { DashboardOnboardingWizard } from "@/components/dashboard/onboarding-wizard";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { shouldShowOnboarding } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create Agent — AgentRanking",
  description: "Set up your first AI agent on AgentRanking.",
};
export default async function OnboardingPage() {
  const { access, ownedAgents } = await requireDashboardWorkspace();
  // Already have an agent → dashboard overview (auto-selects it).
  if (ownedAgents.length > 0) {
    redirect("/dashboard");
  }
  if (access.profileId) {
    const needsOnboarding = await shouldShowOnboarding(access.profileId);
    if (!needsOnboarding) {
      redirect("/dashboard");
    }
  }
  return <DashboardOnboardingWizard />;
}
