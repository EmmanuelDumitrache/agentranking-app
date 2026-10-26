"use client";
import { useState } from "react";
import { useTransientState } from "@/hooks/use-transient-state";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Copy,
  Clock,
  Coins,
  ExternalLink,
  Globe,
  IdCard,
  ShieldAlert,
  MessageSquare,
  Wallet,
} from "lucide-react";
import {
  PublicAgentAvatar,
  PublicTokenAvatar,
} from "@/components/public-site/token-avatar";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { NativeAgentScoreCard } from "@/components/public-site/native-agent-score-card";
import { NativeAgentShareButton } from "@/components/public-site/native-agent-share-button";
import { AgentInstallPanel } from "@/components/public-site/agent-install-panel";
import { AgentTalkPanel } from "@/components/public-site/agent-talk-panel";
import { VerificationIdCard } from "@/components/dashboard/verification-id-card";
import { FairscaleTrustCard } from "@/components/fairscale/fairscale-trust-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import type {
  NativeAgentDetailData,
  NativeAgentPublicEvent,
  NativeAgentTokenSummary,
  NativeAgentCapability,
  NativeAgentSocialLink,
} from "@/lib/public-site/native-agent-detail-data.server";
import type { NativeAgentShareCardInput } from "@/lib/public-site/native-agent-share-card";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { cn } from "@/lib/utils";
import { formatUsd, formatUsdCompact } from "@/lib/public-site/formatters";
import type { AccountVerificationLevel } from "@/generated/prisma/client";
type Props = { readonly agent: NativeAgentDetailData };
function buildAgentShareInput(
  agent: NativeAgentDetailData,
  verified: boolean,
): NativeAgentShareCardInput {
  const hasToken = agent.linkedTokens.length > 0;
  const isSolana = agent.chainId === SOLANA_CHAIN_ID;
  const tokenSymbol = agent.linkedTokens[0]?.symbol;
  return {
    agentName: agent.name,
    imageUrl: agent.image || null,
    chainLabel: agent.chain.shortName || agent.chain.name || (isSolana ? "Solana" : "EVM"),
    chainIcon: isSolana ? "solana" : "evm",
    verified,
    tokenized: hasToken,
    scoreLabel: String(agent.nativeScore.total),
    verificationLabel: verified ? "Verified" : "Unverified",
    tokenLabel: hasToken ? (tokenSymbol ? `$${tokenSymbol}` : "Tokenized") : "None",
    sharePath: agent.profilePath,
  };
}
const TOKEN_SOURCE_LABELS: Record<string, string> = {
  pumpfun: "Pump.fun launch",
  metaplex: "Metaplex launch",
  agentranking: "AgentRanking launch",
  unknown: "Token source unknown",
};
const DATE_FMT: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", DATE_FMT);
}

