"use client";
import type { MouseEvent } from "react";
import { VERIFICATION_PANEL } from "@/lib/verified-page-config";
import { getDashboardHomeUrl } from "@/lib/site-url";
import { VerifiedCTAButton } from "@/components/verified/verified-cta-button";
function stopSummaryToggle(event: MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation();
}
export function VerifiedPanelSummaryCta() {
  return (
    <VerifiedCTAButton
      href={getDashboardHomeUrl()}
      className="verified-panel-disclosure-cta"
      onClick={stopSummaryToggle}
    >
      {VERIFICATION_PANEL.panelCtaLabel}
    </VerifiedCTAButton>
  );
}
