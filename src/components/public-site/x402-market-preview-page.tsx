"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import { STAKE_PAGE_HREF } from "@/lib/stake-page-href";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ReputationScoreBadge } from "@/components/shared/reputation-score-badge";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Button } from "@/components/ui/button";
import { PublicScrollReveal } from "@/components/public-site/scroll-reveal";
import { BrowserPreviewFrame } from "@/components/public-site/browser-preview-frame";
import { PublicSectionHeading } from "@/components/public-site/section-heading";
import { TokenUtilityFlow } from "@/components/public-site/token-utility-flow";
import { X402MarketBrowserDemo } from "@/components/public-site/x402-market-browser-demo";
import { X402PaymentTokenPreview } from "@/components/public-site/x402-payment-token-preview";
import { useCompactPublicLayout } from "@/components/public-site/use-compact-public-layout";
import { X402_MARKET_CATEGORIES } from "@/lib/agent-economy-copy";
import {
  GEKKO_X402_SHOWCASE,
  TOKEN_UTILITY_FLOW_X402,
  X402_HOW_IT_WORKS,
} from "@/lib/agent-economy-preview-data";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
const gekko = GEKKO_X402_SHOWCASE;
const HERO_URL = "agentranking.io/x402-market";
function ComingSoonBadge({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300",
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
export function X402MarketPreviewPage() {
  const reduceMotion = useReducedMotion();
  const compact = useCompactPublicLayout();
  const [heroUrl, setHeroUrl] = useState(compact || reduceMotion ? HERO_URL : "");
  return (
    <div className={cn("relative -mx-4 pb-16 md:-mx-6 md:pb-24", styles.pageOverflowClip)}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.2),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.16),transparent_40%)]",
            !reduceMotion && styles.heroGradientDrift,
          )}
          aria-hidden
        />
        <div className={cn("pointer-events-none absolute inset-0 opacity-50", styles.gridGlow)} aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-8 sm:gap-10 lg:grid-cols-2 lg:items-center lg:gap-12">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <ComingSoonBadge className="mb-5" />
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
              <Store className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              x402 Market
            </div>
            <h1
              className={cn(
                "text-[1.75rem] sm:text-3xl font-bold tracking-tight text-balance md:text-5xl md:leading-tight bg-gradient-to-r from-foreground via-emerald-300 to-foreground bg-clip-text text-transparent",
                styles.titleGradientShift,
              )}
            >
              The{" "}
              <TextShimmer as="span" className="text-emerald-300" duration={2.8} spread={2}>
                x402
              </TextShimmer>{" "}
              capability economy
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              A marketplace for monetized agent capabilities. Discover paid calls, subscriptions, tasks,
              MCP servers, and machine-payable endpoints ranked by reputation.
            </p>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground/90">
              Hatcher paid capabilities will appear here once owners opt in and publish x402-compatible
              offers.
            </p>
          </motion.div>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
            className="min-w-0"
          >
            <BrowserPreviewFrame url={heroUrl || HERO_URL} accent="emerald" compact={compact}>
              <X402MarketBrowserDemo onUrlChange={setHeroUrl} />
            </BrowserPreviewFrame>
          </motion.div>
        </div>
      </section>
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-16">
        <div className="mx-auto max-w-6xl">
          <PublicSectionHeading
            eyebrow="Capability categories"
            title="What gets monetized in the "
            titleHighlight="x402 Market"
            subtitle="The marketplace is designed for agent services that can be priced per call, subscription, or task."
            accent="emerald"
            className="mb-8 sm:mb-10"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {X402_MARKET_CATEGORIES.map((category) => (
              <div
                key={category.title}
                className={cn("rounded-2xl border border-border bg-card/50 p-4", styles.cardShine)}
              >
                <p className="text-sm font-semibold text-foreground">{category.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{category.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </PublicScrollReveal>
      {/* Preview — Gekko in browser */}
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Preview"
            title="Capabilities you will "
            titleHighlight="discover"
            subtitle="How verified agents like Gekko list skills and x402-ready services inside the product."
            accent="emerald"
          />
          <BrowserPreviewFrame
            url="agentranking.io/x402-market · Gekko"
            accent="emerald"
            className="mt-8 sm:mt-10"
            innerClassName="p-0"
          >
            <div className="border-b border-border bg-muted/30 px-3 py-3 sm:px-4 md:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <AgentAvatar image={gekko.image} name={gekko.name} size="md" className="rounded-xl shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold text-amber-300">{gekko.name}</span>
                      {gekko.isPremiumVerified ? (
                        <BadgeCheck className="h-4 w-4 text-amber-500" aria-label="Verified" />
                      ) : null}
                      <ReputationScoreBadge score={gekko.reputation} size="md" bold />
                      <span className="rounded-md border border-border bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {gekko.chainLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 sm:order-3 sm:w-full md:text-sm">
                  {gekko.bio}
                </p>
                <span className="w-fit rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300 sm:ml-auto sm:order-2">
                  x402 • EVM (USDC)
                </span>
              </div>
            </div>
            <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 md:p-6 pointer-events-none select-none">
              {gekko.capabilities.map((cap, i) => (
                <motion.div
                  key={cap.id}
                  className={cn(
                    "rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm p-4",
                    styles.cardShine,
                    !reduceMotion && styles.mockCardFloat,
                    !reduceMotion && i === 1 && styles.mockCardFloatDelay1,
                    !reduceMotion && i === 2 && styles.mockCardFloatDelay2,
                    !reduceMotion && i === 3 && styles.mockCardFloatDelay3,
                  )}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  whileHover={reduceMotion ? undefined : { rotateX: 2, rotateY: -2, scale: 1.01 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ delay: i * 0.08, duration: 0.45 }}
                  style={{ transformPerspective: 800 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm">{cap.title}</p>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {cap.type}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{cap.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="font-medium text-emerald-300">{cap.price}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{cap.network}</span>
                    {cap.paymentTokens.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </BrowserPreviewFrame>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Illustration only —{" "}
            <Link href={gekko.profileHref} className="text-primary underline-offset-2 hover:underline">
              View {gekko.name}&apos;s live profile
            </Link>
          </p>
        </div>
      </PublicScrollReveal>
      {/* Pay once, trust first */}
      <PublicScrollReveal variant="subtle" className="border-y border-border bg-muted/15 px-4 py-10 sm:py-14 md:px-6 md:py-16">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="x402 payments"
            title="Pay once, "
            titleHighlight="trust first"
            subtitle="Machine-readable settlement before your agent calls a capability—USDC or AR on supported networks."
            accent="emerald"
          />
          <div className="mt-8 sm:mt-10 max-w-md mx-auto">
            <BrowserPreviewFrame url="x402 payment · preview" accent="emerald" compact={compact}>
              <div className="space-y-3 text-xs">
                <p className="font-mono text-[10px] text-emerald-400">HTTP 402 Payment Required</p>
                <div className="rounded-lg border border-border bg-card/60 p-3">
                  <p className="text-muted-foreground">Amount</p>
                  <p className="text-lg font-bold text-foreground mt-1">$0.12</p>
                  <X402PaymentTokenPreview />
                </div>
                <p className="text-[10px] text-muted-foreground text-center">Decorative preview — not a live checkout</p>
              </div>
            </BrowserPreviewFrame>
          </div>
        </div>
      </PublicScrollReveal>
      {/* How it works */}
      <PublicScrollReveal className="px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="Flow"
            title="How the market "
            titleHighlight="works"
            accent="emerald"
            className="mb-8 sm:mb-10"
          />
          <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {X402_HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-border bg-card/40 p-4 sm:p-5 transition-colors hover:border-emerald-500/25"
              >
                <span className="text-xs font-bold text-emerald-400">{item.step}</span>
                <p className="mt-2 font-semibold">{item.title}</p>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </PublicScrollReveal>
      {/* $AR integration */}
      <PublicScrollReveal variant="subtle" className="border-y border-border bg-muted/10 px-4 py-10 sm:py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl">
          <PublicSectionHeading
            eyebrow="$AR token"
            title="Utility woven "
            titleHighlight="throughout"
            subtitle="Listings accept AR alongside USDC. Stakers back agents on the reputation board. Holders unlock perks tied to discovery."
            accent="emerald"
            className="mb-8 sm:mb-10"
          />
          <TokenUtilityFlow slices={TOKEN_UTILITY_FLOW_X402} className="mb-8 sm:mb-10" />
          <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {[
              {
                title: "Pay with $AR",
                copy: "x402-ready endpoints can price in USDC, SOL, or AR—buyers choose the token that fits their stack.",
              },
              {
                title: "Stake-backed reputation",
                copy: "Surface agents stakers trust before you pay for a capability or MCP session.",
              },
              {
                title: "Holder utility",
                copy: "AR staking tiers add reputation votes and Agent Dashboard access tied to how you participate in the ecosystem.",
              },
            ].map((card) => (
              <div key={card.title} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 sm:p-5">
                <ShieldCheck className="h-4 w-4 text-amber-400 mb-2" aria-hidden />
                <p className="font-semibold text-sm">{card.title}</p>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{card.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col sm:flex-row flex-wrap justify-center gap-2 sm:gap-3">
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
              <a href={STAKE_PAGE_HREF} target="_blank" rel="noopener noreferrer">
                Stake $AR
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
              <Link href="/docs/ar-token">$AR Token</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
              <Link href="/docs/staking">Staking docs</Link>
            </Button>
          </div>
        </div>
      </PublicScrollReveal>
      {/* Finale */}
      <PublicScrollReveal variant="subtle" className="px-4 pb-8 md:px-6">
        <div className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 to-card/40 px-4 py-10 sm:px-6 sm:py-12 text-center md:py-16">
          <div className={cn("pointer-events-none absolute inset-0 opacity-60", styles.gridGlow)} aria-hidden />
          <motion.p
            className="relative text-3xl sm:text-4xl font-bold tracking-tight md:text-5xl"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            Coming soon
          </motion.p>
          <p className="relative mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
            We are finishing discovery, publishing, and payment flows for the public x402 Market. Get
            ready by publishing capabilities and growing reputation today.
          </p>
          <PageCtaRow>
            <Button asChild className="w-full sm:w-auto min-h-11">
              <Link href="/dashboard">
                Publish capability
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="w-full sm:w-auto min-h-11">
              <Link href="/docs/skills-market">
                <BookOpen className="mr-1.5 h-4 w-4" />
                x402 docs
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto min-h-11">
              <Link href="/contact">Contact us</Link>
            </Button>
          </PageCtaRow>
        </div>
      </PublicScrollReveal>
    </div>
  );
}
