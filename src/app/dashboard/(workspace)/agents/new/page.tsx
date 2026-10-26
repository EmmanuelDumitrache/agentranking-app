import { redirect } from "next/navigation";
import { DashboardCreateAgentEntry } from "@/components/dashboard/create-agent-entry";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { resolveCreateAgentPageRedirect } from "@/lib/dashboard/auth-redirects";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { loadDashboardAgentCreationConfig } from "@/lib/dashboard/account-creation.server";
export const dynamic = "force-dynamic";
export default async function DashboardCreateAgentPage() {
  const { access } = await requireDashboardWorkspace();
  const onboardingRequired = access.profileId ? await shouldShowOnboarding(access.profileId) : false;
  const redirectPath = resolveCreateAgentPageRedirect({
    profileId: access.profileId,
    shouldShowOnboarding: onboardingRequired,
  });
  if (redirectPath) redirect(redirectPath);
  const creationConfig = await loadDashboardAgentCreationConfig();
  return <DashboardCreateAgentEntry creationConfig={creationConfig} />;
}
