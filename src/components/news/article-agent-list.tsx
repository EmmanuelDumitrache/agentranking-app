import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";
import type { ArticleAgent } from "@/lib/article-agents";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { PaymentPill } from "@/components/shared/payment-pill";
import { agentPublicPath } from "@/lib/agent-public-url";
interface ArticleAgentListProps {
  readonly agents: ArticleAgent[];
  /** Display rank numbers (1, 2, 3...) */
  readonly showRank?: boolean;
}
export function ArticleAgentList({ agents, showRank = true }: ArticleAgentListProps) {
  if (agents.length === 0) return null;
  return (
    <ol className="my-8 space-y-4 list-none" start={1}>
      {agents.map((agent, idx) => (
        <li
          key={agent.id}
          className="flex flex-wrap items-center gap-3 sm:gap-4 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
        >
          {showRank && (
            <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground font-semibold text-sm">
              {idx + 1}
            </span>
          )}
          <Link
            href={agentPublicPath(agent)}
            className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
          >
            <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted">
              {agent.image ? (
                <Image
                  src={agent.image}
                  alt={`${agent.name} — on-chain AI agent avatar`}
                  fill
                  className="object-cover"
                  sizes="40px"
                  unoptimized
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                  {agent.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground group-hover:text-primary transition-colors">
                {agent.name}
                {agent.isVerified && (
                  <span title="Verified">
                    <Shield className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  </span>
                )}
              </span>
              {agent.description && (
                <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                  {agent.description}
                </p>
              )}
            </div>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <AgentListChainCell chainId={agent.chainId} chain={agent.chain} icon={agent.chain.icon} />
            <span className="text-sm text-muted-foreground font-medium">
              Score: {Math.round(agent.score)}
            </span>
            <PaymentPill agent={agent} />
            <Link
              href={agentPublicPath(agent)}
              className="text-sm font-medium text-primary hover:underline"
            >
              View Agent →
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
