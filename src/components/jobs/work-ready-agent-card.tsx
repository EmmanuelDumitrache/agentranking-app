"use client";
import Link from "next/link";
import { BadgeCheck, ExternalLink, Shield, Wallet } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ArchetypePill } from "@/components/shared/archetype-pill";
import { WorkReadyBadge } from "@/components/jobs/work-ready-badge";
import { JobsStatusPill } from "@/components/jobs/jobs-status-pill";
import { trackJobEvent } from "@/lib/jobs/track-client";
import type { PublicWorkReadyAgent } from "@/lib/jobs/work-ready-public";
export type WorkReadyAgentCardData = PublicWorkReadyAgent;
export function WorkReadyAgentCard({ agent }: { readonly agent: WorkReadyAgentCardData }) {
  const href = agent.profilePath;
  return (
    <article className="jobs-work-ready-card">
      <div className="jobs-work-ready-card-top">
        <AgentAvatar image={agent.image} name={agent.name} size="sm" className="jobs-work-ready-avatar" />
        <div className="min-w-0 flex-1">
          <div className="jobs-work-ready-name-row">
            <h3 className="jobs-work-ready-name">{agent.name}</h3>
            {agent.isPremiumVerified || agent.isVerified ? (
              <BadgeCheck className="jobs-work-ready-verified" aria-hidden />
            ) : null}
            <WorkReadyBadge
              agent={{
                workReadyStatus: agent.workReadyStatus,
                featuredWorkReady: agent.featuredWorkReady,
              }}
            />
          </div>
          {agent.featuredWorkReady ? (
            <p className="jobs-work-ready-featured">Featured by AgentRanking</p>
          ) : null}
          <p className="jobs-work-ready-desc">
            {agent.description || "Verified agent available for campaigns, tasks, and execution workflows."}
          </p>
          <div className="jobs-work-ready-meta-row">
            {agent.archetype ? <ArchetypePill archetype={agent.archetype} /> : null}
            <span className="jobs-work-ready-ar">AR {agent.agentRankScore}</span>
          </div>
          <div className="jobs-work-ready-signals">
            {agent.hasDevProof ? (
              <JobsStatusPill label="DevProof" muted className="jobs-work-ready-signal" />
            ) : null}
            {agent.hasWallet ? (
              <span className="jobs-work-ready-signal-icon">
                <Wallet className="h-3 w-3" aria-hidden /> Wallet
              </span>
            ) : null}
            {agent.hasOnChain ? (
              <span className="jobs-work-ready-signal-icon">
                <Shield className="h-3 w-3" aria-hidden /> On-chain
              </span>
            ) : null}
            {agent.hasX402 ? <JobsStatusPill label="x402" muted className="jobs-work-ready-signal" /> : null}
          </div>
        </div>
      </div>
      <Link
        href={href}
        onClick={() => {
          void trackJobEvent({
            eventType: "work_ready_agent_clicked",
            agentId: agent.id,
          });
        }}
        className="jobs-text-link jobs-work-ready-link"
      >
        View agent
        <ExternalLink className="h-3 w-3" aria-hidden />
      </Link>
    </article>
  );
}