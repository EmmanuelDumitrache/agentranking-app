import type { Metadata } from "next";
import { Suspense } from "react";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { PublicQuickLaunchPage } from "@/components/public-launch/public-quick-launch-page";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { normalizePublicLaunchChain } from "@/lib/public-launch/initial-state";
import { readPublicQuickLaunchInitialState } from "@/lib/public-launch/initial-state.server";

export const metadata: Metadata = publicSitePageMetadata({
  title: "Launch Token | AgentRanking",
  description:
    "Wallet-only quick launchpad for Solana Pump.fun and Robinhood Chain tokens — no sign-in required.",
  path: "/launch",
});
export const dynamic = "force-dynamic";

type SearchParams = {
  chain?: string | string[];
  attempt?: string | string[];
};

type Props = {
  searchParams?: Promise<SearchParams>;
};

function first(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || null;
}

export default async function PublicLaunchPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const initialChain = normalizePublicLaunchChain(params.chain);
  const initialAttemptId = first(params.attempt);
  const initial = await readPublicQuickLaunchInitialState({
    chain: initialChain,
    attemptId: initialAttemptId,
  });
  return (
    <Suspense fallback={null}>
      <PublicQuickLaunchPage
        launchAgentHref={publicSiteRoutes.launchAgent}
        initialChain={initialChain}
        initialAttemptId={initialAttemptId}
        initialWalletSession={initial.walletSession}
        initialOpenMetaplexAttempt={initial.openMetaplexAttempt}
        initialRobinhoodLaunchFeeEth={initial.robinhoodLaunchFeeEth}
        feeDisplay={initial.feeDisplay}
      />
    </Suspense>
  );
}
