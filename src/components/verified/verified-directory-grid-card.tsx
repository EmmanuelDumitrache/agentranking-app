import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { VerifiedStatusPill } from "@/components/verified/verified-status-pill";
import type { VerifiedAgentRow } from "@/components/verified/types";
import { timeAgo } from "@/lib/utils";
import {
  verifiedListArScore,
  verifiedListDevProofLabel,
  verifiedListLastUpdated,
  verifiedListX402Label,
} from "@/lib/verified-list-display";
export function VerifiedDirectoryGridCard({
  agent,
  rank,
}: Readonly<{
  agent: VerifiedAgentRow;
  rank: number;
}>) {
  const href = agent.profilePath;
  const serviceCount = agent.serviceCount ?? agent.services?.length ?? 0;
  const lastUpdated = verifiedListLastUpdated(agent);
  const mcpCount = agent.publishedMcpOfferCount ?? 0;
  return (
    <Link href={href} className="verified-directory-grid-card">
      <div className="verified-directory-grid-card-top">
        <span className="verified-directory-grid-card-rank">{rank}</span>
        {lastUpdated ? (
          <span className="verified-directory-grid-card-updated">{timeAgo(lastUpdated)}</span>
        ) : null}
      </div>
      <div className="verified-directory-grid-card-identity">
        <AgentAvatar
          image={agent.image}
          name={agent.name}
          size="md"
          className="verified-directory-grid-card-avatar"
        />
        <div className="min-w-0 flex-1">
          <div className="verified-directory-grid-card-name-row">
            <span className="verified-directory-grid-card-name">{agent.name}</span>
            <BadgeCheck className="verified-directory-verified-icon" aria-hidden />
          </div>
          <AgentListChainCell
            chainId={agent.chainId}
            chain={agent.chain}
            deploymentCount={agent.deploymentCount}
            chainLogoStack={agent.chainLogoStack}
            iconOnly
            size="sm"
          />
        </div>
      </div>
      <div className="verified-directory-grid-card-metrics">
        <div className="verified-directory-grid-card-metric">
          <span className="verified-directory-grid-card-metric-label">AR</span>
          <span className="verified-directory-grid-card-metric-value">
            {verifiedListArScore(agent)}
          </span>
        </div>
        <div className="verified-directory-grid-card-metric">
          <span className="verified-directory-grid-card-metric-label">Services</span>
          <span className="verified-directory-grid-card-metric-value">
            {serviceCount > 0 ? serviceCount : "—"}
          </span>
        </div>
        <div className="verified-directory-grid-card-metric">
          <span className="verified-directory-grid-card-metric-label">MCP</span>
          <span className="verified-directory-grid-card-metric-value">
            {mcpCount > 0 ? (
              <span className="verified-directory-grid-card-mcp">{mcpCount}</span>
            ) : (
              <span className="verified-directory-muted">—</span>
            )}
          </span>
        </div>
      </div>
      <div className="verified-directory-grid-card-pills">
        <VerifiedStatusPill
          label={verifiedListX402Label(agent)}
          active={Boolean(agent.x402Payable || agent.x402Detected || agent.x402Support)}
        />
        <VerifiedStatusPill
          label={verifiedListDevProofLabel(agent)}
          active={Boolean(agent.devProofActive || agent.githubConnected)}
        />
      </div>
    </Link>
  );
}
