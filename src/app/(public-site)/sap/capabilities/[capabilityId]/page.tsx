import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { absoluteUrl } from "@/lib/site-url";
import { hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { getSapSeoKeywords } from "@/lib/seo-keywords";
import { getSapCapabilityIndexEntry, getSapCapabilityStaticSlugs } from "@/lib/sap-ecosystem";
import { SapVerifiedBadge } from "@/components/agents/sap-verified-badge";
import { SapShareUrlButton } from "@/components/sap/sap-share-url-button";
import { agentPublicPath } from "@/lib/agent-public-url";
export const revalidate = 3600;
export async function generateStaticParams() {
  const rows = await getSapCapabilityStaticSlugs();
  return rows.map((r) => ({ capabilityId: encodeURIComponent(r.capabilityId) }));
}
function humanizeCapabilityTitle(id: string): string {
  return id.replace(/[@_/]/g, " ").replace(/-/g, " ").trim() || id;
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}): Promise<Metadata> {
  const { capabilityId: raw } = await params;
  const capabilityId = decodeURIComponent(raw);
  const entry = await getSapCapabilityIndexEntry(capabilityId);
  const label = humanizeCapabilityTitle(capabilityId);
  const slugPath = `/sap/capabilities/${encodeURIComponent(capabilityId)}`;
  const canonical = absoluteUrl(slugPath);
  const title = `${label} SAP agents on Solana | AgentRanking`;
  const description = entry
    ? `${entry.agentCount} Synapse verified agents with “${label}” on Solana — compare pricing tiers, trust, and AgentRanking scores before you integrate.`
    : `Discover SAP-verified Solana agents exposing “${label}” — Synapse Agent Protocol directory on AgentRanking.`;
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
      siteName: "AgentRanking",
      title,
      description,
      url: canonical,
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
export default async function SapCapabilityDetailPage({
  params,
}: {
  params: Promise<{ capabilityId: string }>;
}) {
  const { capabilityId: raw } = await params;
  const capabilityId = decodeURIComponent(raw);
  const entry = await getSapCapabilityIndexEntry(capabilityId);
  if (!entry) notFound();
  const label = humanizeCapabilityTitle(capabilityId);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/sap/capabilities"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-400"
          >
            <ChevronLeft className="h-3 w-3" /> Capability index
          </Link>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
            Synapse Agent Protocol · Solana
          </p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-balance">
            AI Agents with {label} on Solana
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">{entry.description}</p>
          <p className="text-xs text-muted-foreground">
            {entry.agentCount} SAP verified agents
            {entry.avgPrice != null ? ` · avg min price ~${entry.avgPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
          </p>
        </div>
        <SapShareUrlButton />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium hidden sm:table-cell">SAP</th>
              <th className="px-3 py-2 font-medium text-right">Reputation</th>
              <th className="px-3 py-2 font-medium text-right">Min price</th>
              <th className="px-3 py-2 font-medium text-right">Trust (AR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {entry.agents.map((a) => (
              <tr key={`${a.sapAgentPda}-${a.agentId}`} className="hover:bg-muted/10">
                <td className="px-3 py-2">
                  <Link
                    href={agentPublicPath(a)}
                    className="font-medium text-foreground hover:text-emerald-400"
                  >
                    {a.name}
                  </Link>
                </td>
                <td className="px-3 py-2 hidden sm:table-cell">
                  <SapVerifiedBadge sapAgentPda={a.sapAgentPda} compact />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {a.reputation != null ? a.reputation.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {a.minPrice != null ? a.minPrice.toLocaleString() : "—"}
                  {a.tierLabel ? (
                    <span className="block text-[10px] text-muted-foreground truncate max-w-[8rem] ml-auto">
                      {a.tierLabel}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{a.protocolTrustScore.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
