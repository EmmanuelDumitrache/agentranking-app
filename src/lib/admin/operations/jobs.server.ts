import "server-only";

import { getPartnerSyncMeta, getRecentPartnerJobs } from "@/lib/jobs/sync";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminJobsStatus() {
  await requireAdminOperationsSession();
  const [partners, recentJobs] = await Promise.all([
    getPartnerSyncMeta(),
    getRecentPartnerJobs(10),
  ]);
  return { partners, recentJobs };
}
