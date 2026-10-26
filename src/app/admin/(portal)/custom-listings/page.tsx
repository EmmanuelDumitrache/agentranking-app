import { AdminCustomListingsClient } from "./admin-custom-listings-client";
import { readAdminCustomListings } from "@/lib/admin/operations/custom-listings.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminCustomListingsPage() {
  const initialData = await loadAdminOperationsPage(readAdminCustomListings);
  return <AdminCustomListingsClient initialData={initialData} />;
}
