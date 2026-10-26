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
export function VerifiedDirectoryRow({
  agent,
  rank,
}: Readonly<{
  agent: VerifiedAgentRow;
  rank: number;
}>) {
  const serviceCount = agent.serviceCount ?? agent.services?.length ?? 0;
  const lastUpdated = verifiedListLastUpdated(agent);
  const x402Label = verifiedListX402Label(agent);
  const devProofLabel = verifiedListDevProofLabel(agent);
  const mcpCount = agent.publishedMcpOfferCount ?? 0;
  const href = agent.profilePath;
  return (
    <tr className="verified-directory-row">
      <td className="verified-directory-cell verified-directory-cell--rank">{rank}</td>
      <td className="verified-directory-cell verified-directory-cell--agent">
        <Link href={href} className="verified-directory-agent-link">
          <AgentAvatar
            image={agent.image}
            name={agent.name}
            size="sm"
            className="verified-directory-avatar"
          />
          <span className="verified-directory-agent-name">{agent.name}</span>
          <BadgeCheck className="verified-directory-verified-icon" aria-label="Verified" />
        </Link>
      </td>
      <td className="verified-directory-cell verified-directory-cell--chain">
        <div className="verified-directory-chain-wrap">
          <AgentListChainCell
            chainId={agent.chainId}
            chain={agent.chain}
            deploymentCount={agent.deploymentCount}
            chainLogoStack={agent.chainLogoStack}
            iconOnly
            size="sm"
          />
        </div>
      </td>
      <td className="verified-directory-cell verified-directory-cell--num">
        {verifiedListArScore(agent)}
      </td>
      <td className="verified-directory-cell verified-directory-cell--num">
        {serviceCount > 0 ? serviceCount : "—"}
      </td>
      <td className="verified-directory-cell verified-directory-cell--num">
        {mcpCount > 0 ? (
          <Link href={`${href}/mcp`} className="verified-text-link">
            {mcpCount}
          </Link>
        ) : (
          <span className="verified-directory-muted">—</span>
        )}
      </td>
      <td className="verified-directory-cell verified-directory-cell--center">
        <VerifiedStatusPill
          label={x402Label}
          active={Boolean(agent.x402Payable || agent.x402Detected || agent.x402Support)}
        />
      </td>
      <td className="verified-directory-cell verified-directory-cell--center">
        <VerifiedStatusPill
          label={devProofLabel}
          active={Boolean(agent.devProofActive || agent.githubConnected)}
        />
      </td>
      <td className="verified-directory-cell verified-directory-cell--meta">
        {lastUpdated ? timeAgo(lastUpdated) : "—"}
      </td>
    </tr>
  );
}
