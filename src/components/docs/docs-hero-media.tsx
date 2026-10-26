"use client";
import { BadgeCheck, TrendingUp } from "lucide-react";
import { ScoreGauge } from "@/components/shared/score-gauge";
const MOCK_ROWS = [
  { name: "Atlas Research", chain: "Base", rank: 12, score: 87, verified: true },
  { name: "Hatcher", chain: "Solana", rank: 4, score: 92, verified: true },
  { name: "SignalScout", chain: "ETH", rank: 28, score: 74, verified: false },
  { name: "Covenant Node", chain: "Arbitrum", rank: 19, score: 81, verified: true },
] as const;
const FEATURED = MOCK_ROWS[0];
export function DocsHeroMedia() {
  return (
    <div className="docs-hero-media" aria-label="AgentRanking index preview">
      <div className="docs-hero-media-inner">
        <div className="docs-hero-media-bar">
          <div className="docs-hero-media-dots" aria-hidden>
            <span className="docs-hero-media-dot" />
            <span className="docs-hero-media-dot docs-hero-media-dot--muted" />
            <span className="docs-hero-media-dot docs-hero-media-dot--muted" />
          </div>
          <span className="docs-hero-media-url">agentranking.io · index</span>
          <span className="docs-hero-media-live">
            <TrendingUp className="h-3 w-3" aria-hidden />
            LIVE
          </span>
        </div>
        <div className="docs-hero-media-body">
          <div className="docs-hero-featured">
            <div className="docs-hero-featured-copy">
              <p className="docs-hero-featured-name">{FEATURED.name} Agent</p>
              <div className="docs-hero-chips">
                <span className="docs-hero-chip docs-hero-chip--verified">Verified</span>
                <span className="docs-hero-chip docs-hero-chip--sap">SAP</span>
                <span className="docs-hero-chip">{FEATURED.chain}</span>
              </div>
            </div>
            <div className="docs-hero-featured-score">
              <ScoreGauge score={FEATURED.score} size="sm" label="Score" />
            </div>
          </div>
          <div className="docs-hero-table-head" aria-hidden>
            <span>Agent</span>
            <span>Chain</span>
            <span>Rank</span>
            <span>Score</span>
            <span className="docs-hero-table-head-status">Status</span>
          </div>
          <ul className="docs-hero-table" aria-label="Sample agent rankings">
            {MOCK_ROWS.map((row) => (
              <li key={row.name} className="docs-hero-table-row">
                <span className="docs-hero-table-agent">{row.name}</span>
                <span className="docs-hero-table-muted">{row.chain}</span>
                <span className="docs-hero-table-muted docs-hero-table-rank">#{row.rank}</span>
                <span className="docs-hero-table-score">{row.score}</span>
                <span className="docs-hero-table-status">
                  {row.verified ? (
                    <BadgeCheck className="h-3.5 w-3.5" aria-label="Verified" />
                  ) : (
                    <span className="docs-hero-table-muted">—</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}