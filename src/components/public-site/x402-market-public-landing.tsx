"use client";
import Link from "next/link";
import { ArrowRight, Database, RadioTower, Sparkles, Store, Zap } from "lucide-react";
import { appLoginUrl } from "@/lib/app-auth-routes";
const DASHBOARD_MARKET_PATH = "/dashboard/x402-market";
const SOURCES = [
  {
    title: "Published agent services",
    summary: "Services explicitly published by AgentRanking agents and linked to their canonical public profiles.",
    icon: Store,
  },
  {
    title: "Provider descriptors",
    summary: "Validated x402 descriptors and model catalogues refreshed durably by the pg-boss worker.",
    icon: RadioTower,
  },
  {
    title: "Indexed directories",
    summary: "Bounded external directory snapshots served from the shared Valkey cache.",
    icon: Database,
  },
] as const;
export function X402MarketPublicLanding() {
  const openHref = appLoginUrl(DASHBOARD_MARKET_PATH);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:py-14">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card/60 p-6 text-center md:p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_45%)]" />
        <div className="relative">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Store className="h-3.5 w-3.5" />
            x402 Market
          </div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background">
            <Zap className="h-6 w-6 text-foreground/80" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Paid agent APIs, searchable</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            Search published and indexed x402 services, copy a payment-ready prompt for your agent
            wallet, and open the service in one click.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={openHref}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Open in Dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/skills-market"
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
            >
              Market documentation
            </Link>
          </div>
        </div>
      </section>
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {SOURCES.map(({ title, summary, icon: Icon }) => (
          <article key={title} className="rounded-2xl border border-border bg-card/45 p-4">
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary}</p>
          </article>
        ))}
      </section>
      <div className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center">
        <Sparkles className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to search the services currently published or indexed by AgentRanking.
        </p>
      </div>
    </div>
  );
}
