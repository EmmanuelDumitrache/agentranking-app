import { RuntimeImage } from "@/components/shared/runtime-image";
import Link from "next/link";
import { PublicAgentAvatar } from "@/components/public-site/token-avatar";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { PublicCredentialChip } from "@/components/public-site/public-credential-chip";
import type { PublicAgentIndexModel } from "@/lib/public-agents-index.server";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import { METAPLEX_PROTOCOL_LOGO } from "@/lib/agent-launch/launch-venue";
import { formatUsdCompact } from "@/lib/public-site/formatters";
import { cn, timeAgo } from "@/lib/utils";
type Props = {
  readonly agent: PublicAgentIndexModel;
  readonly badge?: string;
  readonly subtitle?: string;
  readonly rank?: number;
};
function TokenMeta({ agent }: { readonly agent: PublicAgentIndexModel }) {
  const token = agent.linkedToken;
  if (!token || !agent.linkedTokenChain || !agent.linkedTokenVenue) return null;
  const tokenLabel = token.tokenName || (token.tokenSymbol ? `$${token.tokenSymbol}` : "Token");
  const isRobinhood = agent.linkedTokenChain === "robinhood";
  const isMetaplex = agent.linkedTokenVenue === "Metaplex";
  return (
    <Link
      href={token.launchHref}
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] transition-colors hover:border-border"
    >
      <span className="text-muted-foreground">
        Token: <span className="font-medium text-foreground">{tokenLabel}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-foreground/70">
        {isRobinhood ? (
          <RobinhoodChainIcon className="h-3 w-3" />
        ) : isMetaplex ? (
          <RuntimeImage
            src={METAPLEX_PROTOCOL_LOGO}
            alt=""
            className="h-3 w-3 rounded-sm object-cover"
            aria-hidden
          />
        ) : (
          <RuntimeImage
            src="/brandkit/protocol-logos/pumpfun.png"
            alt=""
            className="h-3 w-3 rounded-sm object-cover"
            aria-hidden
          />
        )}
        {agent.linkedTokenVenue ?? (isRobinhood ? "Robinhood" : "Pump.fun")}
      </span>
    </Link>
  );
}
function StatCell({
  label,
  value,
  align = "left",
  mutedValue = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly align?: "left" | "right";
  readonly mutedValue?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[3.25rem] flex-col justify-center rounded-md border border-border/60 bg-muted/20 px-3 py-2",
        align === "right" && "text-right",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          mutedValue ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
export function AgentMarketCard({ agent, badge, subtitle, rank }: Props) {
  const linkedToken = agent.linkedToken;
  const mcap = agent.market?.marketCapUsd ?? agent.market?.fdvUsd;
  const volume24h = agent.market?.volume24hUsd;
  const verified = getPublicAgentVerificationStatus(agent).isVerified;
  const tokenized = Boolean(linkedToken);
  const agentRankScore =
    agent.agentRankScore == null ? "—" : agent.agentRankScore.toFixed(1);
  const lastActive = agent.lastActiveAt ? timeAgo(agent.lastActiveAt) : "—";
  const chainBadge = (badge ?? "AR Agent").trim() || "Agent";
  const chainSubtitle = subtitle ?? "AgentRanking native agent";
  return (
    <article className="ui-public-site-card relative flex h-full flex-col p-4">
      <div className="pointer-events-none absolute top-4 right-4 z-[1] flex items-center gap-1">
        {rank != null && rank > 0 ? (
          <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] font-medium tabular-nums text-muted-foreground">
            #{rank}
          </span>
        ) : null}
        <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          {chainBadge}
        </span>
        {tokenized ? (
          <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            Tokenized
          </span>
        ) : null}
      </div>
      <div className="min-w-0 pr-28">
        <div className="flex items-start gap-3">
          <Link href={agent.profileHref} className="shrink-0">
            <PublicAgentAvatar name={agent.name} imageUrl={agent.image} size="md" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={agent.profileHref} className="group block min-w-0">
              <div className="flex min-h-[1.375rem] min-w-0 items-center gap-1.5">
                <p className="truncate text-sm font-semibold group-hover:underline">{agent.name}</p>
                {verified ? <VerifiedTick size="sm" tone="foreground" /> : null}
                {agent.isSolanaDirectoryListed ? <RegisteredTick size="sm" /> : null}
              </div>
            </Link>
            {agent.credential.present ? (
              <div className="mt-1.5">
                <PublicCredentialChip credential={agent.credential} />
              </div>
            ) : null}
            <Link href={agent.profileHref} className="group block min-w-0">
              <p className="text-muted-foreground/60 mt-0.5 min-h-[1rem] truncate text-xs">
                {chainSubtitle}
              </p>
              <p className="text-muted-foreground mt-2 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed">
                {agent.description || "\u00A0"}
              </p>
            </Link>
          </div>
        </div>
      </div>
      <TokenMeta agent={agent} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {tokenized ? (
          <>
            <StatCell label="MCAP" value={formatUsdCompact(mcap)} mutedValue={mcap == null} />
            <StatCell
              label="Vol 24h"
              value={formatUsdCompact(volume24h)}
              align="right"
              mutedValue={volume24h == null || volume24h <= 0}
            />
          </>
        ) : (
          <>
            <StatCell
              label="AR Score"
              value={agentRankScore}
              mutedValue={agent.agentRankScore == null}
            />
            <StatCell label="Last active" value={lastActive} align="right" mutedValue={!agent.lastActiveAt} />
          </>
        )}
      </div>
      <div className="mt-auto flex min-h-[2.25rem] items-center justify-end gap-3 pt-4">
        {linkedToken ? (
          <Link href={linkedToken.launchHref} className="ui-public-site-accent text-xs font-semibold">
            Trade →
          </Link>
        ) : null}
        <Link href={agent.profileHref} className="ui-public-site-accent text-xs font-semibold">
          View →
        </Link>
      </div>
    </article>
  );
}
