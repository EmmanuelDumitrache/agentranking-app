import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  VERIFICATION_INCLUDES,
  VERIFICATION_PANEL,
} from "@/lib/verified-page-config";
import { VerifiedPanelBadgeIcon } from "@/components/verified/verified-panel-badge-icon";
import { VerifiedPanelSummaryCta } from "@/components/verified/verified-panel-summary-cta";
export function VerifiedVerificationPanel() {
  return (
    <details className="verified-panel-disclosure">
      <summary className="verified-panel-disclosure-summary">
        <span className="verified-panel-disclosure-summary-main">
          <VerifiedPanelBadgeIcon />
          <span className="verified-panel-disclosure-leading">
            <span className="verified-panel-disclosure-title">{VERIFICATION_PANEL.title}</span>
            <span className="verified-panel-disclosure-meta">
              ${VERIFICATION_PANEL.priceUsd} {VERIFICATION_PANEL.billingLabel} ·{" "}
              {VERIFICATION_PANEL.summaryMeta}
            </span>
          </span>
        </span>
        <span className="verified-panel-disclosure-summary-actions">
          <VerifiedPanelSummaryCta />
          <ChevronDown className="verified-panel-disclosure-chevron" aria-hidden />
        </span>
      </summary>
      <div className="verified-panel-disclosure-body">
        <p className="verified-panel-description">{VERIFICATION_PANEL.shortDescription}</p>
        <ul className="verified-panel-includes-list">
          {VERIFICATION_INCLUDES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <footer className="verified-panel-disclosure-footer">
          <span className="verified-panel-process">{VERIFICATION_PANEL.processLine}</span>
          <Link href={VERIFICATION_PANEL.docsHref} className="verified-text-link">
            {VERIFICATION_PANEL.docsLabel}
          </Link>
        </footer>
      </div>
    </details>
  );
}