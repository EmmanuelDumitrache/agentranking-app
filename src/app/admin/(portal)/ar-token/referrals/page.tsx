import { AdminArTokenReferralsClient } from "./admin-ar-token-referrals-client";
import {
  readAdminArTokenMetrics,
  readAdminReferralCommissions,
} from "@/lib/admin/operations/ar-token.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminArTokenReferralsPage() {
  const [initialMetrics, initialCommissions] = await loadAdminOperationsPage(() =>
    Promise.all([
      readAdminArTokenMetrics(),
      readAdminReferralCommissions("all"),
    ]),
  );
  return (
    <AdminArTokenReferralsClient
      initialMetrics={initialMetrics}
      initialCommissions={initialCommissions}
    />
  );
}
