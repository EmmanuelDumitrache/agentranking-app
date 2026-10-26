"use client";
import Image from "next/image";
import Link from "next/link";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { METAPLEX_LOGO_SRC } from "@/lib/metaplex/urls";
import { ScoreDisplay } from "@/components/shared/score-display";
import { MetaplexBoundTokenChip, MetaplexRegisteredChip } from "@/components/agents/metaplex-tag";
import { cn } from "@/lib/utils";
export type MetaplexAgentCardRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  agentRankScore: number;
  profilePath: string;
  metaplexVerified?: boolean;
  metaplexAgentTokenMint?: string | null;
  metaplexAssetAddress?: string | null;
  services?: Array<{ name: string }>;
};
function shortenAddress(value: string | null | undefined, chars = 4): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length <= chars * 2 + 3) return v;
  return `${v.slice(0, chars)}…${v.slice(-chars)}`;
}
export function MetaplexAgentCard({ agent }: { readonly agent: MetaplexAgentCardRow }) {
  const href = agent.profilePath;
  const servicesCount = agent.services?.length ?? 0;
  const asset = shortenAddress(agent.metaplexAssetAddress);
  const token = shortenAddress(agent.metaplexAgentTokenMint);
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-full flex-col rounded-2xl border border-border/65 bg-card/45 p-3.5 transition-colors",
        "hover:border-violet-500/35 hover:bg-violet-500/[0.045]",
      )}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} image={agent.image} size="md" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold group-hover:text-violet-100">
            <Image
              src={METAPLEX_LOGO_SRC}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 shrink-0 rounded-sm object-contain opacity-90"
              unoptimized
            />
            {agent.name}
          </p>
          {agent.description ? (
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {agent.description}
            </p>
          ) : null}
        </div>
        <div className="rounded-full border border-border/45 bg-background/45 px-2 py-1">
          <ScoreDisplay score={agent.agentRankScore} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {agent.metaplexVerified ? <MetaplexRegisteredChip /> : null}
        {agent.metaplexAgentTokenMint ? <MetaplexBoundTokenChip /> : null}
        {servicesCount > 0 ? (
          <span className="inline-flex h-6 items-center rounded border border-sky-500/35 bg-sky-950/30 px-1.5 text-[10px] text-sky-200">
            {servicesCount} svc
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-1 font-mono text-[10px] text-muted-foreground">
        {asset ? (
          <p className="rounded-md border border-border/45 bg-background/40 px-2 py-1">
            Asset <span className="text-foreground/75">{asset}</span>
          </p>
        ) : null}
        {token ? (
          <p className="rounded-md border border-border/45 bg-background/40 px-2 py-1">
            Token <span className="text-foreground/75">{token}</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}
