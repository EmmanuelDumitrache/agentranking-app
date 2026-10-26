import { ArCardDashboard } from "@/components/treasury/ar-card-dashboard";
import { ArCardVerificationGate } from "@/components/treasury/ar-card-verification-gate";
import { CardPageDevTools } from "@/components/treasury/card-page-dev-tools";
import { BusinessVerificationBanner } from "@/components/verification/business-verification-banner";
import { loadTreasuryCardPageData } from "@/lib/agent-payments/treasury-card-page.server";
import { isCardDevToolsActive } from "@/lib/agent-payments/config";
import { requireDeveloperPreviewSection } from "@/lib/dashboard/page-auth";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getAccountVerification } from "@/lib/verification/account-verification-service";
import { requireTreasurySession } from "@/lib/agent-payments/auth";

export const dynamic = "force-dynamic";

export default async function TreasuryCardPage() {
  await requireDeveloperPreviewSection("card");
  const session = await getCachedDashboardSession();
  const initialData = await loadTreasuryCardPageData(session);
  const auth = await requireTreasurySession(session);
  const verification =
    auth.ok ? await getAccountVerification(auth.appAccountId) : null;
  const isVerified = verification?.isVerified ?? false;
  const showBusinessBanner =
    isVerified && verification?.level !== "BUSINESS";
  const devToolsActive = isCardDevToolsActive(session?.user?.email);

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {showBusinessBanner ? <BusinessVerificationBanner /> : null}
      {devToolsActive ? (
        <CardPageDevTools
          initialCards={
            initialData?.cards.map((card) => ({
              id: card.id,
              lastFour: card.lastFour,
              brand: card.brand,
              status: card.status,
              bin: card.bin,
              nameOnCard: card.nameOnCard,
              initialAmountUsd: card.initialAmountUsd,
              pinSet: card.pinSet,
              createdAt: card.createdAt,
            })) ?? []
          }
        />
      ) : null}
      <ArCardVerificationGate
        verification={verification}
        hasCards={(initialData?.cards.length ?? 0) > 0}
        primaryAgentDbId={initialData?.agents[0]?.id ?? null}
      >
        <ArCardDashboard
          initialData={
            initialData
              ? {
                  config: initialData.config,
                  cards: initialData.cards,
                }
              : undefined
          }
          canIssueCards={verification?.canIssueCards ?? false}
        />
      </ArCardVerificationGate>
    </div>
  );
}
