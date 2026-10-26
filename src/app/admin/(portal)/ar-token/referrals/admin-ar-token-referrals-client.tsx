"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AdminReferralsTab } from "../referrals-tab";
import type { ArTokenMetricsView } from "@/lib/ar-token-metrics";
import type { AdminCommissionDto, AdminCommissionTotalsDto } from "../commissions-tab";
import { AdminCommissionsTab } from "../commissions-tab";
type Tab = "referrals" | "commissions";
export function AdminArTokenReferralsClient({
  initialMetrics,
  initialCommissions,
}: {
  readonly initialMetrics: ArTokenMetricsView;
  readonly initialCommissions: {
    commissions: AdminCommissionDto[];
    totals: AdminCommissionTotalsDto;
  };
}) {
  const [tab, setTab] = useState<Tab>("commissions");
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Link2 className="size-5 text-primary" />
            <span className="text-sm font-medium uppercase tracking-wide">$AR</span>
          </div>
          <h1 className="text-2xl font-bold">Referrals &amp; Commissions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Review referral conversions, approve commissions, and mark payouts done after you send $AR to each wallet.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0 gap-2">
          <Link href="/admin/ar-token">
            <ArrowLeft className="size-4" />
            Back to $AR token
          </Link>
        </Button>
      </div>
      {/* Sub-tab bar */}
      <div className="flex gap-2 border-b border-border pb-0">
        {(["commissions", "referrals"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "pb-2.5 px-3 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "commissions" ? "Commissions" : "Code adjustments"}
          </button>
        ))}
      </div>
      {tab === "commissions" && <AdminCommissionsTab initialData={initialCommissions} />}
      {tab === "referrals" && <AdminReferralsTab initialMetrics={initialMetrics} />}
    </div>
  );
}
