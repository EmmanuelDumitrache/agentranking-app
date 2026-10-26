import { RuntimeImage } from "@/components/shared/runtime-image";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck } from "lucide-react";
import type { PublicAgentPreview } from "@/lib/public-site/types";
import { PublicAgentAvatar } from "@/components/public-site/token-avatar";
import { CardSocialIcons } from "@/components/public-site/card-social-icons";
import { PublicCredentialChip } from "@/components/public-site/public-credential-chip";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import { timeAgo } from "@/lib/utils";
import { METAPLEX_PROTOCOL_LOGO } from "@/lib/agent-launch/launch-venue";
type Props = {
  readonly agent: PublicAgentPreview;
};
/** Inline SVG circular progress ring. 0–100 mapped to circumference. */
function AgentRankScoreRing({ score }: { readonly score: number | null }) {
  if (score == null) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/40 text-[10px] text-muted-foreground">
        —
      </div>
    );
  }
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0" aria-label={`AR Score ${score.toFixed(1)}`}>
      <circle
        cx="20" cy="20" r={radius}
        fill="none"
        stroke="var(--app-border)"
        strokeWidth="3"
      />
      <circle
        cx="20" cy="20" r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 20 20)"
        className="text-foreground transition-[stroke-dashoffset] duration-500"
      />
      <text
        x="20" y="21.5"
        textAnchor="middle"
        className="fill-foreground text-[10px] font-semibold"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {Math.round(clamped)}
      </text>
    </svg>
  );
}
export function PublicAgentPreviewCard({ agent }: Props) {
  const v = getPublicAgentVerificationStatus(agent);
  const verified = v.isVerified;
  const socials = agent.socials ?? { twitter: null, telegram: null, website: null };
  const ctaHref = agent.linkedTokenHref || agent.profileHref;
  const ctaLabel =
    agent.linkedTokenHref && agent.linkedTokenLabel
      ? agent.linkedTokenLabel
      : "View agent →";
  return (
    <article className="ui-public-site-card group relative flex h-full min-h-[16.5rem] flex-col p-3 transition-colors hover:border-[var(--app-border-strong)]">
      <CardSocialIcons socials={socials} />
      <div className="min-w-0">
        <Link href={agent.profileHref} className="block min-w-0">
          <div className="flex min-h-[3.25rem] items-start gap-3 pr-14">
            <PublicAgentAvatar name={agent.name} imageUrl={agent.image} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex h-5 items-center gap-1.5">
                <p className="truncate text-sm font-semibold leading-none">{agent.name}</p>
                {verified ? (
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-foreground/60" aria-hidden />
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 h-4 truncate text-[11px] leading-none">
                {agent.tokenized ? "Tokenized" : "No token"} · {v.label}
              </p>
            </div>
          </div>
        </Link>
        {agent.credential?.present ? (
          <div className="mt-2">
            <PublicCredentialChip credential={agent.credential} />
          </div>
        ) : null}
        <Link href={agent.profileHref} className="block min-w-0">
          <div className="text-muted-foreground mt-2 min-h-[2.5rem] text-sm leading-relaxed line-clamp-2">
            {agent.description?.trim() ? agent.description : "\u00A0"}
          </div>
        </Link>
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-3">
        <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
          <div className="flex items-center gap-2.5">
            <AgentRankScoreRing score={agent.agentRankScore} />
            <span className="text-muted-foreground text-[10px] uppercase leading-tight">
              AR
              <br />
              Score
            </span>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground block text-[10px] uppercase">Active</span>
            <span className="text-xs tabular-nums">
              {agent.lastActiveAt ? timeAgo(agent.lastActiveAt) : "—"}
            </span>
          </div>
        </div>
        <div className="flex h-5 items-center justify-between border-t border-border/60 pt-3">
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
            {agent.linkedTokenVenue === "Metaplex" ? (
              <RuntimeImage
                src={METAPLEX_PROTOCOL_LOGO}
                alt=""
                width={14}
                height={14}
                className="shrink-0 rounded-sm object-cover opacity-80"
                aria-hidden
              />
            ) : (
              <Image
                src="/ar-mark.png"
                alt=""
                width={14}
                height={14}
                className="shrink-0 opacity-50"
                aria-hidden
              />
            )}
            {agent.linkedTokenVenue === "Metaplex" ? "Metaplex agent" : "Agent"}
          </span>
          <Link href={ctaHref} className="ui-public-site-accent text-xs font-semibold hover:underline">
            {ctaLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
