import type { Metadata } from "next";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { PublicLaunchMyFeesPage } from "@/components/public-launch/public-launch-my-fees-page";
import { readPublicLaunchesSnapshot } from "@/lib/public-launch/my-launches.server";

export const metadata: Metadata = publicSitePageMetadata({
  title: "My Launches & Fees | AgentRanking",
  description: "Review wallet-owned token launches and claim creator fees on Solana and Robinhood Chain.",
  path: "/launch/fees",
});
export const dynamic = "force-dynamic";

export default async function PublicLaunchFeesPage() {
  const initialData = await readPublicLaunchesSnapshot();
  return <PublicLaunchMyFeesPage initialData={initialData} />;
}
