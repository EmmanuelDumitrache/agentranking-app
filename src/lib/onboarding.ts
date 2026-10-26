import "server-only";
import { prisma } from "@/lib/db";
/**
 * Check whether a user should see the first-time onboarding wizard.
 * Returns true for new users with no agents and no completed onboarding.
 */
export async function shouldShowOnboarding(userProfileId: number): Promise<boolean> {
  const account = await prisma.appAccount.findUnique({
    where: { userProfileId },
    select: {
      id: true,
      onboardingCompletedAt: true,
      _count: { select: { agents: { where: { isActive: true } } } },
    },
  });
  if (!account) return true; // No account yet -> show onboarding
  if (account.onboardingCompletedAt) return false; // Already completed
  if (account._count.agents > 0) return false; // Has agents -> skip onboarding
  return true;
}
/**
 * Mark onboarding as completed for a user profile.
 */
export async function completeOnboarding(userProfileId: number): Promise<void> {
  await prisma.appAccount.updateMany({
    where: { userProfileId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });
}