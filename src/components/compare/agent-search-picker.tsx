"use client";
import { useState } from "react";
import { Search, X, BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ChainBadge } from "@/components/shared/chain-badge";
import { cn } from "@/lib/utils";
import { getChainByChainId } from "@/lib/chains";
import type { CompareAgent } from "@/lib/compare-agent";
import { COMPARE_PREMIUM_NAME_STYLE } from "@/lib/compare-agent";
import { useCompareAgentSearch } from "@/hooks/use-compare-agent-search";
export function AgentSearchPicker({
  label,
  selected,
  onSelect,
  excludeIds = [],
}: {
  readonly label: string;
  readonly selected: CompareAgent | null;
  onSelect: (agent: CompareAgent | null) => void;
  readonly excludeIds?: number[];
}) {
  const [search, setSearch] = useState("");
  const { agents, queryReady, hint, isLoading, isFetched, isError, error } = useCompareAgentSearch(search);
  const excludeSet = new Set(excludeIds.filter((id) => Number.isFinite(id)));
  const results = agents.filter((a) => !excludeSet.has(a.id));
  const showDropdown = queryReady && (isLoading || isFetched || isError);
  const showEmpty = isFetched && !isLoading && !isError && results.length === 0;
  const clearSelection = () => {
    setSearch("");
    onSelect(null);
  };
  if (selected) {
    const chainData = getChainByChainId(selected.chainId) ?? selected.chain;
    const isVerifiedAny = selected.isVerified || selected.isPremiumVerified;
    const agentRankScore = Math.round(selected.agentRankScore ?? 0);
    const executionScore = Math.round(selected.executionScore ?? 0);
    return (
      <div
        className={cn(
          "compare-slot compare-slot--selected",
          selected.isPremiumVerified && "compare-slot--premium",
        )}
      >
        <div className="compare-slot-head">
          <span className="compare-slot-label">{label}</span>
          <button
            type="button"
            onClick={clearSelection}
            className="compare-slot-clear"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="compare-slot-agent">
          <AgentAvatar
            image={selected.image}
            name={selected.name}
            size="md"
            className="compare-slot-avatar"
          />
          <div className="compare-slot-agent-main">
            <p
              className="compare-slot-name"
              style={selected.isPremiumVerified ? COMPARE_PREMIUM_NAME_STYLE : undefined}
            >
              {selected.name}
            </p>
            <div className="compare-slot-badges">
              <ChainBadge
                name={chainData.shortName}
                color={chainData.color}
                icon={chainData.icon}
                size="sm"
              />
              {selected.isPremiumVerified ? (
                <span className="compare-slot-badge compare-slot-badge--premium">
                  <BadgeCheck className="h-2.5 w-2.5" />
                  Premium
                </span>
              ) : null}
              {!selected.isPremiumVerified && isVerifiedAny ? (
                <span className="compare-slot-badge compare-slot-badge--verified">
                  <BadgeCheck className="h-2.5 w-2.5" />
                  Verified
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="compare-slot-metrics">
          <div className="compare-slot-metric">
            <span className="compare-slot-metric-value">{agentRankScore}</span>
            <span className="compare-slot-metric-label">AR Score</span>
          </div>
          <div className="compare-slot-metric">
            <span
              className={cn(
                "compare-slot-metric-value compare-slot-metric-value--onchain",
                executionScore === 0 && "compare-slot-metric-value--muted",
              )}
            >
              {executionScore > 0 ? executionScore : "—"}
            </span>
            <span className="compare-slot-metric-label">On-chain</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="compare-slot">
      <span className="compare-slot-label">{label}</span>
      <div className="compare-slot-search-wrap">
        <div className="compare-slot-search">
          <Search className="compare-slot-search-icon" aria-hidden />
          <input
            type="search"
            placeholder="Search agent name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="compare-slot-search-input"
            aria-label={`Search ${label}`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls={`${label}-compare-results`}
            autoComplete="off"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="compare-slot-search-clear"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {showDropdown ? (
          <div
            id={`${label}-compare-results`}
            className="compare-slot-dropdown"
            role="listbox"
            aria-label={`${label} search results`}
          >
            {isLoading ? <p className="compare-slot-dropdown-hint">Searching…</p> : null}
            {isError ? (
              <p className="compare-slot-dropdown-hint compare-slot-dropdown-hint--error">
                {error ?? "Could not search agents. Try again."}
              </p>
            ) : null}
            {showEmpty ? (
              <p className="compare-slot-dropdown-hint">
                No agents found for &ldquo;{search.trim()}&rdquo;. Try another name or paste a wallet address.
              </p>
            ) : null}
            {results.length > 0 ? (
              <div className="compare-slot-results">
                {results.map((agent) => {
                  const chainData = getChainByChainId(agent.chainId) ?? agent.chain;
                  const isVerifiedAny = agent.isVerified || agent.isPremiumVerified;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        onSelect(agent);
                        setSearch("");
                      }}
                      className={cn(
                        "compare-slot-result",
                        agent.isPremiumVerified && "compare-slot-result--premium",
                      )}
                    >
                      <AgentAvatar
                        image={agent.image}
                        name={agent.name}
                        size="sm"
                        className="compare-slot-result-avatar"
                      />
                      <span
                        className="compare-slot-result-name"
                        style={agent.isPremiumVerified ? COMPARE_PREMIUM_NAME_STYLE : undefined}
                      >
                        {agent.name}
                      </span>
                      {agent.isPremiumVerified ? (
                        <BadgeCheck className="h-3 w-3 text-amber-400 shrink-0" />
                      ) : null}
                      {!agent.isPremiumVerified && isVerifiedAny ? (
                        <BadgeCheck className="h-3 w-3 text-amber-400/60 shrink-0" />
                      ) : null}
                      <ChainBadge
                        name={chainData.shortName}
                        color={chainData.color}
                        icon={chainData.icon}
                        size="sm"
                        iconOnly
                      />
                      <span
                        className={cn(
                          "compare-slot-result-score",
                          (agent.agentRankScore ?? 0) >= 70 && "compare-slot-result-score--high",
                          (agent.agentRankScore ?? 0) >= 40 &&
                            (agent.agentRankScore ?? 0) < 70 &&
                            "compare-slot-result-score--mid",
                        )}
                      >
                        {Math.round(agent.agentRankScore ?? 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {!queryReady && search.trim().length > 0 ? (
        <p className="compare-slot-hint">{hint}</p>
      ) : null}
      {!search.trim() ? (
        <p className="compare-slot-hint">Search by agent name, wallet, or listing ID.</p>
      ) : null}
    </div>
  );
}
