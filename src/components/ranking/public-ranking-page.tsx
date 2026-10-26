import { Suspense } from "react";
import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { AgentsIndexToolbar } from "@/components/public-site/agents-index-toolbar";
import { AgentMarketCard } from "@/components/public-site/agent-market-card";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import type { PublicAgentIndexModel } from "@/lib/public-agents-index.server";
import {
  buildPublicRankingHref,
  type PublicRankingAgent,
  type PublicRankingInput,
  type PublicRankingPageData,
  type PublicRankingSummary,
} from "@/lib/ranking/public-ranking.server";

const integerFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});
const snapshotFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatInteger(value: number): string {
  return integerFormatter.format(Math.max(0, Math.round(value)));
}

function formatShare(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const share = (part / whole) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return `${share.toFixed(share < 10 ? 1 : 0)}%`;
}

type CorpusSegment = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly barClass: string;
  readonly swatchClass: string;
};

function rankingCorpusSegments(summary: PublicRankingSummary): CorpusSegment[] {
  const rankedOther = Math.max(0, summary.totalAgents - summary.rankedVerifiedAgents);
  return [
    {
      id: "verified",
      label: "Verified on list",
      count: summary.rankedVerifiedAgents,
      barClass: "ui-ranking-corpus-seg ui-ranking-corpus-seg--verified",
      swatchClass: "ui-ranking-corpus-swatch ui-ranking-corpus-swatch--verified",
    },
    {
      id: "ranked",
      label: "Listed / ranked",
      count: rankedOther,
      barClass: "ui-ranking-corpus-seg ui-ranking-corpus-seg--ranked",
      swatchClass: "ui-ranking-corpus-swatch ui-ranking-corpus-swatch--ranked",
    },
    {
      id: "unranked",
      label: "Indexed, not listed",
      count: summary.activeUnrankedAgents,
      barClass: "ui-ranking-corpus-seg ui-ranking-corpus-seg--unranked",
      swatchClass: "ui-ranking-corpus-swatch ui-ranking-corpus-swatch--unranked",
    },
    {
      id: "dead",
      label: "Dead / spam",
      count: summary.deadOrSpamAgents,
      barClass: "ui-ranking-corpus-seg ui-ranking-corpus-seg--dead",
      swatchClass: "ui-ranking-corpus-swatch ui-ranking-corpus-swatch--dead",
    },
  ];
}

function RankingCorpusBar({ summary }: { readonly summary: PublicRankingSummary }) {
  const indexed = summary.indexedAgents;
  const segments = rankingCorpusSegments(summary);
  const deadShare = formatShare(summary.deadOrSpamAgents, indexed);
  const visibleSegments = segments.filter((segment) => segment.count > 0);

  return (
    <PublicSitePanel>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-[0.08em]">
            Full index
          </p>
          <p className="mt-1 text-2xl font-semibold leading-none tabular-nums sm:text-[1.75rem]">
            {formatInteger(indexed)}
            <span className="text-muted-foreground ml-1.5 text-sm font-normal">indexed</span>
          </p>
        </div>
        {indexed > 0 ? (
          <p className="text-muted-foreground shrink-0 pb-0.5 text-[11px] tabular-nums sm:text-xs">
            {deadShare} dead
          </p>
        ) : null}
      </div>

      <div
        className="ui-ranking-corpus-track"
        role="img"
        aria-label={`Index mix: ${segments
          .map((segment) => `${formatInteger(segment.count)} ${segment.label}`)
          .join(", ")}`}
      >
        {indexed > 0 && visibleSegments.length > 0 ? (
          visibleSegments.map((segment) => (
            <span
              key={segment.id}
              className={segment.barClass}
              style={{ flexGrow: segment.count, flexBasis: 0 }}
              title={`${segment.label}: ${formatInteger(segment.count)}`}
            />
          ))
        ) : (
          <span className="ui-ranking-corpus-seg ui-ranking-corpus-seg--dead flex-1" />
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <li
            key={segment.id}
            className="text-muted-foreground flex items-center gap-1.5 text-[11px] tabular-nums sm:text-xs"
          >
            <span className={segment.swatchClass} aria-hidden />
            <span>
              <span className="text-foreground font-medium">{formatInteger(segment.count)}</span>{" "}
              {segment.label}
            </span>
          </li>
        ))}
      </ul>
    </PublicSitePanel>
  );
}

function formatSnapshot(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : snapshotFormatter.format(date);
}

function rankingAgentToCardModel(agent: PublicRankingAgent): PublicAgentIndexModel {
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: 0,
    name: agent.name,
    image: agent.image,
    description: agent.description,
    isVerified: agent.verified,
    isPremiumVerified: false,
    publicVerificationStatus: agent.verified ? "verified" : "unverified",
    arVerificationStatus: agent.verified ? "verified" : null,
    credential: { present: false },
    isSolanaDirectoryListed: false,
    agentRankScore: agent.arScore > 0 ? agent.arScore : null,
    listedAt: null,
    lastActiveAt: agent.lastActiveAt,
    profileHref: agent.profilePath,
    linkedToken: null,
    linkedTokenChain: null,
    linkedTokenVenue: null,
    market: null,
    launchCreatedAt: null,
    totalFeesDistributedLamports: null,
    buyCount: 0,
    sellCount: 0,
  };
}

