import { buildSeoMetadata } from "@/lib/seo";
import { REFERRALS_PAGE_SUBTITLE, REFERRALS_PAGE_TITLE } from "@/lib/referrals-page-config";
import { ReferralsPageClient } from "@/components/referrals/referrals-page-client";
export const metadata = buildSeoMetadata({
  path: "/token/referrals",
  title: `${REFERRALS_PAGE_TITLE} | AgentRanking`,
  description: REFERRALS_PAGE_SUBTITLE,
});
export default function TokenReferralsPage() {
  return <ReferralsPageClient />;
}
