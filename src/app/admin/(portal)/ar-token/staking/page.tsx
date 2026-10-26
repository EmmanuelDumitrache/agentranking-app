import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminStakingTab, type StakingAdminSection } from "../staking-tab";
import {
  readAdminArTokenMetrics,
  readAdminHolderAllocations,
  readAdminStakeOverrides,
  readAdminStakePositions,
  readAdminStakeRules,
} from "@/lib/admin/operations/ar-token.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function normalizeSection(value: string | undefined): StakingAdminSection {
  return value === "positions" || value === "overrides" || value === "allocations"
    ? value
    : "rules";
}
export default async function AdminArTokenStakingPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const params = await searchParams;
  const initialSection = normalizeSection(first(params.section));
  const [metrics, rulesPayload, positionsPayload, overridesPayload, allocationsPayload] =
    await loadAdminOperationsPage(() =>
      Promise.all([
        readAdminArTokenMetrics(),
        readAdminStakeRules(),
        readAdminStakePositions({ page: 0, pageSize: 50, includePerkSummary: true }),
        readAdminStakeOverrides(),
        readAdminHolderAllocations(),
      ]),
    );
  const perks = metrics.perks ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lock className="size-5 text-primary" />
            <span className="text-sm font-medium uppercase tracking-wide">$AR</span>
          </div>
          <h1 className="text-2xl font-bold">Staking &amp; perk rules</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Manage stake thresholds, indexed positions, and per-wallet overrides on their own page. Use the tabs below to
            switch between rules, on-chain-reported positions, and overrides.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0 gap-2">
          <Link href="/admin/ar-token">
            <ArrowLeft className="size-4" />
            Back to $AR token
          </Link>
        </Button>
      </div>
      <AdminStakingTab
        perks={perks.map((perk) => ({ slug: perk.slug, title: perk.title }))}
        initialSection={initialSection}
        initialRules={rulesPayload.rules}
        initialPositions={{
          positions: positionsPayload.positions,
          total: positionsPayload.total,
          perkSummaryByWallet:
            "perkSummaryByWallet" in positionsPayload
              ? positionsPayload.perkSummaryByWallet
              : {},
        }}
        initialOverrides={overridesPayload.overrides}
        initialAllocations={allocationsPayload.allocations}
      />
    </div>
  );
}
