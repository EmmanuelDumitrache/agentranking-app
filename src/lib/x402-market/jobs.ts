import { enqueueApplicationJob } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export async function enqueueX402DirectoryRefresh(): Promise<string | null> {
  return enqueueApplicationJob(JOB_QUEUES.PARTNER_X402_DIRECTORY_REFRESH, { v: 1 }, { singletonKey: "directory" });
}
