import { AdminJobsClient } from "./admin-jobs-client";
import { readAdminJobsStatus } from "@/lib/admin/operations/jobs.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const initialData = await loadAdminOperationsPage(readAdminJobsStatus);
  return <AdminJobsClient initialData={initialData} />;
}
