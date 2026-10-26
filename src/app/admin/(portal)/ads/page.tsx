import { AdminAdsClient } from "./admin-ads-client";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
import { readAdminAds } from "@/lib/admin/operations/ads.server";

export const dynamic = "force-dynamic";

export default async function AdminAdsPage() {
  const { ads } = await loadAdminOperationsPage(() => readAdminAds({ activeOnly: true }));
  return <AdminAdsClient initialAds={ads} />;
}
