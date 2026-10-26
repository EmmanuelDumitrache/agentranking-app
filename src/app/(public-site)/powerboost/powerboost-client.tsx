"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { PowerBoostData } from "@/app/(public-site)/powerboost/powerboost-types";
import { timeoutSignal } from "@/lib/timing/abort";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { AgentNameWithRank } from "@/components/shared/agent-name-with-rank";
import { DestinationCard, MetallicRankBadge } from "@/components/ui/card-21";
import { displayRank } from "@/lib/utils";
import { getChainByChainId } from "@/lib/chains";
import { resolveImageUrl } from "@/lib/image-utils";
import Link from "next/link";
import { STAKE_PAGE_HREF } from "@/lib/stake-page-href";
import { ChevronLeft, ChevronRight, Sparkles, ShieldCheck } from "lucide-react";
import { SapTag } from "@/components/agents/sap-tag";
import {
  formatDaoVoteBreakdownLine,
  getAttributableDaoVotes,
  powerBoostScoreVisible,
} from "@/lib/powerboost-payload";
function ReputationScoreCell({ agent }: { readonly agent: PowerBoostData["agents"][0] }) {
  const n = getAttributableDaoVotes({
    activeBoosts: agent.activeBoosts,
    adminPowerAdjust: agent.adminPowerAdjust,
    holderPowerBoostUnits: agent.holderPowerBoostUnits,
  });
  const breakdownLine = formatDaoVoteBreakdownLine({
    stakingVotes: agent.stakingVotes ?? agent.holderPowerBoostUnits ?? 0,
    paidBoostVotes: agent.paidBoostVotes ?? agent.activeBoosts ?? 0,
  });
  if (powerBoostScoreVisible(agent)) {
    return (
      <div className="inline-flex flex-col items-center gap-0.5 sm:items-start" title="Staker-backed reputation score">
        <span className="inline-flex items-center justify-center gap-1 font-bold text-sm text-amber-400 whitespace-nowrap">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {Math.round(n)}
        </span>
        {breakdownLine ? (
          <span className="text-[10px] leading-tight text-muted-foreground whitespace-nowrap">{breakdownLine}</span>
        ) : null}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
const TIME_OPTIONS = [
  { value: "12h", label: "12 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "week", label: "1 Week" },
  { value: "month", label: "1 Month" },
  { value: "all", label: "All Time" },
];
const DEFAULT_TOP_CARD_IMAGE =
  "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=900&auto=format&fit=crop&q=60";
const TOP3_THEME_HSL: Record<1 | 2 | 3, string> = {
  1: "43 88% 38%",
  2: "215 18% 42%",
  3: "28 72% 36%",
};
function ReputationTopCard({
  agent,
  place,
}: {
  readonly agent: PowerBoostData["agents"][0];
  readonly place: 1 | 2 | 3;
}) {
  const imageUrl = resolveImageUrl(agent.image) ?? DEFAULT_TOP_CARD_IMAGE;
  const href = agent.profilePath;
  const power = getAttributableDaoVotes({
    activeBoosts: agent.activeBoosts,
    adminPowerAdjust: agent.adminPowerAdjust,
    holderPowerBoostUnits: agent.holderPowerBoostUnits,
  });
  const backers = agent.holderPowerBoostBackerCount ?? 0;
  const stakingUnits = agent.stakingVotes ?? agent.holderPowerBoostUnits ?? 0;
  const breakdownLine = formatDaoVoteBreakdownLine({
    stakingVotes: stakingUnits,
    paidBoostVotes: agent.paidBoostVotes ?? agent.activeBoosts ?? 0,
  });
  const statsParts = [
    powerBoostScoreVisible(agent) ? `${power} reputation` : "No active reputation backing",
    breakdownLine,
    backers > 0 ? `${backers} staker${backers === 1 ? "" : "s"}` : null,
    `${agent.totalFeedback} feedback`,
    agent.chain.shortName,
  ].filter((p): p is string => Boolean(p));
  if (agent.hasDuplicateName && !agent.isPremiumVerified) {
    statsParts.push("⚠ duplicate name");
  }
  return (
    <div className="mx-auto h-[min(440px,70vh)] w-full max-w-[360px] min-h-[380px] sm:mx-0 sm:h-[440px] sm:max-w-none">
      <DestinationCard
        imageUrl={imageUrl}
        location={agent.name}
        rankPlace={place}
        stats={statsParts.join(" • ")}
        href={href}
        themeColor={TOP3_THEME_HSL[place]}
        ctaLabel="View agent"
      />
    </div>
  );
}
type PowerBoostClientProps = {
  readonly initialData: PowerBoostData;
  readonly initialDataUpdatedAt: number;
  readonly page: number;
  readonly timePeriod: string;
};
export function PowerBoostClient({
  initialData,
  initialDataUpdatedAt,
  page,
  timePeriod,
}: PowerBoostClientProps) {
  const router = useRouter();
  const navigate = (nextPage: number, nextPeriod = timePeriod) => {
    const params = new URLSearchParams();
    if (nextPage !== 1) params.set("page", String(nextPage));
    if (nextPeriod !== "all") params.set("period", nextPeriod);
    const query = params.toString();
    router.push(query ? `/powerboost?${query}` : "/powerboost", { scroll: false });
  };
  const handlePeriodChange = (value: string) => navigate(1, value);
  const { data, isLoading } = useQuery<PowerBoostData>({
    queryKey: ["powerboost", page, timePeriod],
    queryFn: async ({ signal }) => {
      const r = await fetch(
        `/api/powerboost?page=${page}&perPage=20&period=${timePeriod}`,
        { signal: timeoutSignal(60_000, signal) },
      );
      if (!r.ok) throw new Error(`PowerBoost request failed (${r.status})`);
      return (await r.json()) as PowerBoostData;
    },
    initialData,
    initialDataUpdatedAt,
    refetchOnMount: false,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30 * 1000,
  });
  const top3 = data?.agents.slice(0, page === 1 ? 3 : 0) || [];
  const tableAgents = data?.agents || [];
  return (
    <div className="px-4 pb-4 pt-0 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 md:h-6 md:w-6 text-yellow-400" />
            Reputation
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A community reputation score for agents. $AR stakers can back agents they trust—your stake adds weight and
            boosts their score on this board.
          </p>
        </div>
        <Select value={timePeriod} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-28 sm:w-32 bg-card border-border text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        className="-mx-4 mb-5 flex items-start justify-center gap-2 border-y border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-snug text-muted-foreground sm:items-center sm:text-xs md:mx-0 md:rounded-md md:border md:border-amber-500/20"
        role="note"
      >
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/90 sm:mt-0" aria-hidden />
        <p className="max-w-3xl text-center">
          Stake $AR behind agents, services, and listings you trust.{" "}
          <a href={STAKE_PAGE_HREF} className="font-medium text-amber-200/90 underline-offset-2 hover:text-amber-100 hover:underline">
            Stake now
          </a>{" "}
          to add staker-backed reputation weight.
        </p>
      </div>
      {!isLoading && data && data.total === 0 && (
        <div className="mb-8 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-foreground">No reputation-backed agents yet</p>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Once stakers or trusted signals back agents, they will appear here instantly.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="sm" variant="default">
              <a href={STAKE_PAGE_HREF}>Stake &amp; back reputation</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/powerboost" className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Boost visibility
              </Link>
            </Button>
          </div>
        </div>
      )}
      {page === 1 && top3.length >= 3 && (
        <div className="mb-10">
          <div className="flex flex-col gap-5 sm:hidden">
            <ReputationTopCard agent={top3[0]} place={1} />
            <ReputationTopCard agent={top3[1]} place={2} />
            <ReputationTopCard agent={top3[2]} place={3} />
          </div>
          <div className="hidden sm:grid sm:grid-cols-3 gap-5">
            <ReputationTopCard agent={top3[1]} place={2} />
            <ReputationTopCard agent={top3[0]} place={1} />
            <ReputationTopCard agent={top3[2]} place={3} />
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground text-xs w-16">Rank</th>
                <th className="sticky left-0 z-10 bg-muted/30 text-left py-2.5 px-3 font-medium text-muted-foreground text-xs border-r border-border/50">Agent</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium text-muted-foreground sm:text-left">
                  <span className="sm:hidden">Rep</span>
                  <span className="hidden sm:inline">Chain</span>
                </th>
                <th className="hidden text-center py-2.5 px-3 text-xs font-medium text-muted-foreground sm:table-cell">
                  Reputation
                </th>
                <th className="hidden text-center py-2.5 px-3 text-xs font-medium text-muted-foreground md:table-cell">
                  Stakers
                </th>
                <th className="hidden sm:table-cell text-center py-2.5 px-3 font-medium text-muted-foreground text-xs">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td colSpan={6} className="py-3 px-4">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                : tableAgents.map((agent) => (
                    <tr key={agent.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4">
                        {agent.rank <= 3 ? (
                          <MetallicRankBadge place={agent.rank as 1 | 2 | 3} compact />
                        ) : (
                          <span className="inline-flex h-7 w-7 items-center justify-center text-xs font-medium text-muted-foreground">
                            {displayRank(agent.rank)}
                          </span>
                        )}
                      </td>
                      <td className="sticky left-0 z-10 bg-card py-2.5 px-3 max-w-[200px] border-r border-border/50">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <AgentNameWithRank
                            name={agent.name}
                            rank={null}
                            image={agent.image}
                            chainId={agent.chainId}
                            agentId={agent.agentId}
                            href={agent.profilePath}
                            nameClassName="font-medium text-sm hover:text-primary transition-colors"
                            hasDuplicateName={agent.hasDuplicateName}
                            isVerified={agent.isVerified}
                            isPremiumVerified={agent.isPremiumVerified}
                          />
                          {agent.sapVerified || agent.sapTwinMatch ? <SapTag /> : null}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center sm:text-left">
                        <div className="sm:hidden">
                          <ReputationScoreCell agent={agent} />
                        </div>
                        <div className="hidden sm:flex sm:items-center sm:gap-1.5">
                          <AgentListChainCell
                            chainId={agent.chainId}
                            chain={agent.chain}
                            icon={getChainByChainId(agent.chainId)?.icon || agent.chain.icon}
                          />
                        </div>
                      </td>
                      <td className="hidden py-2.5 px-3 text-center sm:table-cell">
                        <ReputationScoreCell agent={agent} />
                      </td>
                      <td className="hidden py-2.5 px-3 text-center text-xs text-muted-foreground md:table-cell">
                        {(agent.holderPowerBoostBackerCount ?? 0) > 0 ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <span>{agent.holderPowerBoostBackerCount}</span>
                            {(agent.stakingVotes ?? agent.holderPowerBoostUnits ?? 0) > 0 ? (
                              <span className="text-[10px] text-amber-400/80">
                                +{agent.stakingVotes ?? agent.holderPowerBoostUnits} staking
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden sm:table-cell py-2.5 px-3 text-center text-xs text-muted-foreground">
                        {agent.totalFeedback}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate(page - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Previous</span>
          </Button>
          <span className="text-xs text-muted-foreground px-2 sm:hidden">
            {page}/{data.totalPages}
          </span>
          {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => i + 1).map((p) => (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              onClick={() => navigate(p)}
              className="w-8 h-8 hidden sm:inline-flex"
            >
              {p}
            </Button>
          ))}
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => navigate(page + 1)}>
            <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
