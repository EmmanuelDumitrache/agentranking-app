import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
import { FEE_ALLOCATION_FLYWHEEL, REWARDS_DISCLAIMER } from "@/lib/token-economy-copy";
export const arTokenPage: DocsPageSpec = {
  slug: "ar-token",
  pageTitle: "$AR",
  subtitle: "The AgentRanking ecosystem token on Solana and its role in the platform flywheel.",
  blocks: [
    b.arTokenPanel(),
    b.h2("Flywheel role", "flywheel-role", [
      b.p(FEE_ALLOCATION_FLYWHEEL),
      b.ul([
        "$AR is used across staking, ecosystem visibility, referrals, and future product surfaces.",
        "Platform revenue mechanics are ecosystem policy, not a promise of returns.",
        "Staking is handled separately through Streamflow.",
      ]),
    ]),
    b.h2("Supply lock", "supply-lock", [
      b.p(
        "6% of supply is locked through Streamflow until mid 2027. Use Streamflow as the verification source for lock status and unlock timing.",
      ),
    ]),
    b.callout("warning", "Risk disclosure", REWARDS_DISCLAIMER),
  ],
};
