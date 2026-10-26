import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminPayoutsTab } from "../payouts-tab";
import { readAdminArTokenMetrics } from "@/lib/admin/operations/ar-token.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminArTokenPayoutsPage() {
  const initialMetrics = await loadAdminOperationsPage(readAdminArTokenMetrics);
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="size-5 text-primary" />
            <span className="text-sm font-medium uppercase tracking-wide">$AR</span>
          </div>
          <h1 className="text-2xl font-bold">Payout prep</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Save treasury wallets and build exportable recipient batches without leaving this focused view.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0 gap-2">
          <Link href="/admin/ar-token">
            <ArrowLeft className="size-4" />
            Back to $AR token
          </Link>
        </Button>
      </div>
      <AdminPayoutsTab initialMetrics={initialMetrics} />
    </div>
  );
}
