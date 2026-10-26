"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PublicFeedbackPageData, PublicFeedbackQuery, PublicFeedbackSource } from "@/lib/agent-directory/feedback";
import { publicFeedbackQueryKey } from "@/lib/agent-directory/feedback";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { truncateAddress, cn } from "@/lib/utils";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import {
  Search, MessageSquare, Users, Clock, ChevronLeft, ChevronRight,
} from "lucide-react";
import { AgentNameWithRank } from "@/components/shared/agent-name-with-rank";
import { ProfileHoverCard } from "@/components/shared/profile-hover-card";
import Link from "next/link";
import { getChainByChainId } from "@/lib/chains";
export function FeedbackPageClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: PublicFeedbackPageData;
  readonly initialQuery: PublicFeedbackQuery;
}) {
  const [page, setPage] = useState(initialQuery.page);
  const [search, setSearch] = useState(initialQuery.search);
  const [sort, setSort] = useState(initialQuery.sort);
  const [filterSource, setFilterSource] = useState<PublicFeedbackSource>(initialQuery.source);
  const currentQuery: PublicFeedbackQuery = { page, perPage: initialQuery.perPage, search, sort, source: filterSource };
  const initialKey = publicFeedbackQueryKey(initialQuery);
  const isInitialQuery = publicFeedbackQueryKey(currentQuery).every(
    (part, index) => part === initialKey[index],
  );
  const { data, isLoading } = useQuery<PublicFeedbackPageData>({
    queryKey: publicFeedbackQueryKey(currentQuery),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), perPage: String(initialQuery.perPage), sort });
      if (search) params.set("search", search);
      if (filterSource !== "all") params.set("source", filterSource);
      return fetch(`/api/feedback?${params}`, { signal }).then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load feedback (${response.status})`);
        const payload = (await response.json()) as Omit<PublicFeedbackPageData, "generatedAt"> &
          Partial<Pick<PublicFeedbackPageData, "generatedAt">>;
        return { ...payload, generatedAt: payload.generatedAt ?? new Date().toISOString() };
      });
    },
    initialData: isInitialQuery ? initialData : undefined,
    initialDataUpdatedAt: isInitialQuery ? Date.parse(initialData.generatedAt) : undefined,
    refetchOnMount: false,
  });
  const feedbacks = data?.feedbacks ?? [];
  return (
    <div className="px-4 pb-4 pt-0 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg md:text-xl font-bold">Feedback Registry</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          All on-chain and platform reviews for registered agents
        </p>
      </div>
      {/* Stats row */}
      {data?.stats && (
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold">{data.stats.total.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">total reviews</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
            <Users className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-sm font-semibold">{data.stats.uniqueUsers.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">reviewers</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
            <Clock className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-sm font-semibold">{data.stats.last24h}</span>
            <span className="text-[10px] text-muted-foreground">last 24h</span>
          </div>
        </div>
      )}
      {/* Search, filter & sort */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by wallet address or agent name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 bg-card border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterSource} onValueChange={(v: "all" | "onchain" | "platform") => { setFilterSource(v); setPage(1); }}>
            <SelectTrigger className="w-32 bg-card border-border text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="onchain">On-chain</SelectItem>
              <SelectItem value="platform">AgentRanking</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value: string) => { setSort(value === "oldest" ? "oldest" : "newest"); setPage(1); }}>
            <SelectTrigger className="w-28 bg-card border-border text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="py-3 px-4 text-left font-medium text-muted-foreground text-xs">Agent</th>
                <th className="py-3 px-3 text-left font-medium text-muted-foreground text-xs hidden sm:table-cell">Chain</th>
                <th className="py-3 px-3 text-left font-medium text-muted-foreground text-xs">Reviewer</th>
                <th className="py-3 px-3 text-left font-medium text-muted-foreground text-xs hidden md:table-cell">Tags</th>
                <th className="py-3 px-3 text-left font-medium text-muted-foreground text-xs hidden lg:table-cell">Comment</th>
                <th className="py-3 px-4 text-right font-medium text-muted-foreground text-xs">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && ["f0","f1","f2","f3","f4","f5","f6","f7"].map((k) => (
                <tr key={k} className="border-b border-border">
                  <td colSpan={6} className="py-3 px-4">
                    <div className="h-4 bg-muted rounded animate-pulse" />
                  </td>
                </tr>
              ))}
              {!isLoading && feedbacks.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-sm text-muted-foreground">
                    No feedback found.
                  </td>
                </tr>
              )}
              {!isLoading && feedbacks.map((fb) => {
                    const isARFeedback = fb.normalized.source === "site";
                    return (
                      <tr
                        key={fb.id}
                        className={cn(
                          "border-b border-border hover:bg-muted/20 transition-colors",
                          isARFeedback && "border-l-2 border-l-green-500/40 bg-green-500/5"
                        )}
                      >
                        <td className="py-2.5 px-4 max-w-[180px]">
                          <AgentNameWithRank
                            name={fb.agent.name}
                            rank={fb.agent.rank}
                            chainId={fb.agent.chainId}
                            agentId={fb.agent.agentId}
                            href={fb.agent.profilePath}
                            showAvatar={false}
                            nameClassName="font-medium text-xs hover:text-primary transition-colors truncate block max-w-[160px]"
                          />
                        </td>
                        <td className="py-2.5 px-3 hidden sm:table-cell">
                          <AgentListChainCell
                            chainId={fb.agent.chainId}
                            chain={fb.agent.chain}
                            icon={getChainByChainId(fb.agent.chainId)?.icon || fb.agent.chain.icon}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            {isARFeedback && (
                              <RuntimeImage src="/logo-icon.png" alt="AgentRanking" className="h-3.5 w-3.5 rounded-sm shrink-0" />
                            )}
                            <ProfileHoverCard address={fb.clientAddress}>
                              <Link
                                href={`/profiles/${fb.clientAddress}`}
                                className="text-[11px] text-muted-foreground font-mono hover:text-foreground transition-colors"
                              >
                                {truncateAddress(fb.clientAddress, 4)}
                              </Link>
                            </ProfileHoverCard>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 hidden md:table-cell">
                          <div className="flex items-center gap-1 flex-wrap">
                            {fb.tag1 && (
                              <span className={cn("text-[10px] rounded-full px-2 py-0.5 font-medium", isARFeedback ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground")}>
                                {fb.tag1}
                              </span>
                            )}
                            {fb.tag2 && (
                              <span className={cn("text-[10px] rounded-full px-2 py-0.5 font-medium", isARFeedback ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground")}>
                                {fb.tag2}
                              </span>
                            )}
                            {!fb.tag1 && !fb.tag2 && (
                              <span className="text-[10px] text-muted-foreground/50">—</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 hidden lg:table-cell max-w-[200px]">
                          {fb.comment ? (
                            <p className="text-xs text-muted-foreground line-clamp-1">{fb.comment}</p>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                          {new Date(fb.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-4">
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          {Array.from({ length: Math.min(7, data.totalPages) }, (_, i) => {
            let p: number;
            if (data.totalPages <= 7) {
              p = i + 1;
            } else if (page <= 4) {
              p = i + 1;
            } else if (page >= data.totalPages - 3) {
              p = data.totalPages - 6 + i;
            } else {
              p = page - 3 + i;
            }
            return (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                onClick={() => setPage(p)}
                className="h-8 w-8 p-0 text-xs"
              >
                {p}
              </Button>
            );
          })}
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
