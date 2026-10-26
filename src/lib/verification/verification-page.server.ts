import "server-only";

import type { Session } from "next-auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { canAccessDeveloperPreviewSection } from "@/lib/dashboard/developer-preview";
import { getAccountVerification } from "@/lib/verification/account-verification-service";
import {
  getKycProviderId,
  isPersonaConfigured,
  isPersonaEmbeddedAvailable,
  isVerificationDevToolsActive,
  isVerificationEnabled,
} from "@/lib/verification/config";

export type AccountVerificationPageData = {
  enabled: boolean;
  devBypassAvailable: boolean;
  cardPreviewEnabled: boolean;
  kycProvider: ReturnType<typeof getKycProviderId>;
  personaEmbeddedReady: boolean;
  verification: Awaited<ReturnType<typeof getAccountVerification>>;
};

export async function loadAccountVerificationPageData(
  session: Session | null,
): Promise<AccountVerificationPageData | null> {
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return null;

  const verification = await getAccountVerification(auth.appAccountId);

  return {
    enabled: isVerificationEnabled(),
    devBypassAvailable: isVerificationDevToolsActive(session?.user?.email),
    cardPreviewEnabled: canAccessDeveloperPreviewSection(session?.user?.email),
    kycProvider: getKycProviderId(),
    personaEmbeddedReady:
      getKycProviderId() === "persona" &&
      isPersonaConfigured() &&
      isPersonaEmbeddedAvailable(),
    verification,
  };
}
