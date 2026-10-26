"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DashboardReferralStatsDto } from "@/lib/referral-dashboard";
export function DashboardReferralsPanel({
  initialStats,
}: {
  readonly initialStats: DashboardReferralStatsDto;
}) {
  return (
    <div className="ui-page-stack ui-page-stack--narrow">
      <div className="ui-panel ui-panel--stack space-y-4">
        <div className="space-y-1">
          <h1 className="ui-page-title">Referrals</h1>
          <p className="ui-page-subtitle">
            Your referral code and qualified activity from the authenticated workspace owner.
          </p>
        </div>
        {initialStats.code ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Referral code</Label>
              <Input readOnly value={initialStats.code} />
            </div>
            {initialStats.referralLink ? (
              <div className="space-y-2">
                <Label>Referral link</Label>
                <Input readOnly value={initialStats.referralLink} />
              </div>
            ) : null}
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">Qualified referrals</p>
                <p className="mt-1 font-semibold tabular-nums">{initialStats.totalReferrals}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">Approved and paid</p>
                <p className="mt-1 font-semibold tabular-nums">
                  ${initialStats.totalEarningsUsd.toFixed(2)}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Pending ${initialStats.pendingEarningsUsd.toFixed(2)} · Approved ${initialStats.approvedEarningsUsd.toFixed(2)} · Paid ${initialStats.paidEarningsUsd.toFixed(2)}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {initialStats.walletLinked
              ? "No active referral code exists for this workspace yet."
              : "Link a wallet in Settings to view or set your AR referral code."}
          </p>
        )}
        <Button asChild variant="secondary" size="sm">
          <Link href="/token/referrals">Referral details</Link>
        </Button>
      </div>
    </div>
  );
}
