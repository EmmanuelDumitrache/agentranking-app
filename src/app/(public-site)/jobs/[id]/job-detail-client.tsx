"use client";
import { useEffect } from "react";
import type { PublicPartnerJob } from "@/lib/jobs/types";
import { JobDetailView } from "@/components/jobs/job-detail-view";
import { trackJobEvent } from "@/lib/jobs/track-client";
type Props = {
  readonly job: PublicPartnerJob;
  readonly matchedAgents: Parameters<typeof JobDetailView>[0]["matchedAgents"];
};
export function JobDetailClient({ job, matchedAgents }: Props) {
  useEffect(() => {
    void trackJobEvent({ eventType: "job_viewed", jobId: job.id, source: job.source });
  }, [job.id, job.source]);
  return (
    <JobDetailView
      job={job}
      matchedAgents={matchedAgents}
      onPartnerOpen={() => {
        void trackJobEvent({
          eventType: "partner_job_opened",
          jobId: job.id,
          source: job.source,
        });
      }}
    />
  );
}
