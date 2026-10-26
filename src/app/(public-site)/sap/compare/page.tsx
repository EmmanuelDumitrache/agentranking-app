import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { readSapComparison } from "@/lib/sap/compare.server";
import { normalizeSapComparePda, sapCompareResourceKey } from "@/lib/sap-ecosystem-shared";
import { absoluteUrl } from "@/lib/site-url";
import { hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { getSapSeoKeywords } from "@/lib/seo-keywords";
import { SapCompareClient } from "../sap-compare-client";
import { SapShareUrlButton } from "@/components/sap/sap-share-url-button";
import { ChevronLeft } from "lucide-react";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}): Promise<Metadata> {
  const { a = "", b = "" } = await searchParams;
  if (!a || !b) {
    const canonical = absoluteUrl("/sap/compare");
    const title = "Compare SAP Agents — Synapse Side‑by‑Side | AgentRanking";
    const description =
      "Diff two Synapse Agent Protocol listings: capabilities, pricing tiers, protocols, x402 signals, and AgentRanking trust — shareable compare URLs.";
    return {
      title,
      description,
      keywords: getSapSeoKeywords(),
      alternates: {
        canonical,
        languages: hreflangLanguages(canonical),
      },
      openGraph: {
        type: "website",
        title,
        description,
        url: canonical,
        siteName: "AgentRanking",
      },
      twitter: {
        card: "summary_large_image",
        site: SITE_TWITTER_HANDLE,
        creator: SITE_TWITTER_HANDLE,
        title,
        description,
      },
    };
  }
  const [ra, rb] = await Promise.all([
    prisma.agent.findFirst({ where: { sapAgentPda: a.trim() }, select: { name: true } }),
    prisma.agent.findFirst({ where: { sapAgentPda: b.trim() }, select: { name: true } }),
  ]);
  const na = ra?.name ?? "Agent A";
  const nb = rb?.name ?? "Agent B";
  const title = `${na} vs ${nb} | SAP compare`;
  const description = `Compare ${na} and ${nb} on AgentRanking — capabilities, pricing, protocols, SAP stats.`;
  const qs = `a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
  const canonical = absoluteUrl(`/sap/compare?${qs}`);
  return {
    title,
    description,
    keywords: getSapSeoKeywords(),
    alternates: {
      canonical,
      languages: hreflangLanguages(canonical),
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: "AgentRanking",
    },
    twitter: {
      card: "summary_large_image",
      site: SITE_TWITTER_HANDLE,
      creator: SITE_TWITTER_HANDLE,
      title,
      description,
    },
  };
}
export default async function SapComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const rawParams = await searchParams;
  const a = normalizeSapComparePda(rawParams.a);
  const b = normalizeSapComparePda(rawParams.b);
  const initialDataKey = sapCompareResourceKey(a, b);
  const initialResult = initialDataKey ? await readSapComparison(a, b) : null;
  const initialData = initialResult?.ok ? initialResult.data : initialResult ? null : undefined;
  const initialError = initialResult && !initialResult.ok ? initialResult.error : null;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/sap"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-400"
          >
            <ChevronLeft className="h-3 w-3" /> SAP ecosystem
          </Link>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
            Synapse Agent Protocol
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Compare agents</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Side-by-side SAP data: capabilities, tiers, protocols, x402 reachability, and AgentRanking scores.
            <span className="text-amber-500/90"> Amber</span> highlights differences;{" "}
            <span className="text-emerald-400">emerald</span> highlights matches.
          </p>
        </div>
        <SapShareUrlButton />
      </div>
      <Suspense
        fallback={<div className="py-12 text-sm text-muted-foreground">Loading…</div>}
      >
        <SapCompareClient
          initialA={a}
          initialB={b}
          initialData={initialData}
          initialDataKey={initialDataKey}
          initialError={initialError}
        />
      </Suspense>
    </div>
  );
}