/** Full UTC datetime for agent proof timestamps; omit when only a date is known. */
function formatUtcDateTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const isDateOnly =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isDateOnly) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function credentialAssuranceLabel(level: AccountVerificationLevel): string {
  switch (level) {
    case "INDIVIDUAL":
      return "KYC";
    case "BUSINESS":
      return "KYB";
    case "NONE":
      return "Unverified";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

function credentialTierLabel(level: AccountVerificationLevel): string {
  switch (level) {
    case "BUSINESS":
      return "Tier 3";
    case "INDIVIDUAL":
      return "Tier 2";
    case "NONE":
      return "Tier 1";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

function credentialPlanLabel(level: AccountVerificationLevel): string {
  switch (level) {
    case "BUSINESS":
      return "Business";
    case "INDIVIDUAL":
      return "Individual";
    case "NONE":
      return "Basic";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}
/* ═══════════════════════════════════════════════════════════════════════
 * Sub-components
 * ═══════════════════════════════════════════════════════════════════════ */
function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  horizontal = false,
}: {
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly horizontal?: boolean;
}) {
  if (horizontal) {
    return (
      <div className="flex min-h-24 items-center gap-3 rounded-lg border border-border/60 bg-[var(--app-inset)] px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold leading-tight">{value}</p>
          {sub ? (
            <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">
              {sub}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-[var(--app-inset)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
function CredentialMiniCard({
  publicId,
  onOpen,
}: {
  readonly publicId: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-24 items-center gap-3 rounded-lg border border-border/60 bg-[var(--app-inset)] px-4 py-3 text-left transition-colors hover:border-border hover:bg-[var(--app-panel-hover)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
        <IdCard className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Credential
        </p>
        <p className="mt-1 truncate font-mono text-sm font-semibold leading-tight">{publicId}</p>
        <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">
          View ID card
        </p>
      </div>
    </button>
  );
}
function TokenSourceBadge({ source }: { readonly source: string }) {
  return (
    <span className="rounded-full border border-border/60 bg-[var(--app-inset)] px-2 py-0.5 text-[10px] text-muted-foreground">
      {TOKEN_SOURCE_LABELS[source] ?? "Token source unknown"}
    </span>
  );
}
function DetectedChainBadge({
  chainId,
  shortName,
}: {
  readonly chainId: number;
  readonly shortName: string;
}) {
  const chainCfg = getChainByChainId(chainId);
  const label = chainCfg?.shortName ?? shortName;
  const title = chainCfg?.name ?? shortName;
  const icon = resolveChainIconUrl(chainId);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-[var(--app-inset)] px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0"
      title={title}
      aria-label={`Chain: ${title}`}
    >
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={14}
          height={14}
          className={
            icon === "/ar-mark.png"
              ? "h-3.5 w-3.5 object-contain shrink-0"
              : "h-3.5 w-3.5 rounded-full object-cover shrink-0"
          }
          unoptimized
        />
      ) : (
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted text-[8px] font-bold">
          {label.slice(0, 1)}
        </span>
      )}
      {label}
    </span>
  );
}
function TokenPanel({ token }: { readonly token: NativeAgentTokenSummary }) {
  const m = token.marketView;
  return (
    <div className="rounded-lg border border-border/60 bg-[var(--app-inset)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <PublicTokenAvatar
            name={token.name ?? token.mint}
            symbol={token.symbol}
            imageUrl={token.imageUrl}
            size="sm"
            className="rounded-full"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{token.name ?? token.mint}</p>
            {token.symbol && (
              <p className="text-xs text-muted-foreground font-mono">${token.symbol}</p>
            )}
          </div>
        </div>
        <TokenSourceBadge source={token.source} />
      </div>
      {m && (
        <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
          <div>
            <span className="text-muted-foreground">Price</span>
            <p className="font-mono font-semibold">{formatUsd(m.priceUsd)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Market Cap</span>
            <p className="font-mono font-semibold">{formatUsdCompact(m.marketCapUsd)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">24H Volume</span>
            <p className="font-mono">{m.volumeIsZero ? "$0" : formatUsdCompact(m.volume24hUsd)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Liquidity</span>
            <p className="font-mono">{m.liquidityDisplay}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/tokens/${token.mint}`} className="ui-btn ui-btn-secondary ui-btn-xs">
          View token page
        </Link>
        {token.source === "pumpfun" && (
          <a
            href={`https://pump.fun/coin/${token.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Pump.fun <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <a
          href={`https://solscan.io/token/${token.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Solscan <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
function CapabilitiesPanel({ capabilities }: { readonly capabilities: NativeAgentCapability[] }) {
  if (capabilities.length === 0) {
    return (
      <div id="capabilities" className="scroll-mt-20">
        <PublicSitePanel>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Capabilities
          </h3>
          <p className="text-sm text-muted-foreground">No capabilities configured.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Capabilities will appear here once the creator adds tools or skills.
          </p>
        </PublicSitePanel>
      </div>
    );
  }
  return (
    <div id="capabilities" className="scroll-mt-20">
      <PublicSitePanel>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Capabilities
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {capabilities.map((cap, i) => (
            <span
              key={`${cap.kind}-${cap.label}-${i}`}
              className="rounded-full border border-border/60 bg-[var(--app-inset)] px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {cap.label}
            </span>
          ))}
        </div>
      </PublicSitePanel>
    </div>
  );
}
function ActivityTimeline({ events }: {
  readonly events: NativeAgentPublicEvent[];
}) {
  if (events.length === 0) {
    return (
      <PublicSitePanel>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Activity
        </h3>
        <p className="text-sm text-muted-foreground">No public activity yet.</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Agent events will appear here as this agent launches tokens, verifies, and receives fees.
        </p>
      </PublicSitePanel>
    );
  }
  return (
    <PublicSitePanel>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Activity
      </h3>
      <div className="space-y-0">
        {events.map((event, i) => {
          const isLast = i === events.length - 1;
          const eventKey = `${event.kind}-${event.date}-${event.label}-${i}`;
          return (
            <div key={eventKey} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className={cn(
                  "h-2 w-2 rounded-full mt-1.5",
                  event.kind === "created" && "bg-foreground/50",
                  event.kind === "wallet" && "bg-foreground/45",
                  event.kind === "token" && "bg-foreground/55",
                  event.kind === "verification" && "bg-foreground/50",
                  event.kind === "fee" && "bg-foreground/40",
                  event.kind === "metadata" && "bg-slate-500/60",
                  event.kind === "other" && "bg-muted-foreground/40",
                )} />
                {!isLast && <div className="w-px flex-1 bg-border/40 mt-1" />}
              </div>
              <div className={cn("pb-3 min-w-0", isLast && "pb-0")}>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{event.label}</p>
                  <span className="text-[10px] text-muted-foreground">{event.date}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{event.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </PublicSitePanel>
  );
}
function IdentityPanel({
  agent,
  verified,
  onOpenCredential,
}: {
  readonly agent: NativeAgentDetailData;
  readonly verified: boolean;
  readonly onOpenCredential?: () => void;
}) {
  const [copied, setCopied] = useTransientState<string | null>(null, 1500);
  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
  };
  const isPending =
    !verified &&
    (agent.arVerificationStatus === "pending" || agent.publicVerificationStatus === "in_review");
  const verifiedAtLabel = formatUtcDateTimeLabel(agent.verifiedAt);
  const registeredAtLabel = formatUtcDateTimeLabel(agent.solanaRegisteredAt);
  const hasToken = agent.linkedTokens.length > 0;
  const primaryToken = agent.linkedTokens[0];
  return (
    <PublicSitePanel>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Identity &amp; Verification
      </h3>
      <div className="space-y-3">
        {/* Agent identity */}
        <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Type</span>
            <span className="text-[11px] font-medium">AgentRanking-created AI agent</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Created</span>
            <span className="text-[11px] font-medium">{fmtDate(agent.createdAt)}</span>
          </div>
          {agent.lastActiveAt && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Last active</span>
              <span className="text-[11px] font-medium">{fmtDate(agent.lastActiveAt)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Network</span>
            <span className="text-[11px] font-medium">{agent.chain.shortName ?? agent.chain.name}</span>
          </div>
        </div>
        {/* Verification */}
        <div className={cn(
          "rounded-md border p-2.5",
          verified
            ? "border-foreground/15 bg-foreground/[0.03]"
            : "border-border/40 bg-[var(--app-inset)]",
        )}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {verified ? (
                <BadgeCheck className="h-4 w-4 shrink-0 text-foreground/60" />
              ) : (
                <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("text-sm font-medium", verified ? "text-foreground/80" : "text-muted-foreground")}>
                {verified ? "Verified" : isPending ? "Verification pending" : "Unverified"}
              </span>
            </div>
            {agent.credential.present ? (
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                {credentialTierLabel(agent.credential.level)}
              </span>
            ) : null}
          </div>
          {agent.credential.present ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {credentialAssuranceLabel(agent.credential.level)} ·{" "}
              {credentialPlanLabel(agent.credential.level)}
            </p>
          ) : null}
          {verified && verifiedAtLabel ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{verifiedAtLabel}</p>
          ) : null}
          {isPending ? (
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              Awaiting AgentRanking review.
            </p>
          ) : null}
          {!verified && !isPending && (
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              This agent has not completed AgentRanking verification yet.
            </p>
          )}
          {agent.credential.present && onOpenCredential ? (
            <button
              type="button"
              onClick={onOpenCredential}
              className="mt-2 inline-flex max-w-full items-center rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-foreground/80 transition-colors hover:border-border hover:text-foreground"
            >
              {agent.credential.publicId}
            </button>
          ) : null}
        </div>
        {agent.isSolanaDirectoryListed ? (
          <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5">
            <div className="flex items-center gap-2">
              <RegisteredTick size="sm" />
              <span className="text-sm font-medium text-foreground/80">Registered on Solana</span>
            </div>
            {registeredAtLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{registeredAtLabel}</p>
            ) : null}
          </div>
        ) : null}
        {/* Wallet */}
        {agent.agentWalletPublicKey ? (
          (() => {
            const walletAddr = agent.agentWalletPublicKey;
            return (
              <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Wallet className="h-3 w-3" />
                  <span>Agent Wallet</span>
                </div>
                <p className="font-mono text-xs break-all">{walletAddr}</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(walletAddr)}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                    {copied === walletAddr ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={`https://solscan.io/account/${walletAddr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Solscan
                  </a>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5">
            <p className="text-[11px] text-muted-foreground">Wallet not available</p>
          </div>
        )}
        {agent.fairscaleAssessment ? (
          <FairscaleTrustCard
            assessment={agent.fairscaleAssessment}
            agentDbId={agent.id}
            chainId={agent.chainId}
            agentId={agent.agentId}
            variant="embedded"
          />
        ) : null}
        {/* Linked token mint */}
        {hasToken && primaryToken && (
          <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Coins className="h-3 w-3" />
              <span>Linked Token</span>
            </div>
            <p className="font-mono text-xs break-all">{primaryToken.mint}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => copyText(primaryToken.mint)}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                {copied === primaryToken.mint ? "Copied" : "Copy"}
              </button>
              <Link
                href={`/tokens/${primaryToken.mint}`}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                View token
              </Link>
            </div>
          </div>
        )}
      </div>
    </PublicSitePanel>
  );
}
function OnchainIntelligencePanel({ agent }: { readonly agent: NativeAgentDetailData }) {
  const onchain = agent.onchain;
  const evidence = onchain.evidence && typeof onchain.evidence === "object" && !Array.isArray(onchain.evidence)
    ? onchain.evidence as Record<string, unknown>
    : {};
  const hasChainEvidence = evidence.hasChainEvidence === true;
  const hasVerifiedChainEvidence = evidence.hasVerifiedChainEvidence === true;
  const evidenceLevel = typeof onchain.evidenceLevel === "string" ? onchain.evidenceLevel : "none";
  const protocols = Array.isArray(onchain.protocols)
    ? onchain.protocols.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const metadata = Array.isArray(onchain.metadata) ? onchain.metadata : [];
  const services = Array.isArray(onchain.services) ? onchain.services : [];
  const reputation = onchain.reputation as { totalFeedbackCount?: number; decodedDocumentCount?: number; hashVerifiedDocumentCount?: number; recentUniqueClientCount?: number; recent?: unknown[] };
  const validation = onchain.validation as { responseCount?: number; successfulResponseCount?: number; hashVerifiedDocumentCount?: number; uniqueValidatorCount?: number; recent?: unknown[] };
  const reputationRecent = Array.isArray(reputation.recent)
    ? reputation.recent.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const validationRecent = Array.isArray(validation.recent)
    ? validation.recent.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const history = onchain.history && typeof onchain.history === "object" && !Array.isArray(onchain.history)
    ? onchain.history as Record<string, unknown>
    : {};
  const identityHistory = Array.isArray(history.identity)
    ? history.identity.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const metadataHistory = Array.isArray(history.metadata)
    ? history.metadata.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const solanaHistory = Array.isArray(history.solana)
    ? history.solana.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const identity = onchain.identity as Record<string, unknown> | null;
  const registration = onchain.registration as Record<string, unknown> | null;
  const registrationCore = registration?.parsedCore && typeof registration.parsedCore === "object" && !Array.isArray(registration.parsedCore)
    ? registration.parsedCore as Record<string, unknown>
    : null;
  const solana = onchain.solana as Record<string, unknown> | null;
  const solanaTransaction = solana?.transaction && typeof solana.transaction === "object" && !Array.isArray(solana.transaction)
    ? solana.transaction as Record<string, unknown>
    : null;
  const instructionSummary = solanaTransaction?.decodedInstructions && typeof solanaTransaction.decodedInstructions === "object" && !Array.isArray(solanaTransaction.decodedInstructions)
    ? solanaTransaction.decodedInstructions as Record<string, unknown>
    : null;
  const agentInstructions = Array.isArray(instructionSummary?.agentInstructions)
    ? instructionSummary.agentInstructions.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const metaplex = onchain.metaplex as Record<string, unknown> | null;
  const sap = onchain.sap as Record<string, unknown> | null;
  const supportedTrust = Array.isArray(registrationCore?.supportedTrust)
    ? registrationCore.supportedTrust.filter((value): value is string => typeof value === "string")
    : [];
  const registrations = Array.isArray(registrationCore?.registrations)
    ? registrationCore.registrations.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const readable = (value: unknown, fallback = "—"): string => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    return fallback;
  };
  const short = (value: unknown, max = 72): string => {
    const text = readable(value, "");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const evidenceRows = [
    ["Evidence level", evidenceLevel],
    ["Protocols", protocols.join(", ") || onchain.protocol],
    ["Registration type", registrationCore?.type],
    ["Registry agent ID", identity?.protocolAgentId],
    ["Current owner", identity?.currentOwner],
    ["Agent wallet", identity?.agentWallet ?? solana?.operationalWallet ?? sap?.ownerWallet],
    ["Registration URI", identity?.agentUri ?? solana?.agentUri ?? metaplex?.registrationUri],
    ["SAP agent PDA", sap?.agentPda],
    ["SAP registration tx", sap?.registrationTransaction],
    ["Metaplex asset", metaplex?.asset],
    ["Metaplex identity PDA", metaplex?.agentIdentityPda],
    ["Solana asset", solana?.asset],
    ["Solana instruction decoder", solanaTransaction?.instructionDecoderVersion],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  const panelTitle = hasChainEvidence ? "On-chain intelligence" : "Agent protocol profile";
  const panelDescription = hasVerifiedChainEvidence
    ? "Chain-verified identity and protocol evidence."
    : hasChainEvidence
      ? "Chain-observed protocol data; verification strength varies by source."
      : evidenceLevel === "document-observed"
        ? "Fetched registration-document declarations; no direct chain observation is linked yet."
        : "Application or indexer declarations; no direct chain observation is linked yet.";
  const showEvmCards = Boolean(identity) || metadata.length > 0 || Number(reputation.totalFeedbackCount ?? 0) > 0 || Number(validation.responseCount ?? 0) > 0;
  if (evidenceLevel === "none" && services.length === 0) return null;
  return (
    <PublicSitePanel>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{panelTitle}</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">{panelDescription}</p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-[10px] ${hasVerifiedChainEvidence ? "border-emerald-500/30 text-emerald-500" : "border-border/50 text-muted-foreground"}`}>
          {evidenceLevel.replaceAll("-", " ")}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {showEvmCards && <SummaryCard icon={Wallet} label="Metadata" value={String(metadata.length)} sub="Typed chain values" />}
        <SummaryCard icon={Globe} label="Services" value={String(services.length)} sub={`${evidence.chainAnchoredServiceCount ?? 0} chain anchored`} />
        {sap && <SummaryCard icon={BadgeCheck} label="SAP" value={sap.verified === true ? "Verified" : "Observed"} sub={short(sap.agentPda, 24) || "Protocol record"} />}
        {metaplex && <SummaryCard icon={Coins} label="Metaplex" value={metaplex.verified === true ? "Verified" : "Observed"} sub={short(metaplex.asset, 24) || "Identity record"} />}
        {showEvmCards && <SummaryCard icon={BadgeCheck} label="Feedback" value={String(reputation.totalFeedbackCount ?? 0)} sub={`${reputation.hashVerifiedDocumentCount ?? 0} verified docs`} />}
        {showEvmCards && <SummaryCard icon={ShieldAlert} label="Validation" value={String(validation.responseCount ?? 0)} sub={`${validation.uniqueValidatorCount ?? 0} validators`} />}
      </div>
      {evidenceRows.length > 0 && (
        <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-3 space-y-2">
          {evidenceRows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[140px_1fr] gap-2 text-[11px]">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
      {(supportedTrust.length > 0 || Number(instructionSummary?.knownAgentInstructionCount ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {supportedTrust.map((value) => <span key={`trust-${value}`} className="rounded-md border border-border/50 bg-[var(--app-inset)] px-2 py-1 text-[10px]">Trust: {value}</span>)}
          {Number(instructionSummary?.knownAgentInstructionCount ?? 0) > 0 && (
            <span className="rounded-md border border-border/50 bg-[var(--app-inset)] px-2 py-1 text-[10px]">{String(instructionSummary?.knownAgentInstructionCount)} decoded agent instructions</span>
          )}
        </div>
      )}
      {registrations.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Cross-chain registrations</p>
          <div className="flex flex-wrap gap-1.5">
            {registrations.slice(0, 16).map((registrationItem, index) => (
              <span key={`registration-${index}`} className="rounded-md border border-border/50 bg-[var(--app-inset)] px-2 py-1 text-[10px] font-mono">
                {short(registrationItem.agentRegistry ?? registrationItem.canonicalAgentRegistry)} · {short(registrationItem.agentId, 36)}
              </span>
            ))}
          </div>
        </div>
      )}
      {services.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{hasChainEvidence ? "Protocol services and capabilities" : "Declared services and capabilities"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {services.slice(0, 12).map((service, index) => {
              const name = typeof service.sourceName === "string" && service.sourceName.trim()
                ? service.sourceName.trim()
                : typeof service.name === "string" && service.name.trim()
                  ? service.name.trim()
                  : `Service ${index + 1}`;
              const normalizedType = short(service.normalizedType, 24);
              const endpoint = typeof service.normalizedEndpoint === "string" ? service.normalizedEndpoint : typeof service.endpoint === "string" ? service.endpoint : "";
              const skills = Array.isArray(service.skills) ? service.skills.filter((value): value is string => typeof value === "string") : [];
              const capabilities = Array.isArray(service.capabilities) ? service.capabilities.filter((value): value is string => typeof value === "string") : [];
              const source = short(service.sourceKind ?? service.evidenceSource, 32);
              const endpointKind = short(service.endpointKind, 24);
              const chainAnchored = service.chainAnchored === true;
              return (
                <div key={`${name}-${endpoint}-${index}`} className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium">{name}</p>
                    <span className={chainAnchored ? "text-[9px] text-emerald-500" : "text-[9px] text-muted-foreground"}>{chainAnchored ? "chain anchored" : source || "declared"}</span>
                  </div>
                  {endpoint && <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{endpoint}</p>}
                  {(normalizedType.length > 0 || endpointKind.length > 0) && <p className="mt-1 text-[9px] text-muted-foreground">{[normalizedType, endpointKind, service.endpointValid === true ? "valid" : service.endpointValid === false ? "invalid" : "unverified"].filter(Boolean).join(" · ")}</p>}
                  {(skills.length > 0 || capabilities.length > 0) && <p className="mt-1 text-[10px] text-muted-foreground">{[...skills, ...capabilities].slice(0, 8).join(" · ")}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {metadata.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Decoded metadata</p>
          <div className="flex flex-wrap gap-1.5">
            {metadata.slice(0, 24).map((item, index) => {
              const key = typeof item.key === "string" ? item.key : `field-${index}`;
              const value = item.value;
              const label = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                ? `${key}: ${String(value).slice(0, 80)}`
                : key;
              return <span key={`${key}-${index}`} className="rounded-md border border-border/50 bg-[var(--app-inset)] px-2 py-1 text-[10px] font-mono">{label}</span>;
            })}
          </div>
        </div>
      )}
      {(reputationRecent.length > 0 || validationRecent.length > 0) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {reputationRecent.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent reputation evidence</p>
              <div className="space-y-2">
                {reputationRecent.slice(0, 5).map((item, index) => {
                  const tags = [short(item.tag1, 32), short(item.tag2, 32)].filter((value) => value.length > 0).join(" · ");
                  const endpoint = short(item.endpoint, 120);
                  return (
                    <div key={`feedback-${index}`} className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono">{short(item.clientAddress, 34)}</span>
                        <span className={item.hashValid === true ? "text-emerald-500" : "text-muted-foreground"}>{item.hashValid === true ? "hash verified" : readable(item.eventType, "feedback")}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">Value {readable(item.exactValue)}{item.valueDecimals != null ? ` · decimals ${readable(item.valueDecimals)}` : ""}</p>
                      {tags.length > 0 && <p className="mt-1 text-muted-foreground">{tags}</p>}
                      {endpoint.length > 0 && <p className="mt-1 break-all font-mono text-muted-foreground">{endpoint}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {validationRecent.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent validation evidence</p>
              <div className="space-y-2">
                {validationRecent.slice(0, 5).map((item, index) => {
                  const tag = short(item.tag, 48);
                  const requestHash = short(item.requestHash, 78);
                  return (
                    <div key={`validation-${index}`} className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono">{short(item.validatorAddress, 34)}</span>
                        <span className={item.hashValid === true ? "text-emerald-500" : "text-muted-foreground"}>{item.hashValid === true ? "hash verified" : readable(item.eventType, "validation")}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">Response {readable(item.response)}{tag.length > 0 ? ` · ${tag}` : ""}</p>
                      {requestHash.length > 0 && <p className="mt-1 break-all font-mono text-muted-foreground">Request {requestHash}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {sap && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Synapse Agent Protocol evidence</p>
          <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-3">
            <div className="grid gap-2 sm:grid-cols-2 text-[10px]">
              <div><span className="text-muted-foreground">Status</span><p className={sap.verified === true ? "mt-1 text-emerald-500" : "mt-1"}>{sap.verified === true ? "Verified SAP account" : "Observed SAP account"}</p></div>
              <div><span className="text-muted-foreground">Pricing tiers</span><p className="mt-1">{Array.isArray(sap.pricingTiers) ? sap.pricingTiers.length : 0}</p></div>
              {short(sap.agentPda, 64).length > 0 && <div className="sm:col-span-2"><span className="text-muted-foreground">Agent PDA</span><p className="mt-1 break-all font-mono">{short(sap.agentPda, 96)}</p></div>}
              {short(sap.ownerWallet, 64).length > 0 && <div className="sm:col-span-2"><span className="text-muted-foreground">Owner wallet</span><p className="mt-1 break-all font-mono">{short(sap.ownerWallet, 96)}</p></div>}
            </div>
            {Array.isArray(sap.protocols) && sap.protocols.length > 0 && <p className="mt-2 text-[10px] text-muted-foreground">Protocols: {sap.protocols.filter((value): value is string => typeof value === "string").slice(0, 12).join(" · ")}</p>}
            {Array.isArray(sap.capabilities) && sap.capabilities.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">Capabilities: {sap.capabilities.slice(0, 12).map((value) => readable(value)).join(" · ")}</p>}
          </div>
        </div>
      )}
      {agentInstructions.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Decoded Solana agent instructions</p>
          <div className="space-y-2">
            {agentInstructions.slice(0, 8).map((instruction, index) => {
              const roles = Array.isArray(instruction.accountRoles)
                ? instruction.accountRoles.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
                : [];
              const securityEffect = short(instruction.securityEffect, 180);
              return (
                <div key={`instruction-${index}`} className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5 text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{readable(instruction.instructionName, "Unknown agent instruction")}</span>
                    <span className="font-mono text-muted-foreground">{short(instruction.programId, 28)}</span>
                  </div>
                  {securityEffect.length > 0 && <p className="mt-1 text-muted-foreground">{securityEffect}</p>}
                  {roles.length > 0 && <p className="mt-1 font-mono text-muted-foreground">{roles.slice(0, 8).map((role) => `${readable(role.role, "account")}:${short(role.address, 18)}`).join(" · ")}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(identityHistory.length > 1 || metadataHistory.length > metadata.length || solanaHistory.length > 1) && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Retained on-chain history</p>
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard icon={Clock} label="Identity states" value={String(identityHistory.length)} sub="Recent retained states" />
            <SummaryCard icon={Clock} label="Metadata changes" value={String(metadataHistory.length)} sub="Recent retained changes" />
            <SummaryCard icon={Clock} label="Solana states" value={String(solanaHistory.length)} sub="Recent retained states" />
          </div>
        </div>
      )}
      <details className="mt-3 rounded-md border border-border/40 bg-[var(--app-inset)] p-3">
        <summary className="cursor-pointer text-[11px] font-medium">{hasChainEvidence ? "Structured on-chain evidence" : "Structured agent evidence"}</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(onchain, null, 2)}</pre>
      </details>
    </PublicSitePanel>
  );
}
function SocialLinks({ socials }: { readonly socials: NativeAgentSocialLink[] }) {
  if (socials.length === 0) return null;
  const iconMap: Record<string, React.ReactNode> = {
    website: <Globe className="h-3 w-3" />,
    twitter: <span className="text-[10px] font-bold">𝕏</span>,
    telegram: <span className="text-[10px] font-bold">✈</span>,
    github: <span className="text-[10px] font-bold">⌥</span>,
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {socials.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-public-site-filter-surface inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-foreground/75 transition-colors hover:bg-[var(--app-panel-hover)] hover:text-foreground"
        >
          {iconMap[s.kind] ?? <ExternalLink className="h-3 w-3" />}
          {s.kind.charAt(0).toUpperCase() + s.kind.slice(1)}
        </a>
      ))}
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════════════════
 * Main page component
 * ═══════════════════════════════════════════════════════════════════════ */
export function NativeAgentDetailPage({ agent }: Props) {
  const v = getPublicAgentVerificationStatus(agent);
  const verified = v.isVerified;
  const hasToken = agent.linkedTokens.length > 0;
  const shareInput = buildAgentShareInput(agent, verified);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const credential = agent.credential.present ? agent.credential : null;
  const credentialVerifiedAt = agent.verifiedAt ? new Date(agent.verifiedAt) : null;
  return (
    <div className="ui-page-stack">
      {/* Slim back link */}
      <div className="px-1 -mt-1 mb-1">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to agents
        </Link>
      </div>
      {/* ── Hero card ── */}
      <PublicSitePanel>
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <PublicAgentAvatar name={agent.name} imageUrl={agent.image} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight">{agent.name}</h1>
                <DetectedChainBadge
                  chainId={agent.chainId}
                  shortName={agent.chain.shortName}
                />
                {verified ? <VerifiedTick size="md" tone="foreground" /> : null}
                {agent.isSolanaDirectoryListed ? <RegisteredTick size="md" /> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href="#talk-panel"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
                  onClick={() => {
                    const panel = document.getElementById("talk-panel");
                    if (panel instanceof HTMLDetailsElement) panel.open = true;
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  Talk to this agent
                </a>
                <NativeAgentShareButton shareInput={shareInput} className="-mr-1" />
              </div>
            </div>
            {agent.description ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/70">
                {agent.description}
              </p>
            ) : (
              <p className="mt-3 text-sm italic text-foreground/45">
                No public description provided.
              </p>
            )}
            <div className="mt-3">
              <SocialLinks socials={agent.socials} />
            </div>
          </div>
        </div>
      </PublicSitePanel>
      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className={cn(
              "grid grid-cols-1 gap-2",
              credential ? "sm:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            <SummaryCard
              icon={Coins}
              label="Token"
              value={hasToken ? "Tokenized" : "None"}
              sub={hasToken ? agent.linkedTokens[0]?.symbol ?? "" : ""}
              horizontal
            />
            <SummaryCard
              icon={Clock}
              label="Last active"
              value={agent.lastActiveAt ? fmtDate(agent.lastActiveAt) : "—"}
              horizontal
            />
            {credential ? (
              <CredentialMiniCard
                publicId={credential.publicId}
                onOpen={() => setCredentialOpen(true)}
              />
            ) : null}
          </div>
          <AgentTalkPanel
            chainId={agent.chainId}
            agentId={agent.agentId}
            talk={agent.talk}
          />
          <NativeAgentScoreCard score={agent.nativeScore} />
          {/* Linked token panel */}
          {hasToken ? (
            <PublicSitePanel>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Linked Token
              </h3>
              <div className="space-y-3">
                {agent.linkedTokens.map((token) => (
                  <TokenPanel key={token.launchId} token={token} />
                ))}
              </div>
            </PublicSitePanel>
          ) : (
            <PublicSitePanel>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                No linked token
              </h3>
              <p className="text-sm text-muted-foreground">
                This agent has not launched an AgentRanking token yet.
              </p>
            </PublicSitePanel>
          )}
          {/* Capabilities */}
          <CapabilitiesPanel capabilities={agent.capabilities} />
          <OnchainIntelligencePanel agent={agent} />
          {/* Activity timeline */}
          <ActivityTimeline events={agent.events} />
        </div>
        {/* Right rail */}
        <div className="space-y-4">
          <AgentInstallPanel install={agent.install} />
          <IdentityPanel
            agent={agent}
            verified={verified}
            onOpenCredential={credential ? () => setCredentialOpen(true) : undefined}
          />
        </div>
      </div>
      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-[11px] text-muted-foreground">
          Agent ID: {agent.agentId} · Chain: {agent.chain.name} ({agent.chainId})
          {agent.linkedTokens.length > 0 && (
            <> · Token: {agent.linkedTokens[0]?.mint?.slice(0, 6)}...{agent.linkedTokens[0]?.mint?.slice(-4)}</>
          )}
        </p>
      </div>
      {credential ? (
        <Dialog open={credentialOpen} onOpenChange={setCredentialOpen}>
          <DialogContent className="border-border bg-[var(--app-panel,#181818)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>AgentRanking ID</DialogTitle>
              <DialogDescription>
                Public operator credential. Click the card to flip.
              </DialogDescription>
            </DialogHeader>
            <VerificationIdCard
              publicId={credential.publicId}
              level={credential.level}
              verifiedAt={credentialVerifiedAt}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
