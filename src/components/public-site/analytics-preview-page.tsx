"use client";
import Link from "next/link";
import { type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Database,
  LineChart,
  Lock,
  Sparkles,
  Store,
  TrendingUp,
} from "lucide-react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Button } from "@/components/ui/button";
import { PublicScrollReveal } from "@/components/public-site/scroll-reveal";
import { BrowserPreviewFrame } from "@/components/public-site/browser-preview-frame";
import { PublicSectionHeading } from "@/components/public-site/section-heading";
import { TokenUtilityFlow } from "@/components/public-site/token-utility-flow";
import { AnalyticsProductCards } from "@/components/public-site/analytics-product-cards";
import { AnalyticsPreviewDashboard } from "@/components/public-site/analytics-preview-dashboard";
import { useCompactPublicLayout } from "@/components/public-site/use-compact-public-layout";
import {
  ANALYTICS_ACCESS_TIERS,
  ANALYTICS_API_EXAMPLES,
  ANALYTICS_BUYER_PERSONAS,
  ANALYTICS_DATA_PRODUCTS,
  ANALYTICS_DATA_SALE_FLOW,
  ANALYTICS_HERO_URL,
  ANALYTICS_HOW_IT_WORKS,
  TOKEN_UTILITY_FLOW_ANALYTICS,
} from "@/lib/analytics-preview-data";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
const PERSONA_ICONS = {
  trending: TrendingUp,
  bot: Bot,
  store: Store,
  database: Database,
} as const;
function ComingSoonBadge({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-300",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      Coming soon
    </span>
  );
}
function PageCtaRow({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3 w-full max-w-md sm:max-w-none mx-auto">
      {children}
    </div>
  );
}
function DataSaleFlow() {
  return (
    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 md:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/90 mb-4">
        How data is sold (planned)
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {ANALYTICS_DATA_SALE_FLOW.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2 sm:flex-1 sm:min-w-0">
            <div className="rounded-lg border border-border bg-card/50 px-3 py-2 text-center flex-1 min-w-[120px]">
              <p className="text-xs font-semibold text-foreground">{step.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{step.sub}</p>
            </div>
            {i < ANALYTICS_DATA_SALE_FLOW.length - 1 ? (
              <ArrowRight className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10px] text-center text-muted-foreground">
        Illustrative commercial flow — actual packaging and policy are documented in the $AR reference.
      </p>
    </div>
  );
}
export function AnalyticsPreviewPage() {
  const reduceMotion = useReducedMotion();
  const compact = useCompactPublicLayout();
  return (
    <div className={cn("relative -mx-4 pb-16 md:-mx-6 md:pb-24", styles.pageOverflowClip)}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.2),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_40%)]",
            !reduceMotion && styles.heroGradientDrift,
          )}
          aria-hidden
        />
        <div className={cn("pointer-events-none absolute inset-0 opacity-35", styles.gridGlow)} aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-8 sm:gap-10 lg:grid-cols-2 lg:items-center lg:gap-12">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <ComingSoonBadge className="mb-5" />
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
              <LineChart className="h-3.5 w-3.5 text-blue-400" aria-hidden />
              Analytics
            </div>
            <h1
              className={cn(
                "text-[1.75rem] sm:text-3xl font-bold tracking-tight text-balance md:text-5xl md:leading-tight bg-gradient-to-r from-foreground via-blue-300 to-foreground bg-clip-text text-transparent",
                styles.titleGradientShift,
              )}
            >
              Intelligence layer for the{" "}
              <TextShimmer as="span" className="text-blue-300" duration={2.8} spread={2}>
                agent economy
              </TextShimmer>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              AgentRanking packages enriched registry data as dashboards, APIs, and exports—sold to funds,
              agent teams, and marketplaces who need signals block explorers cannot provide.
            </p>
            <PageCtaRow>
              <Button asChild className="min-h-11 w-full sm:w-auto">
                <Link href="/contact">
                  Request data access
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
                <Link href="/docs/analytics">
                  Analytics docs
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </PageCtaRow>
          </motion.div>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
            className="min-w-0"
          >
            <BrowserPreviewFrame url={ANALYTICS_HERO_URL} accent="blue" compact={compact}>
              <AnalyticsPreviewDashboard />
            </BrowserPreviewFrame>
          </motion.div>
        </div>
      </section>
      {/* How it works */}
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-16">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Pipeline"
            title="From chain events to "
            titleHighlight="packaged data products"
            subtitle="The same index that powers discovery and Agent Dashboard becomes intelligence you can license."
            accent="blue"
            className="mb-8 sm:mb-10"
          />
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {ANALYTICS_HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-border bg-card/40 p-4 transition-colors hover:border-blue-500/25"
              >
                <span className="text-xs font-bold text-blue-400">{item.step}</span>
                <p className="mt-2 text-sm font-semibold">{item.title}</p>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{item.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <DataSaleFlow />
          </div>
        </div>
      </PublicScrollReveal>
      {/* Data products catalog */}
      <PublicScrollReveal className="border-y border-border bg-muted/10 px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <PublicSectionHeading
            eyebrow="Data products"
            title="What we plan to "
            titleHighlight="sell"
            subtitle="Each SKU is a packaged view of the agent graph—delivery format and access tier vary by buyer."
            accent="blue"
            className="mb-8 sm:mb-10"
          />
          <AnalyticsProductCards products={ANALYTICS_DATA_PRODUCTS} />
        </div>
      </PublicScrollReveal>
      {/* Full dashboard preview */}
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Preview"
            title="Intelligence "
            titleHighlight="workspace"
            subtitle="Tab between planned feeds—Registry Pulse, Capability Graph, and Demand Index. All figures are illustrative."
            accent="blue"
          />
          <BrowserPreviewFrame
            url={ANALYTICS_HERO_URL}
            accent="blue"
            className="mt-8 sm:mt-10"
            innerClassName="p-0"
          >
            <AnalyticsPreviewDashboard />
          </BrowserPreviewFrame>
        </div>
      </PublicScrollReveal>
      {/* API examples */}
      <PublicScrollReveal variant="subtle" className="border-y border-border bg-muted/15 px-4 py-10 sm:py-14 md:px-6 md:py-16">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Developers"
            title="API & "
            titleHighlight="exports"
            subtitle="Fictional endpoint shapes for planning—production schemas ship with enterprise access."
            accent="blue"
            className="mb-8"
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {ANALYTICS_API_EXAMPLES.map((ex) => (
              <div
                key={ex.path}
                className={cn("rounded-2xl border border-border bg-card/50 overflow-hidden", styles.cardShine)}
              >
                <div className="border-b border-border bg-muted/20 px-3 py-2">
                  <code className="text-[11px] font-semibold text-blue-300">
                    {ex.method} {ex.path}
                  </code>
                  <p className="mt-1 text-[10px] text-muted-foreground">{ex.description}</p>
                </div>
                <pre className="overflow-x-auto p-3 text-[10px] leading-relaxed text-muted-foreground font-mono">
                  {ex.sample}
                </pre>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Enterprise buyers can also request scheduled{" "}
            <span className="text-foreground/90 font-medium">CSV / Parquet</span> snapshots for warehouse
            ingestion.
          </p>
        </div>
      </PublicScrollReveal>
      {/* Buyer personas */}
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-16">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Buyers"
            title="Who licenses "
            titleHighlight="agent intelligence"
            accent="blue"
            className="mb-8"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {ANALYTICS_BUYER_PERSONAS.map((persona) => {
              const Icon = PERSONA_ICONS[persona.icon];
              return (
                <div
                  key={persona.title}
                  className={cn("rounded-2xl border border-border bg-card/50 p-4 sm:p-5", styles.cardShine)}
                >
                  <Icon className="h-4 w-4 text-blue-300 mb-2" aria-hidden />
                  <p className="font-semibold text-sm">{persona.title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{persona.copy}</p>
                </div>
              );
            })}
          </div>
        </div>
      </PublicScrollReveal>
      {/* Access tiers + AR */}
      <PublicScrollReveal className="border-t border-border px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl space-y-10">
          <div>
            <PublicSectionHeading
              eyebrow="Access"
              title="Preview, Pro API, and "
              titleHighlight="Enterprise"
              subtitle="No fixed public pricing—contact for contracts. Staking may unlock analytics perks per policy."
              accent="amber"
              className="mb-8"
            />
            <div className="grid gap-3 md:grid-cols-3">
              {ANALYTICS_ACCESS_TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className={cn(
                    "rounded-2xl border p-5",
                    tier.highlight
                      ? "border-blue-500/35 bg-blue-500/10 shadow-[0_0_32px_-12px_rgba(59,130,246,0.35)]"
                      : "border-border bg-card/40",
                  )}
                >
                  <p className="text-sm font-bold">{tier.name}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tier.description}</p>
                  <p className="mt-4 text-xs font-semibold text-blue-300/90">{tier.cta}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <PublicSectionHeading
              eyebrow="$AR token"
              title="Data revenue and "
              titleHighlight="$AR utility"
              subtitle="Planned allocation from intelligence products—illustrative only; see the $AR documentation for policy."
              accent="amber"
              className="mb-6"
            />
            <TokenUtilityFlow slices={TOKEN_UTILITY_FLOW_ANALYTICS} />
          </div>
        </div>
      </PublicScrollReveal>
      {/* CTA */}
      <PublicScrollReveal variant="subtle" className="border-t border-border bg-muted/15 px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-blue-300" aria-hidden />
          <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">Get on the data access list</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Tell us your use case—fund screening, marketplace curation, agent strategy, or warehouse ingestion.
            We&apos;ll reach out when Pro API and Enterprise exports open.
          </p>
          <PageCtaRow>
            <Button asChild size="lg" className="min-h-11">
              <Link href="/contact">
                Contact sales
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-11">
              <Link href="/docs/ar-token">
                $AR documentation
              </Link>
            </Button>
          </PageCtaRow>
          <p className="mt-6 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            Illustrative preview only — not investment advice
          </p>
        </div>
      </PublicScrollReveal>
    </div>
  );
}
