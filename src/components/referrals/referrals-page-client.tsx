"use client";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { ReferralsDashboard } from "@/components/referrals/referrals-dashboard";
import { StreamflowSolanaWalletRoot } from "@/components/streamflow/streamflow-solana-wallet-root";
import {
  REFERRALS_COMMISSION_ROWS,
  REFERRALS_HOW_IT_WORKS,
  REFERRALS_PAGE_SUBTITLE,
  REFERRALS_PAGE_TITLE,
  REFERRALS_VERIFICATION_HIGHLIGHT,
} from "@/lib/referrals-page-config";
export function ReferralsPageClient() {
  return (
    <StreamflowSolanaWalletRoot>
      <PublicSitePageShell className="referrals-page-shell">
        <div className="referrals-page">
          <header className="referrals-page-header">
            <h1 className="referrals-page-title">{REFERRALS_PAGE_TITLE}</h1>
            <p className="referrals-page-subtitle">{REFERRALS_PAGE_SUBTITLE}</p>
          </header>
          <details className="referrals-panel-disclosure">
            <summary className="referrals-panel-disclosure-summary">
              <span>
                <span className="referrals-panel-disclosure-title">How it works</span>
                <span className="referrals-panel-disclosure-meta">
                  Share link → attribution → commission → $AR payout
                </span>
              </span>
              <ChevronDown className="referrals-panel-disclosure-chevron" aria-hidden />
            </summary>
            <div className="referrals-panel-disclosure-body">
              <ol className="referrals-steps">
                {REFERRALS_HOW_IT_WORKS.map((step, index) => (
                  <li key={step.title} className="referrals-step">
                    <span className="referrals-step-icon-wrap">
                      <step.icon className="referrals-step-icon" aria-hidden />
                    </span>
                    <div>
                      <p className="referrals-step-title">
                        <span className="referrals-step-num">{index + 1}.</span> {step.title}
                      </p>
                      <p className="referrals-step-desc">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="referrals-highlight">
                <p className="referrals-highlight-title">{REFERRALS_VERIFICATION_HIGHLIGHT.title}</p>
                <p className="referrals-highlight-copy">{REFERRALS_VERIFICATION_HIGHLIGHT.body}</p>
                <Link href={REFERRALS_VERIFICATION_HIGHLIGHT.href} className="referrals-text-link">
                  {REFERRALS_VERIFICATION_HIGHLIGHT.cta}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              </div>
              <div className="referrals-rates">
                <p className="referrals-field-label">Commission rates</p>
                <div className="referrals-table-wrap">
                  <table className="referrals-table referrals-table--rates">
                    <thead>
                      <tr>
                        {["Product", "Price", "Rate", "You earn"].map((heading) => (
                          <th key={heading} scope="col" className="referrals-th">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {REFERRALS_COMMISSION_ROWS.map((row) => (
                        <tr key={row.product} className="referrals-row">
                          <td className="referrals-td">{row.product}</td>
                          <td className="referrals-td referrals-td--meta">{row.price}</td>
                          <td className="referrals-td referrals-td--rate">{row.rate}</td>
                          <td className="referrals-td referrals-td--earn">{row.earn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="referrals-field-hint">
                  Commissions are paid in $AR. USD values are approximate at payout. Payouts require
                  admin approval.
                </p>
              </div>
            </div>
          </details>
          <section className="referrals-hub">
            <h2 className="referrals-section-title">Your referral hub</h2>
            <ReferralsDashboard />
          </section>
        </div>
      </PublicSitePageShell>
    </StreamflowSolanaWalletRoot>
  );
}
