"use client";
import { PartnerLogo } from "@/components/jobs/partner-logo";
export function JobsPartnerStrip() {
  return (
    <div className="jobs-partner-strip">
      <span className="jobs-partner-strip-label">Listings from</span>
      <PartnerLogo source="earnfi" variant="wordmark" size="md" priority />
      <span className="jobs-partner-strip-divider" aria-hidden />
      <PartnerLogo source="wurk" variant="icon" size="sm" showName />
    </div>
  );
}