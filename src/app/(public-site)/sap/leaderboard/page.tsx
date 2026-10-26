import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { getSapSeoKeywords } from "@/lib/seo-keywords";
import { getSapLeaderboard } from "@/lib/sap-ecosystem";
import { normalizeSapLeaderboardMode } from "@/lib/sap-ecosystem-shared";
import { SapLeaderboardClient } from "./sap-leaderboard-client";

const canonical = absoluteUrl("/sap/leaderboard");
const lbOg = defaultOgImageMetadata();
const title = "SAP Agent Leaderboard — Synapse Rankings by Reputation & Volume | AgentRanking";
const description =
  "Compare Synapse Agent Protocol listings by reputation scores, liquidity volume, protocols, SAP capabilities, registration age — all normalized on AgentRanking.";

export const metadata: Metadata = {
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
    images: [{ ...lbOg, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title,
    description,
    images: [lbOg.url],
  },
};

type SapLeaderboardPageProps = {
  readonly searchParams: Promise<{ mode?: string | string[] }>;
};

export default async function SapLeaderboardPage({ searchParams }: SapLeaderboardPageProps) {
  const params = await searchParams;
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = normalizeSapLeaderboardMode(rawMode);
  const entries = await getSapLeaderboard(mode, 100);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6 md:py-10">
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
        <h1 className="text-2xl font-bold tracking-tight">SAP leaderboard</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Sort verified SAP agents by reputation (SAP stats), execution volume proxy, capability count, protocol
          tags, or oldest on-chain registration.
        </p>
      </div>
      <SapLeaderboardClient initialMode={mode} initialEntries={entries} />
    </div>
  );
}
