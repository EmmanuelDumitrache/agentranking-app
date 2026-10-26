"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, GitCompare } from "lucide-react";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { AgentSearchPicker } from "@/components/compare/agent-search-picker";
import { CompareRow } from "@/components/compare/compare-row";
import { cn, displayRank } from "@/lib/utils";
import {
  TRUST_COMPARE_ROWS,
  compareAgentReference,
  trustDimensionValue,
  type CompareAgent,
} from "@/lib/compare-agent";
function CompareVerdict({ agentA, agentB }: { readonly agentA: CompareAgent; readonly agentB: CompareAgent }) {
  const verdictAgent =
    (agentA.agentRankScore ?? 0) >= (agentB.agentRankScore ?? 0) ? agentA : agentB;
  const score = Math.round(verdictAgent.agentRankScore ?? 0);
  return (
    <div className="compare-verdict">
      <div className="compare-verdict-main">
        <p className="compare-verdict-label">Stronger overall profile</p>
        <p className="compare-verdict-name">{verdictAgent.name}</p>
        <div className="compare-verdict-badges">
          {verdictAgent.isVerifiedRevenue ? (
            <span className="compare-verdict-badge compare-verdict-badge--success">Verified revenue</span>
          ) : null}
          {(verdictAgent.isVerified || verdictAgent.isPremiumVerified) && (
            <span className="compare-verdict-badge compare-verdict-badge--verified">Verified</span>
          )}
          {verdictAgent.agentMode && verdictAgent.agentMode !== "unknown" ? (
            <span className="compare-verdict-badge capitalize">{verdictAgent.agentMode}</span>
          ) : null}
        </div>
      </div>
      <div className="compare-verdict-scores">
        <div className="compare-verdict-score">
          <span className={cn("compare-verdict-score-value", score >= 70 && "compare-verdict-score-value--high")}>
            {score}
          </span>
          <span className="compare-verdict-score-label">AR</span>
        </div>
        {(verdictAgent.executionScore ?? 0) > 0 ? (
          <div className="compare-verdict-score">
            <span className="compare-verdict-score-value compare-verdict-score-value--onchain">
              {Math.round(verdictAgent.executionScore ?? 0)}
            </span>
            <span className="compare-verdict-score-label">On-chain</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
function CompareTable({ agentA, agentB }: { readonly agentA: CompareAgent; readonly agentB: CompareAgent }) {
  return (
    <div className="compare-panel">
      <div className="compare-table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="compare-table-dim">Dimension</th>
              <th className="compare-table-agent">
                <Link
                  href={agentA.profilePath}
                  className="compare-table-agent-link"
                >
                  {agentA.name}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                </Link>
              </th>
              <th className="compare-table-agent">
                <Link
                  href={agentB.profilePath}
                  className="compare-table-agent-link"
                >
                  {agentB.name}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                </Link>
              </th>
            </tr>
          </thead>
          <tbody>
            <CompareRow
              label="AR Score"
              a={agentA.agentRankScore ?? 0}
              b={agentB.agentRankScore ?? 0}
              render={(v) => (
                <span
                  className={cn(
                    "compare-table-num",
                    typeof v === "number" && v >= 70 && "compare-table-num--high",
                    typeof v === "number" && v >= 40 && v < 70 && "compare-table-num--mid",
                    typeof v === "number" && v < 40 && "compare-table-num--low",
                  )}
                >
                  {typeof v === "number" ? Math.round(v) : "—"}
                </span>
              )}
            />
            <CompareRow
              label="Execution Score"
              a={agentA.executionScore ?? 0}
              b={agentB.executionScore ?? 0}
              render={(v) =>
                typeof v === "number" && v > 0 ? (
                  <span className="compare-table-num compare-table-num--onchain">{Math.round(v)}</span>
                ) : (
                  <span className="compare-table-empty">—</span>
                )
              }
            />
            <CompareRow
              label="Rank"
              a={agentA.rank ?? null}
              b={agentB.rank ?? null}
              render={(v) => (typeof v === "number" ? displayRank(v) : "—")}
            />
            <CompareRow label="Reviews" a={agentA.totalFeedback} b={agentB.totalFeedback} />
            {TRUST_COMPARE_ROWS.map(({ label: rowLabel, dim }) => (
              <CompareRow
                key={dim}
                label={rowLabel}
                a={trustDimensionValue(agentA, dim)}
                b={trustDimensionValue(agentB, dim)}
                render={(v) => (
                  <span
                    className={cn(
                      typeof v === "number" && v >= 70 && "compare-table-num--high",
                      typeof v === "number" && v >= 40 && v < 70 && "compare-table-num--mid",
                    )}
                  >
                    {typeof v === "number" ? Math.round(v) : "—"}
                  </span>
                )}
              />
            ))}
            <CompareRow
              label="Activity (not in trust score)"
              a={agentA.scoreActivity ?? null}
              b={agentB.scoreActivity ?? null}
              render={(v) => (
                <span
                  className={cn(
                    typeof v === "number" && v >= 70 && "compare-table-num--high",
                    typeof v === "number" && v >= 40 && v < 70 && "compare-table-num--mid",
                  )}
                >
                  {typeof v === "number" ? Math.round(v) : "—"}
                </span>
              )}
            />
            <CompareRow
              label="Verified"
              a={agentA.isVerified || agentA.isPremiumVerified ? "Yes" : "No"}
              b={agentB.isVerified || agentB.isPremiumVerified ? "Yes" : "No"}
            />
            <CompareRow label="Chain" a={agentA.chain.name} b={agentB.chain.name} />
            <CompareRow
              label="X402 Payments"
              a={agentA.x402Support ? "Supported" : "—"}
              b={agentB.x402Support ? "Supported" : "—"}
            />
            <CompareRow
              label="Binance Compat."
              a={agentA.binanceCompatible ? "Yes" : "—"}
              b={agentB.binanceCompatible ? "Yes" : "—"}
            />
            <CompareRow
              label="Protocols"
              a={(agentA.services ?? []).map((s) => s.name).join(", ") || "—"}
              b={(agentB.services ?? []).map((s) => s.name).join(", ") || "—"}
            />
            <CompareRow
              label="Mode"
              a={agentA.agentMode && agentA.agentMode !== "unknown" ? agentA.agentMode : "—"}
              b={agentB.agentMode && agentB.agentMode !== "unknown" ? agentB.agentMode : "—"}
            />
            <CompareRow
              label="Win Rate"
              a={
                agentA.perfWinRate != null || agentA.activeWinRate30d != null
                  ? Math.round(((agentA.perfWinRate ?? agentA.activeWinRate30d) ?? 0) * 100)
                  : null
              }
              b={
                agentB.perfWinRate != null || agentB.activeWinRate30d != null
                  ? Math.round(((agentB.perfWinRate ?? agentB.activeWinRate30d) ?? 0) * 100)
                  : null
              }
              render={(v) =>
                typeof v === "number" ? (
                  <span
                    className={cn(
                      "compare-table-num",
                      v >= 60 && "compare-table-num--high",
                      v >= 40 && v < 60 && "compare-table-num--mid",
                      v < 40 && "compare-table-num--low",
                    )}
                  >
                    {v}%
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <CompareRow
              label="Monthly PnL"
              a={agentA.perfMonthlyPnlUsd ?? null}
              b={agentB.perfMonthlyPnlUsd ?? null}
              render={(v) =>
                typeof v === "number"
                  ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "—"
              }
            />
            <CompareRow
              label="Total Volume"
              a={agentA.perfTotalVolumeUsd ?? null}
              b={agentB.perfTotalVolumeUsd ?? null}
              render={(v) =>
                typeof v === "number"
                  ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "—"
              }
            />
            <CompareRow
              label="Burn-to-Earn"
              a={agentA.perfBurnToEarnRatio ?? null}
              b={agentB.perfBurnToEarnRatio ?? null}
              render={(v) => (typeof v === "number" ? v.toFixed(2) : "—")}
            />
            <CompareRow
              label="Verified Revenue"
              a={agentA.isVerifiedRevenue ? "Yes" : "No"}
              b={agentB.isVerifiedRevenue ? "Yes" : "No"}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function ComparePageClient({
  initialAgentA,
  initialAgentB,
}: {
  readonly initialAgentA: CompareAgent | null;
  readonly initialAgentB: CompareAgent | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agentA, setAgentA] = useState<CompareAgent | null>(initialAgentA);
  const [agentB, setAgentB] = useState<CompareAgent | null>(initialAgentB);
  const replaceSelection = (nextA: CompareAgent | null, nextB: CompareAgent | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextA) params.set("a", compareAgentReference(nextA));
    else params.delete("a");
    if (nextB) params.set("b", compareAgentReference(nextB));
    else params.delete("b");
    const query = params.toString();
    router.replace(query ? `/compare?${query}` : "/compare", { scroll: false });
  };
  const selectAgentA = (next: CompareAgent | null) => {
    setAgentA(next);
    replaceSelection(next, agentB);
  };
  const selectAgentB = (next: CompareAgent | null) => {
    setAgentB(next);
    replaceSelection(agentA, next);
  };
  const bothSelected = agentA != null && agentB != null;
  return (
    <PublicSitePageShell fullBleed className="compare-page">
      <div className="compare-shell">
        <header className="compare-header">
          <div className="compare-header-main">
            <h1 className="compare-header-title">Compare Agents</h1>
            <p className="compare-header-sub">
              Side-by-side trust scores, protocol integrations, payment readiness, and reputation signals.
            </p>
            <p className="compare-header-meta">
              <Link href="/agents" className="compare-header-back">
                ← Back to agent directory
              </Link>
            </p>
          </div>
          <div className="compare-header-icon" aria-hidden>
            <GitCompare className="h-4 w-4" />
          </div>
        </header>
        <div className="compare-picker-grid">
          <AgentSearchPicker
            label="Agent A"
            selected={agentA}
            onSelect={selectAgentA}
            excludeIds={agentB?.id != null ? [agentB.id] : []}
          />
          <AgentSearchPicker
            label="Agent B"
            selected={agentB}
            onSelect={selectAgentB}
            excludeIds={agentA?.id != null ? [agentA.id] : []}
          />
        </div>
        {bothSelected ? (
          <>
            <CompareVerdict agentA={agentA} agentB={agentB} />
            <CompareTable agentA={agentA} agentB={agentB} />
          </>
        ) : (
          <div className="compare-empty">
            <GitCompare className="compare-empty-icon" aria-hidden />
            <p className="compare-empty-title">
              {agentA || agentB ? "Select the second agent" : "Select two agents to compare"}
            </p>
            <p className="compare-empty-desc">
              {agentA || agentB
                ? "Pick another agent in the open slot above to run the side-by-side table."
                : "Search by name in each slot above, then click a result."}
            </p>
          </div>
        )}
      </div>
    </PublicSitePageShell>
  );
}
