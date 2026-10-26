import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, FileText, Link2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
const ASSESSMENTS = [
  {
    title: "Identity & Control",
    detail: "Wallet ownership, operator identity, KYB, authority mapping",
  },
  {
    title: "On-Chain Provenance",
    detail: "PDA registration, token linkage, treasury analysis, credential",
  },
  {
    title: "Operational Assurance",
    detail: "Endpoints, infrastructure, continuous monitoring, revocation",
  },
] as const;
const DELIVERABLES = [
  {
    icon: FileText,
    title: "Verification Report",
    detail: "Investor-ready public report and PDF",
  },
  {
    icon: Shield,
    title: "On-Chain Credential",
    detail: "Portable proof linked to the agent",
  },
  {
    icon: Link2,
    title: "API & Partner Badge",
    detail: "Live status for platforms and apps",
  },
] as const;
const DOSSIER_ROWS = [
  { label: "Ownership & Control", status: "Verified" },
  { label: "Operator / Organisation", status: "KYB Verified" },
  { label: "On-Chain Provenance", status: "Confirmed" },
  { label: "Operational Review", status: "Monitored" },
  { label: "Credential Status", status: "Active" },
] as const;
export function VerificationDossierCard({ className }: { readonly className?: string }) {
  return (
    <aside
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-[var(--console-panel)]",
        className,
      )}
    >
      <div className="border-b border-border/50 px-4 py-3.5 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Image
                src="/ar-mark.png"
                alt=""
                width={16}
                height={16}
                className="h-4 w-4 object-contain opacity-90"
              />
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Agent Verification Dossier
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold tracking-tight text-foreground">
              Institutional Assurance
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Active
          </span>
        </div>
      </div>
      <div className="divide-y divide-border/40 px-4 sm:px-5">
        {DOSSIER_ROWS.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-[12px] text-muted-foreground">{row.label}</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400">
              <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
              {row.status}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-px border-y border-border/50 bg-border/40">
        <div className="bg-[var(--console-panel)] px-4 py-3 sm:px-5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            AR Trust Score
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
            82 <span className="text-sm font-medium text-muted-foreground">/ 100</span>
          </p>
        </div>
        <div className="bg-[var(--console-panel)] px-4 py-3 sm:px-5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Credential
          </p>
          <p className="mt-1 font-mono text-[12px] font-medium tracking-tight text-foreground/90">
            ARV-2026-00184
          </p>
        </div>
      </div>
      <dl className="space-y-1.5 px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
        <div className="flex justify-between gap-3">
          <dt>Issued</dt>
          <dd className="tabular-nums text-foreground/75">18 Jul 2026</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Last monitored</dt>
          <dd className="tabular-nums text-foreground/75">4 minutes ago</dd>
        </div>
      </dl>
      <div className="border-t border-border/50 px-4 py-3 sm:px-5">
        <Link
          href="/verified"
          className="cx-btn cx-btn-secondary cx-btn-sm inline-flex w-full items-center justify-center gap-1.5"
        >
          Open Verification Report
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
/** Compact assess + deliver panel — site-native chrome, no accent color cast. */
export function VerificationScopePanel({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-[var(--console-panel)]",
        className,
      )}
    >
      <div className="border-b border-border/50 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Assessment scope
        </p>
        <ul className="mt-3 space-y-2.5">
          {ASSESSMENTS.map((row) => (
            <li key={row.title}>
              <p className="text-[13px] font-semibold tracking-tight text-foreground">{row.title}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{row.detail}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Deliverables
        </p>
        <ul className="mt-3 space-y-2.5">
          {DELIVERABLES.map((row) => {
            const Icon = row.icon;
            return (
              <li key={row.title} className="flex gap-2.5">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/45" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-tight text-foreground">
                    {row.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{row.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
/** Homepage institutional verification — due diligence infrastructure. */
export function VerificationLayerSection() {
  return (
    <section
      id="verification"
      className="scroll-mt-24 border-t border-border/50 py-10 sm:py-12"
      aria-labelledby="verification-layer-title"
    >
      <div className="cx-page-stack">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start lg:gap-6 xl:gap-8">
          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Institutional Agent Verification
              </p>
              <h2
                id="verification-layer-title"
                className="mt-2 max-w-xl text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
              >
                Due diligence infrastructure for autonomous agents
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Verify ownership, operator identity, on-chain provenance and operational integrity
                through one independent AgentRanking assessment.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <span
                  className="cx-btn cx-btn-secondary cx-btn-sm inline-flex cursor-not-allowed items-center justify-center gap-1.5 opacity-50"
                  aria-disabled="true"
                >
                  Coming soon
                </span>
              </div>
            </div>
            <VerificationScopePanel />
          </div>
          <VerificationDossierCard className="lg:sticky lg:top-4" />
        </div>
      </div>
    </section>
  );
}
