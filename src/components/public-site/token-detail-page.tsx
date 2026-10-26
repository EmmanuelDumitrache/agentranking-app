"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useTransientState } from "@/hooks/use-transient-state";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicTokenDetailData } from "@/lib/public-site/token-detail-data.server";
import {
  shortenSolanaAddress,
  getSolscanTokenUrl,
  launchAddressExplorerUrl,
} from "@/lib/agent-launch/explorer-links";
import { normalizeAgentLaunchNetwork } from "@/lib/agent-launch/network";
import {
  formatLamportsDisplay,
  LAUNCH_AVATAR_FALLBACK,
} from "@/lib/agent-launch/launch-profile";
import { formatUsdCompact, formatUsd } from "@/lib/public-site/formatters";
import type { PublicTokenMarketViewModel } from "@/lib/public-site/market-view-model";
import { useCallback, useState } from "react";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { isArTokenVerified } from "@/lib/agent-launch/token-verification";
import { TokenGraduationBar } from "@/components/public-site/token-graduation-bar";
import { TokenMarketPills } from "@/components/public-site/token-market-pills";
import { TokenDetailShareButton } from "@/components/public-site/token-detail-share-button";
import type { TokenDetailShareCardInput } from "@/lib/public-site/token-detail-share-card";
import { resolveImageUrl } from "@/lib/image-utils";
import {
  isMetaplexGenesisLaunch,
  metaplexGenesisTokenUrl,
  primarySolanaTradeUrl,
  resolveSolanaLaunchVenue,
} from "@/lib/agent-launch/launch-venue";
type Props = {
  readonly data: PublicTokenDetailData;
};
export function PublicTokenDetailPage({ data }: Props) {
  const { launch, profile, linkedAgent, distributions, totals, networkLabel, isMainnet, isDevnet, marketView, kind, official } = data;
  const isOfficial = kind === "official";
  const network = normalizeAgentLaunchNetwork(launch.network ?? "devnet") ?? "devnet";
  const symbol = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "";
  const tokenName = profile.displayName || launch.tokenName || symbol || "Unnamed Token";
  const description = profile.longDescription || profile.shortDescription || launch.tokenDescription || null;
  const imageUrl =
    resolveImageUrl(profile.avatarUrl || launch.tokenImageUrl) ||
    LAUNCH_AVATAR_FALLBACK;
  const mint = launch.mint ?? "";
  const creatorWallet = launch.creatorWallet ?? "";
  const treasuryWallet = launch.arTreasuryWallet ?? "";
  const creationTx = launch.creationTx ?? "";
  const creatorPct = launch.creatorShareBps / 100;
  const arPct = launch.arShareBps / 100;
  const hasFees = totals.totalFeesDistributedLamports !== "0";
  const isMetaplexLaunch = isMetaplexGenesisLaunch(launch.launchKind);
  const solanaVenue = resolveSolanaLaunchVenue(launch.launchKind);
  const creatorFeeDisplay = formatLamportsDisplay(totals.totalCreatorFeesLamports);
  const arFeeDisplay = formatLamportsDisplay(totals.totalArFeesLamports);
  const totalFeeDisplay = formatLamportsDisplay(totals.totalFeesDistributedLamports);
  return (
    <div className="ui-page-stack">
      <Link
        href="/tokens"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        All tokens
      </Link>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* LEFT COLUMN */}
        <div className="min-w-0 flex-1 ui-page-stack">
          <HeroSection
            tokenName={tokenName}
            symbol={symbol}
            description={description}
            imageUrl={imageUrl}
            profile={profile}
            linkedAgent={linkedAgent}
            isOfficial={isOfficial}
            tokenVerified={
              isOfficial || isArTokenVerified(launch.arTokenVerificationStatus)
            }
            solanaVenue={solanaVenue}
          />
          <MetricCards marketView={marketView} />
          <MarketPanel marketView={marketView} mint={mint} />
          {!isOfficial ? (
            <FeeDistributionsSection
              distributions={distributions}
              hasFees={hasFees}
              totalFeeDisplay={totalFeeDisplay}
              creatorFeeDisplay={creatorFeeDisplay}
              arFeeDisplay={arFeeDisplay}
              totals={totals}
              network={network}
              isMetaplexLaunch={isMetaplexLaunch}
            />
          ) : null}
          <LaunchDetailsSection
            mint={mint}
            creatorWallet={creatorWallet}
            treasuryWallet={treasuryWallet}
            creationTx={creationTx}
            network={network}
            networkLabel={networkLabel}
            creatorPct={creatorPct}
            arPct={arPct}
            linkedAgent={linkedAgent}
            launch={launch}
            isOfficial={isOfficial}
            official={official}
          />
        </div>
        {/* RIGHT RAIL */}
        <div className="w-full lg:sticky lg:top-20 lg:w-[320px] xl:w-[360px] shrink-0 ui-page-stack">
          <RightRail
            tokenName={tokenName}
            symbol={symbol}
            imageUrl={imageUrl}
            mint={mint}
            isMainnet={isMainnet}
            isDevnet={isDevnet}
            profile={profile}
            marketView={marketView}
            linkedAgent={linkedAgent}
            isOfficial={isOfficial}
            launchKind={launch.launchKind}
          />
        </div>
      </div>
    </div>
  );
}
/* ────────────────────────── Hero ────────────────────────── */
function HeroSection({
  tokenName,
  symbol,
  description,
  imageUrl,
  profile,
  linkedAgent,
  isOfficial = false,
  tokenVerified = false,
  solanaVenue = "pumpswap",
}: {
  tokenName: string;
  symbol: string;
  description: string | null;
  imageUrl: string;
  profile: PublicTokenDetailData["profile"];
  linkedAgent: PublicTokenDetailData["linkedAgent"];
  isOfficial?: boolean;
  tokenVerified?: boolean;
  solanaVenue?: "pumpswap" | "metaplex";
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="size-20 sm:size-24 shrink-0 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-raised)]">
        <RuntimeImage
          src={imageUrl}
          alt={tokenName}
          className="size-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = LAUNCH_AVATAR_FALLBACK;
          }}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <TokenMarketPills
          chain="solana"
          venue={solanaVenue}
          originLabel={isOfficial ? "AR Token" : "AR Launch"}
        />
        <h1 className="flex flex-wrap items-center gap-1.5 text-2xl font-semibold tracking-tight sm:text-[length:var(--app-text-lg)]">
          {tokenName}
          {tokenVerified ? <VerifiedTick size="md" tone="foreground" /> : null}
        </h1>
        {symbol ? <p className="text-foreground/70 font-mono text-sm">{symbol}</p> : null}
        {!isOfficial && linkedAgent ? (
          <Link
            href={linkedAgent.publicHref}
            className="hover:border-[var(--app-border-strong)] mt-1 inline-flex items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-1.5 transition-colors"
          >
            <RuntimeImage
              src={linkedAgent.image || LAUNCH_AVATAR_FALLBACK}
              alt={linkedAgent.name}
              className="size-5 rounded-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = LAUNCH_AVATAR_FALLBACK;
              }}
            />
            <span className="text-foreground/65 text-xs">
              Created by{" "}
              <span className="text-foreground font-medium">{linkedAgent.name}</span>
            </span>
            <ExternalLink className="text-foreground/50 size-3" />
          </Link>
        ) : null}
        {description ? (
          <p className="text-foreground/70 max-w-2xl text-sm leading-relaxed">{description}</p>
        ) : null}
        <SocialLinks profile={profile} />
      </div>
    </div>
  );
}
function SocialLinks({ profile }: { profile: PublicTokenDetailData["profile"] }) {
  const links: { label: string | null; href: string; ariaLabel: string; icon: React.ReactNode }[] = [];
  if (profile.website) {
    links.push({
      label: "Website",
      ariaLabel: "Website",
      href: profile.website,
      icon: <Globe className="size-3.5" />,
    });
  }
  if (profile.twitter) {
    const href = profile.twitter.startsWith("http")
      ? profile.twitter
      : `https://x.com/${profile.twitter.replace(/^@/, "")}`;
    links.push({
      label: null,
      ariaLabel: "X",
      href,
      icon: <span className="text-sm font-semibold leading-none" aria-hidden>𝕏</span>,
    });
  }
  if (profile.telegram) {
    const href = profile.telegram.startsWith("http")
      ? profile.telegram
      : `https://t.me/${profile.telegram.replace(/^@/, "")}`;
    links.push({
      label: "Telegram",
      ariaLabel: "Telegram",
      href,
      icon: (
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.66-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.41-.88.03-.24.37-.49 1.02-.74 3.98-1.73 6.63-2.87 7.96-3.43 3.79-1.58 4.58-1.85 5.09-1.86.11 0 .37.03.54.16.14.11.18.26.2.37.02.12.03.24.01.38z" />
        </svg>
      ),
    });
  }
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.ariaLabel}
          className="ui-public-site-filter-surface text-foreground/75 hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--app-panel-hover)]"
        >
          {link.icon}
          {link.label}
          <ExternalLink className="size-3 opacity-60" />
        </a>
      ))}
    </div>
  );
}
/* ────────────────────────── Metric cards ────────────────────────── */
function MetricCards({ marketView }: { readonly marketView: PublicTokenMarketViewModel }) {
  const volumeValue = marketView.volumeIsZero
    ? "$0"
    : marketView.volume24hUsd != null
      ? formatUsdCompact(marketView.volume24hUsd)
      : "—";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard label="Price" value={formatUsd(marketView.priceUsd)} sub={marketView.priceSub} />
      <MetricCard label="Market Cap" value={marketView.marketCapUsd != null ? formatUsdCompact(marketView.marketCapUsd) : "—"} />
      <MetricCard label="24h Volume" value={volumeValue} sub={marketView.volumeSub} />
      <MetricCard label="Liquidity" value={marketView.liquidityDisplay} sub={marketView.liquiditySub} />
    </div>
  );
}
function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
      <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      <span className="mt-1 text-lg font-bold tabular-nums text-[var(--app-text)]">{value}</span>
      {sub ? <span className="text-muted-foreground mt-0.5 text-[11px] opacity-60">{sub}</span> : null}
    </div>
  );
}
/* ────────────────────────── Market / Chart panel ────────────────────────── */
function MarketPanel({ marketView }: { readonly marketView: PublicTokenMarketViewModel; readonly mint: string }) {
  const { mode, dexPairUrl, pumpFunUrl, chartTitle, chartDescription, graduated } = marketView;
  return (
    <div className="ui-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="ui-panel-title">{chartTitle}</h2>
        <div className="flex items-center gap-2">
          {mode === "dex" && dexPairUrl ? (
            <ExternalLinkButton href={dexPairUrl} label="Dexscreener" />
          ) : null}
          {mode === "bonding" && pumpFunUrl ? (
            <ExternalLinkButton href={pumpFunUrl} label="Pump.fun" />
          ) : null}
          {(mode === "bonding" || mode === "unknown") && dexPairUrl ? (
            <ExternalLinkButton href={dexPairUrl} label="Dexscreener" />
          ) : null}
        </div>
      </div>
      {/* DEX mode — embed chart */}
      {mode === "dex" && marketView.chartEmbedId && marketView.chartChainSlug ? (
        <div className="overflow-hidden rounded-xl border border-[var(--app-border)]">
          <iframe
            title="Dexscreener chart"
            src={`https://dexscreener.com/${marketView.chartChainSlug}/${marketView.chartEmbedId}?embed=1&theme=dark&trades=0&info=0`}
            className="h-[420px] w-full border-0"
            loading="lazy"
          />
        </div>
      ) : null}
      {/* Bonding mode — simple No DEX pair panel (no progress bar here) */}
      {mode === "bonding" ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-inset)] px-6 py-10">
          <p className="text-sm font-medium">{graduated ? "Graduated to Raydium" : "No DEX pair yet"}</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-center text-xs opacity-70">{chartDescription}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {pumpFunUrl ? (
              <Button size="lg" asChild>
                <a href={pumpFunUrl} target="_blank" rel="noopener noreferrer">
                  Open Pump.fun
                  <ExternalLink className="ml-2 size-4" />
                </a>
              </Button>
            ) : null}
            {dexPairUrl ? (
              <Button variant="outline" size="lg" asChild>
                <a href={dexPairUrl} target="_blank" rel="noopener noreferrer">
                  Search Dexscreener
                  <ExternalLink className="ml-2 size-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* Devnet mode */}
      {mode === "devnet" ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-inset)] py-10">
          <p className="text-muted-foreground text-sm font-medium">Devnet token</p>
          <p className="text-muted-foreground mt-1 max-w-xs text-center text-xs opacity-70">{chartDescription}</p>
        </div>
      ) : null}
      {/* Unknown mode */}
      {mode === "unknown" ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-inset)] px-6 py-10">
          <p className="text-muted-foreground text-sm font-medium">{chartTitle}</p>
          <p className="text-muted-foreground mt-1 max-w-xs text-center text-xs opacity-70">{chartDescription}</p>
          <div className="mt-4 flex gap-2">
            {dexPairUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={dexPairUrl} target="_blank" rel="noopener noreferrer">
                  Search Dexscreener
                  <ExternalLink className="ml-1.5 size-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors">
      {label}<ExternalLink className="size-3" />
    </a>
  );
}
/* ────────────────────────── Fee distributions ────────────────────────── */
function FeeDistributionsSection({
  distributions,
  hasFees,
  totalFeeDisplay,
  creatorFeeDisplay,
  arFeeDisplay,
  totals,
  network,
  isMetaplexLaunch = false,
}: {
  distributions: PublicTokenDetailData["distributions"];
  hasFees: boolean;
  totalFeeDisplay: ReturnType<typeof formatLamportsDisplay>;
  creatorFeeDisplay: ReturnType<typeof formatLamportsDisplay>;
  arFeeDisplay: ReturnType<typeof formatLamportsDisplay>;
  totals: PublicTokenDetailData["totals"];
  network: import("@/lib/agent-launch/network").AgentLaunchNetwork;
  isMetaplexLaunch?: boolean;
}) {
  return (
    <div className="cx-panel">
      <h2 className="cx-panel-title mb-3">Creator fee payouts</h2>
      <p className="cx-panel-desc !mb-4">
        {isMetaplexLaunch
          ? "Creator rewards from this Metaplex Genesis launch, claimable through your AgentRanking agent dashboard."
          : "Creator fees collected from this token's Pump.fun share and sent to the agent/creator wallet."}
      </p>
      {hasFees ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2.5">
              <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">Total distributed</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{totalFeeDisplay.primary}</p>
            </div>
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2.5">
              <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">To creator</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--pm-accent)]">{creatorFeeDisplay.primary}</p>
            </div>
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2.5">
              <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">To treasury</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{arFeeDisplay.primary}</p>
            </div>
          </div>
          {distributions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-[var(--app-border)] text-left">
                    <th className="pb-2 pr-3 font-medium">Date</th>
                    <th className="pb-2 pr-3 font-medium">Amount</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {distributions.map((dist) => (
                    <tr key={dist.id} className="border-b border-[var(--app-border-soft)] last:border-0">
                      <td className="text-muted-foreground py-2 pr-3">{new Date(dist.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 pr-3 font-medium tabular-nums">{formatLamportsDisplay(dist.totalAmount).primary}</td>
                      <td className="py-2 pr-3"><span className="ui-pill ui-pill--ok">Distributed</span></td>
                      <td className="py-2">
                        <a
                          href={launchAddressExplorerUrl(dist.txSignature, network).replace(`address/${dist.txSignature}`, `tx/${dist.txSignature}`)}
                          target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                        >
                          {shortenSolanaAddress(dist.txSignature, 6)}<ExternalLink className="size-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {totals.lastDistributionAt ? (
            <p className="text-muted-foreground mt-3 text-xs">Last distribution: {new Date(totals.lastDistributionAt).toLocaleString()}</p>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-inset)] py-8">
          <p className="text-muted-foreground text-sm font-medium">No creator fee payouts yet</p>
          <p className="text-muted-foreground mt-1 text-xs opacity-70">Fee distributions will appear once this token generates claimable creator fees.</p>
        </div>
      )}
    </div>
  );
}
/* ────────────────────────── Launch details ────────────────────────── */
function LaunchDetailsSection({ mint, creatorWallet, treasuryWallet, creationTx, network, networkLabel, creatorPct, arPct, linkedAgent, launch, isOfficial = false, official }: {
  mint: string;
  creatorWallet: string;
  treasuryWallet: string;
  creationTx: string;
  network: import("@/lib/agent-launch/network").AgentLaunchNetwork;
  networkLabel: string;
  creatorPct: number;
  arPct: number;
  linkedAgent: PublicTokenDetailData["linkedAgent"];
  launch: PublicTokenDetailData["launch"];
  isOfficial?: boolean;
  official?: PublicTokenDetailData["official"];
}) {
  return (
    <div className="ui-panel">
      <h2 className="ui-panel-title mb-3">Token details</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {!isOfficial && linkedAgent ? <DetailRow label="Agent" value={linkedAgent.name} href={linkedAgent.publicHref} /> : null}
        <DetailRow label="Mint" value={mint} copyable monospace />
        {!isOfficial && creatorWallet ? <DetailRow label="Creator wallet" value={creatorWallet} href={launchAddressExplorerUrl(creatorWallet, network)} copyable monospace /> : null}
        {!isOfficial && treasuryWallet ? <DetailRow label="Treasury" value={treasuryWallet} href={treasuryWallet ? launchAddressExplorerUrl(treasuryWallet, network) : undefined} copyable monospace /> : null}
        <DetailRow label="Created" value={new Date(launch.createdAt).toLocaleDateString()} />
        <DetailRow label="Network" value={networkLabel} />
        {!isOfficial ? (
          <DetailRow label="Fee split" value={`${creatorPct}% creator / ${arPct}% treasury`} />
        ) : null}
        <DetailRow
          label="Launch source"
          value={isOfficial ? (official?.badgeLabel ?? "Official AgentRanking Token") : "Pump.fun"}
        />
        {!isOfficial && creationTx ? <DetailRow label="Launch transaction" value={shortenSolanaAddress(creationTx, 8)} href={launchAddressExplorerUrl(creationTx, network).replace(`address/${creationTx}`, `tx/${creationTx}`)} monospace /> : null}
        {isOfficial ? (
          <DetailRow label="Solscan" value="View on Solscan" href={getSolscanTokenUrl(mint, "mainnet-beta")} />
        ) : null}
      </div>
    </div>
  );
}
function DetailRow({ label, value, href, copyable = false, monospace = false }: {
  label: string; value: string; href?: string; copyable?: boolean; monospace?: boolean;
}) {
  const [copied, setCopied] = useTransientState(false, 1500);
  const handleCopy = useCallback(async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }, [setCopied, value]);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--app-border-soft)] bg-[var(--app-inset)] px-3 py-2 overflow-hidden">
      <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider shrink-0 mr-2">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={monospace ? "font-mono text-xs hover:text-[var(--pm-accent)] transition-colors truncate" : "text-xs hover:text-[var(--pm-accent)] transition-colors truncate"}>{value}</a>
        ) : (
          <span className={monospace ? "font-mono text-xs truncate" : "text-xs truncate"}>{value}</span>
        )}
        {copyable ? (
          <button type="button" onClick={handleCopy} className="text-muted-foreground hover:text-[var(--pm-accent)] shrink-0 transition-colors" aria-label={`Copy ${label}`}>
            {copied ? <Check className="size-3.5 text-[var(--pm-accent)]" /> : <Copy className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}
/* ────────────────────────── Right rail ────────────────────────── */
function buildSolanaShareInput({
  tokenName,
  symbol,
  imageUrl,
  mint,
  marketView,
  linkedAgent,
  launchKind,
}: {
  readonly tokenName: string;
  readonly symbol: string;
  readonly imageUrl: string;
  readonly mint: string;
  readonly marketView: PublicTokenMarketViewModel;
  readonly linkedAgent: PublicTokenDetailData["linkedAgent"];
  readonly launchKind: string;
}): TokenDetailShareCardInput {
  const venueLabel =
    resolveSolanaLaunchVenue(launchKind) === "metaplex" ? "Metaplex" : "PumpSwap";
  return {
    tokenName,
    symbol,
    tokenImageUrl: imageUrl,
    chainLabel: "Solana",
    venueLabel,
    sharePath: mint ? `/tokens/${mint}` : "/tokens",
    agentName: linkedAgent?.name ?? null,
    agentImageUrl: linkedAgent?.image ?? null,
    priceLabel: marketView.priceUsd != null ? formatUsd(marketView.priceUsd) : "—",
    mcapLabel: formatUsdCompact(marketView.marketCapUsd),
    volumeLabel: formatUsdCompact(marketView.volume24hUsd),
  };
}
function RightRail({
  tokenName,
  symbol,
  imageUrl,
  mint,
  isMainnet,
  isDevnet,
  profile,
  marketView,
  linkedAgent,
  isOfficial = false,
  launchKind = "agentranking",
}: {
  readonly tokenName: string;
  readonly symbol: string;
  readonly imageUrl: string;
  readonly mint: string;
  readonly isMainnet: boolean;
  readonly isDevnet: boolean;
  readonly profile: PublicTokenDetailData["profile"];
  readonly marketView: PublicTokenMarketViewModel;
  readonly linkedAgent: PublicTokenDetailData["linkedAgent"];
  readonly isOfficial?: boolean;
  readonly launchKind?: string;
}) {
  const { mode, pumpFunUrl, dexPairUrl } = marketView;
  const isMetaplexLaunch = isMetaplexGenesisLaunch(launchKind);
  const metaplexUrl = mint ? metaplexGenesisTokenUrl(mint) : null;
  const primaryTrade = mint
    ? primarySolanaTradeUrl({ mint, launchKind, pumpFunUrl })
    : null;
  const shareInput = buildSolanaShareInput({
    tokenName,
    symbol,
    imageUrl,
    mint,
    marketView,
    linkedAgent,
    launchKind,
  });
  return (
    <div className="ui-panel">
      {/* Token identity */}
      <div className="mb-4 flex items-start gap-3">
        <RuntimeImage src={imageUrl} alt={tokenName} className="size-10 shrink-0 rounded-xl object-cover" onError={(e) => { (e.target as HTMLImageElement).src = LAUNCH_AVATAR_FALLBACK; }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tokenName}</p>
          {symbol ? <p className="text-foreground/70 font-mono text-xs">{symbol}</p> : null}
        </div>
        <TokenDetailShareButton shareInput={shareInput} className="-mt-0.5 -mr-1" />
      </div>
      {/* Trade actions */}
      {isMainnet && mint ? (
        <div className="mb-4 space-y-2">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">Trade</p>
          {primaryTrade ? (
            <Button className="w-full" size="sm" asChild>
              <a href={primaryTrade.href} target="_blank" rel="noopener noreferrer">
                {primaryTrade.label}
                <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </Button>
          ) : null}
          {/* Only show Jupiter if token has a DEX pair */}
          {mode === "dex" && mint ? (
            <Button variant="outline" className="w-full" size="sm" asChild>
              <a href={`https://jup.ag/swap/SOL-${mint}`} target="_blank" rel="noopener noreferrer">Swap on Jupiter<ExternalLink className="ml-1.5 size-3.5" /></a>
            </Button>
          ) : null}
        </div>
      ) : isDevnet && mint ? (
        <div className="mb-4 space-y-2">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">Trade</p>
          <p className="text-muted-foreground rounded-md border border-dashed border-[var(--app-border)] px-3 py-2 text-center text-xs">Trading unavailable on devnet</p>
        </div>
      ) : null}
      {/* Graduation / bonding progress */}
      {!isOfficial && !isMetaplexLaunch ? (
        <div className="mb-4">
          <TokenGraduationBar
            graduation={marketView.graduation}
            title="Pump.fun bonding curve"
            tone="solana"
          />
        </div>
      ) : null}
      {!isOfficial && isMetaplexLaunch ? (
        <div className="mb-4 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Metaplex Genesis launch — trade and bonding progress live on Metaplex.
        </div>
      ) : null}
      {/* Mint copy */}
      {mint ? (
        <RailMintCopy mint={mint} />
      ) : null}
      {/* External links */}
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">Links</p>
        <div className="space-y-1">
          {isMainnet && mint ? (
            <>
              {isMetaplexLaunch && metaplexUrl ? (
                <RailLink href={metaplexUrl} label="Metaplex" />
              ) : null}
              {!isMetaplexLaunch && pumpFunUrl ? <RailLink href={pumpFunUrl} label="Pump.fun" /> : null}
              {dexPairUrl ? <RailLink href={dexPairUrl} label="Dexscreener" /> : null}
              <RailLink href={getSolscanTokenUrl(mint, "mainnet-beta")} label="Solscan" />
            </>
          ) : isDevnet && mint ? (
            <RailLink href={getSolscanTokenUrl(mint, "devnet")} label="Solscan (devnet)" />
          ) : null}
          {profile.website ? <RailLink href={profile.website} label="Website" /> : null}
          {profile.twitter ? <RailLink href={profile.twitter.startsWith("http") ? profile.twitter : `https://x.com/${profile.twitter.replace(/^@/, "")}`} label="X (Twitter)" /> : null}
          {profile.telegram ? <RailLink href={profile.telegram.startsWith("http") ? profile.telegram : `https://t.me/${profile.telegram.replace(/^@/, "")}`} label="Telegram" /> : null}
        </div>
      </div>
    </div>
  );
}
function RailMintCopy({ mint }: { readonly mint: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(mint);
    setCopied(true);
  }, [mint]);
  return (
    <div className="mb-4 space-y-1.5">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">CA</p>
      <div className="flex items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2">
        <p className="flex-1 truncate font-mono text-xs">{shortenSolanaAddress(mint, 8)}</p>
        <button type="button" onClick={handleCopy} className="text-muted-foreground hover:text-[var(--pm-accent)] shrink-0 transition-colors" aria-label="Copy mint address">
          {copied ? <Check className="size-3.5 text-[var(--pm-accent)]" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
function RailLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--app-text)]/70 hover:text-[var(--app-text)] hover:bg-[var(--app-panel-hover)] flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors">
      {label}<ExternalLink className="size-3 text-[var(--app-text)]/40" />
    </a>
  );
}
