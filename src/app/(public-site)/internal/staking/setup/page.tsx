import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArStakingPoolSetup } from "@/components/token/ar-staking-pool-setup";
import { isArStakingSetupToolsEnabled } from "@/lib/ar-token-staking-public";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "$AR Staking Pool Setup",
  robots: { index: false, follow: false },
};
export default async function StakingPoolSetupPage() {
  const host = (await headers()).get("host");
  if (!isArStakingSetupToolsEnabled(host)) notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <ArStakingPoolSetup />
    </main>
  );
}
