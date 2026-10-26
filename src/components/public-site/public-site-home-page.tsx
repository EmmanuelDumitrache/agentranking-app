import { LandingV3Page } from "@/components/public-site/landing-v3/landing-v3-page";
import type { PublicSiteHomeData } from "@/lib/public-site/home-types";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";

type Props = {
  readonly data: PublicSiteHomeData;
  readonly initialStakeSummary: PublicStakeSummary | null;
  readonly modelCount?: number;
};

/** Public homepage — v3 trust-layer landing with live index data. */
export function PublicSiteHomePage({ data, initialStakeSummary, modelCount }: Props) {
  return (
    <LandingV3Page
      data={data}
      initialStakeSummary={initialStakeSummary}
      modelCount={modelCount}
    />
  );
}