function AgentsCardGrid({
  agents,
}: {
  readonly agents: readonly PublicRankingAgent[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <AgentMarketCard
          key={agent.id}
          agent={rankingAgentToCardModel(agent)}
          badge={agent.chain.shortName}
          subtitle={agent.chain.name}
          rank={agent.rank}
        />
      ))}
    </div>
  );
}

function AgentsPagination({
  input,
  data,
}: {
  readonly input: PublicRankingInput;
  readonly data: PublicRankingPageData;
}) {
  if (!data.hasPrevious && !data.hasNext) return null;
  return (
    <nav aria-label="Agent pages" className="flex shrink-0 items-center gap-2">
      {data.hasPrevious && data.previousCursor ? (
        <Link
          href={buildPublicRankingHref(input, { before: data.previousCursor })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Link>
      ) : null}
      {data.hasNext && data.nextCursor ? (
        <Link
          href={buildPublicRankingHref(input, { after: data.nextCursor })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}

function AgentsIndexChromeFallback() {
  return (
    <div className="space-y-3">
      <div className="ui-panel h-[7.5rem] animate-pulse" />
      <div className="h-10 animate-pulse rounded-lg bg-muted/40" />
      <div className="h-8 w-72 animate-pulse rounded-lg bg-muted/30" />
      <span className="sr-only">Loading index and filters</span>
    </div>
  );
}

function AgentsResultsFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="ui-public-site-card h-[17rem] animate-pulse p-4">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
              <div className="h-8 w-full rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading agents</span>
    </div>
  );
}

function AgentsIndexSignals({ summary }: { readonly summary: PublicRankingSummary }) {
  const items = [
    { label: "Listed", value: formatInteger(summary.totalAgents) },
    { label: "Verified", value: formatInteger(summary.verifiedAgents) },
    { label: "x402", value: formatInteger(summary.x402Agents) },
    { label: "MPP", value: formatInteger(summary.mppAgents) },
    { label: "Chains", value: formatInteger(summary.totalChains) },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      aria-label="Directory signals"
    >
      {items.map((item) => (
        <div key={item.label} className="ui-stat-card flex flex-col items-center justify-center py-3 text-center">
          <p className="ui-stat-value !mt-0">{item.value}</p>
          <p className="ui-stat-label mt-1">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

async function AgentsIndexChrome({
  input,
  summary,
}: {
  readonly input: PublicRankingInput;
  readonly summary: Promise<PublicRankingSummary>;
}) {
  const resolvedSummary = await summary;

  return (
    <div className="space-y-4">
      <RankingCorpusBar summary={resolvedSummary} />
      <AgentsIndexSignals summary={resolvedSummary} />
      <AgentsIndexToolbar
        key={input.query}
        query={input.query}
        chainId={input.chainId}
        verifiedOnly={input.verifiedOnly}
        x402Only={input.x402Only}
        mppOnly={input.mppOnly}
        chains={resolvedSummary.chains}
      />
    </div>
  );
}

async function AgentsIndexResults({
  input,
  data,
}: {
  readonly input: PublicRankingInput;
  readonly data: Promise<PublicRankingPageData>;
}) {
  const resolvedData = await data;

  if (resolvedData.agents.length === 0) {
    return (
      <PublicSitePanel className="px-4 py-16 text-center sm:px-5">
        <Bot className="text-muted-foreground mx-auto h-8 w-8" aria-hidden />
        <h2 className="mt-3 text-sm font-semibold">No agents match these filters</h2>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
          Search is prefix-based. Try a shorter name, tap AR for platform agents, or reset filters.
        </p>
        <Link
          href="/agents"
          className="mt-4 inline-flex rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted/50"
        >
          Reset filters
        </Link>
      </PublicSitePanel>
    );
  }

  return (
    <div className="space-y-4">
      <AgentsCardGrid agents={resolvedData.agents} />
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-muted-foreground text-[10px] tabular-nums">
          {formatSnapshot(resolvedData.generatedAt)} UTC
        </p>
        <AgentsPagination input={input} data={resolvedData} />
      </div>
    </div>
  );
}

export function PublicRankingPage({
  input,
  data,
  summary,
}: {
  readonly input: PublicRankingInput;
  readonly data: Promise<PublicRankingPageData>;
  readonly summary: Promise<PublicRankingSummary>;
}) {
  return (
    <div className="space-y-5">
      <Suspense fallback={<AgentsIndexChromeFallback />}>
        <AgentsIndexChrome input={input} summary={summary} />
      </Suspense>

      <Suspense fallback={<AgentsResultsFallback />}>
        <AgentsIndexResults input={input} data={data} />
      </Suspense>
    </div>
  );
}
