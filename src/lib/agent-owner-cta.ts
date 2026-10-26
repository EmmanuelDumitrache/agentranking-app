/** True when the public page should show the verify-to-claim owner CTA. */
export function shouldShowOwnerVerifyCta(agent: {
  isPremiumVerified?: boolean;
  isVerified?: boolean;
  sapOperatorClaimed?: boolean;
}): boolean {
  return !agent.isPremiumVerified && !agent.isVerified && !agent.sapOperatorClaimed;
}