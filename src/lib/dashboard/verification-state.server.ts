import "server-only";
import { getVerificationState } from "@/lib/agent-verification/verify-agent";
import type { DashboardVerificationStateDto } from "@/lib/dashboard/verification-state";
export async function loadDashboardVerificationState(
  agentDbId: number,
): Promise<DashboardVerificationStateDto | null> {
  const state = await getVerificationState(agentDbId);
  if (!state) return null;
  return {
    ...state,
    eligibilityChecks: state.eligibilityChecks.map((check) => ({
      label: check.label,
      passed: check.passed,
    })),
    token: state.token
      ? {
          launchId: state.token.launchId,
          tokenName: state.token.tokenName,
          tokenSymbol: state.token.tokenSymbol,
          mint: state.token.mint,
          launchStatus: state.token.launchStatus,
          verificationStatus: state.token.verificationStatus,
          verifiedAt: state.token.verifiedAt,
          verificationSource: state.token.verificationSource,
        }
      : null,
  };
}
