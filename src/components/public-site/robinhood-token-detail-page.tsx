"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useTransientState } from "@/hooks/use-transient-state";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { TokenMarketPills } from "@/components/public-site/token-market-pills";
import { TokenDetailShareButton } from "@/components/public-site/token-detail-share-button";
import { RobinhoodTokenImage } from "@/components/robinhood-chain/robinhood-token-image";
import { QuiverLiquidityCard } from "@/components/robinhood-chain/quiver-liquidity-card";
import { quiverfunTokenUrl } from "@/lib/robinhood-chain/quiverfun-urls";
import { formatUsd, formatUsdCompact } from "@/lib/public-site/formatters";
import type { PublicTokenMarketViewModel } from "@/lib/public-site/market-view-model";
import type { TokenDetailShareCardInput } from "@/lib/public-site/token-detail-share-card";
import type { RobinhoodPublicTokenDetailData } from "@/lib/public-site/robinhood-token-detail-data.server";
import {
  robinhoodExplorerAddressUrl,
  robinhoodExplorerTxUrl,
} from "@/lib/robinhood-chain/config";
import { shortenEvmAddress } from "@/lib/evm-wallet-utils";
import { LAUNCH_AVATAR_FALLBACK } from "@/lib/agent-launch/launch-profile";
type Props = {
  readonly data: RobinhoodPublicTokenDetailData;
};
export function RobinhoodPublicTokenDetailPage({ data }: Props) {
  const { launch, imageUrl, linkedAgent, marketView, creatorFeeBps, arFeeBps } = data;
  const symbol = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "";
  const tokenName = launch.tokenName || symbol || "Token";
  const description = launch.tokenDescription?.trim() || null;
  const creatorPct = creatorFeeBps / 100;
  const arPct = arFeeBps / 100;
  const uniswapPoolUrl = launch.poolAddress
    ? `https://app.uniswap.org/explore/pools/4663/${launch.poolAddress}`
    : null;
  return (
    <div className="ui-page-stack">
      <Link
        href="/tokens/robinhood"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        All Robinhood Chain tokens
      </Link>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 ui-page-stack">
          <HeroSection
            tokenName={tokenName}
            symbol={symbol}
            description={description}
            imageUrl={imageUrl}
            launch={launch}
            linkedAgent={linkedAgent}
          />
          <MetricCards marketView={marketView} />
          <MarketPanel marketView={marketView} uniswapPoolUrl={uniswapPoolUrl} />
          {linkedAgent ? (
            <LinkedAgentCard linkedAgent={linkedAgent} />
          ) : null}
          <LaunchDetailsSection
            launch={launch}
            creatorPct={creatorPct}
            arPct={arPct}
            linkedAgent={linkedAgent}
          />
        </div>
        <div className="w-full shrink-0 ui-page-stack lg:sticky lg:top-20 lg:w-[320px] xl:w-[360px]">
          <RightRail
            tokenName={tokenName}
            symbol={symbol}
            imageUrl={imageUrl}
            launch={launch}
            marketView={marketView}
            linkedAgent={linkedAgent}
            uniswapPoolUrl={uniswapPoolUrl}
          />
        </div>
      </div>
    </div>
  );
}
function HeroSection({
  tokenName,
  symbol,
  description,
  imageUrl,
  launch,
  linkedAgent,
}: {
  tokenName: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  launch: RobinhoodPublicTokenDetailData["launch"];
  linkedAgent: RobinhoodPublicTokenDetailData["linkedAgent"];
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="relative size-20 sm:size-24 shrink-0 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-raised)]">
        <RobinhoodTokenImage
          source={{
            tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl ?? imageUrl,
            tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
            tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
            tokenImageUrl: launch.tokenImageUrl,
            agentImage: linkedAgent?.image,
            tokenName: launch.tokenName,
            tokenSymbol: launch.tokenSymbol,
          }}
          alt={tokenName}
          fill
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <TokenMarketPills chain="evm" venue="robinhood" originLabel="AR Launch" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[length:var(--app-text-lg)]">
          {tokenName}
        </h1>
        {symbol ? <p className="text-foreground/70 font-mono text-sm">{symbol}</p> : null}
        {linkedAgent ? (
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
          <p className="text-foreground/70 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
        <SocialLinks launch={launch} />
      </div>
    </div>
  );
}
function SocialLinks({ launch }: { launch: RobinhoodPublicTokenDetailData["launch"] }) {
  const links: { label: string | null; href: string; ariaLabel: string; icon: React.ReactNode }[] = [];
  if (launch.website) {
    links.push({
      label: "Website",
      ariaLabel: "Website",
      href: launch.website.startsWith("http") ? launch.website : `https://${launch.website}`,
      icon: <Globe className="size-3.5" />,
    });
  }
  if (launch.twitter) {
    const href = launch.twitter.startsWith("http")
      ? launch.twitter
      : `https://x.com/${launch.twitter.replace(/^@/, "")}`;
    links.push({
      label: null,
      ariaLabel: "X",
      href,
      icon: <span className="text-sm font-semibold leading-none" aria-hidden>𝕏</span>,
    });
  }
  if (launch.telegram) {
    const href = launch.telegram.startsWith("http")
      ? launch.telegram
      : `https://t.me/${launch.telegram.replace(/^@/, "")}`;
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
    <div className="mt-3 flex flex-wrap items-center gap-2">
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
function MetricCards({ marketView }: { readonly marketView: PublicTokenMarketViewModel }) {
  const volumeValue = marketView.volumeIsZero
    ? "$0"
    : marketView.volume24hUsd != null
      ? formatUsdCompact(marketView.volume24hUsd)
      : "—";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard label="Price" value={formatUsd(marketView.priceUsd)} sub={marketView.priceSub} />
      <MetricCard
        label="Market Cap"
        value={marketView.marketCapUsd != null ? formatUsdCompact(marketView.marketCapUsd) : "—"}
      />
      <MetricCard label="24h Volume" value={volumeValue} sub={marketView.volumeSub} />
      <MetricCard
        label="Liquidity"
        value={marketView.liquidityDisplay}
        sub={marketView.liquiditySub}
      />
    </div>
  );
}
function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
      <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </span>
      <span className="mt-1 text-lg font-bold tabular-nums text-[var(--app-text)]">{value}</span>
      {sub ? (
        <span className="text-muted-foreground mt-0.5 text-[11px] opacity-60">{sub}</span>
      ) : null}
    </div>
  );
}
function MarketPanel({
  marketView,
  uniswapPoolUrl,
}: {
  readonly marketView: PublicTokenMarketViewModel;
  readonly uniswapPoolUrl: string | null;
}) {
  const { mode, dexPairUrl, chartTitle, chartDescription, chartEmbedId, chartChainSlug } =
    marketView;
  return (
    <div className="ui-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="ui-panel-title">{chartTitle}</h2>
        <div className="flex items-center gap-2">
          {dexPairUrl ? <ExternalLinkButton href={dexPairUrl} label="Dexscreener" /> : null}
          {uniswapPoolUrl ? <ExternalLinkButton href={uniswapPoolUrl} label="Uniswap" /> : null}
        </div>
      </div>
      {mode === "dex" && chartEmbedId && chartChainSlug ? (
        <div className="overflow-hidden rounded-xl border border-[var(--app-border)]">
          <iframe
            title="Dexscreener chart"
            src={`https://dexscreener.com/${chartChainSlug}/${chartEmbedId}?embed=1&theme=dark&trades=0&info=0`}
            className="h-[420px] w-full border-0"
            loading="lazy"
          />
        </div>
      ) : null}
      {mode === "bonding" || mode === "unknown" ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-inset)] px-6 py-10">
          <p className="text-sm font-medium">
            {mode === "bonding" ? "Indexing market data" : chartTitle}
          </p>
          <p className="text-muted-foreground mt-1 max-w-sm text-center text-xs opacity-70">
            {chartDescription}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {uniswapPoolUrl ? (
              <Button size="lg" asChild>
                <a href={uniswapPoolUrl} target="_blank" rel="noopener noreferrer">
                  Open Uniswap
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
    </div>
  );
}
function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}
function LinkedAgentCard({
  linkedAgent,
}: {
  linkedAgent: NonNullable<RobinhoodPublicTokenDetailData["linkedAgent"]>;
}) {
  return (
    <div className="ui-panel">
      <p className="text-muted-foreground mb-3 text-[10px] font-medium uppercase tracking-wider">
        Linked agent
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/dashboard/agents/${linkedAgent.agentDbId}`}
          className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90"
        >
          <AgentAvatar image={linkedAgent.image} name={linkedAgent.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{linkedAgent.name}</p>
            <p className="text-muted-foreground text-xs">Agent #{linkedAgent.agentDbId}</p>
          </div>
        </Link>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/agents/${linkedAgent.agentDbId}`}>View agent</Link>
        </Button>
      </div>
    </div>
  );
}
function LaunchDetailsSection({
  launch,
  creatorPct,
  arPct,
  linkedAgent,
}: {
  launch: RobinhoodPublicTokenDetailData["launch"];
  creatorPct: number;
  arPct: number;
  linkedAgent: RobinhoodPublicTokenDetailData["linkedAgent"];
}) {
  return (
    <div className="ui-panel">
      <h2 className="ui-panel-title mb-3">Launch details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow
          label="Token contract"
          value={shortenEvmAddress(launch.tokenAddress, 6)}
          href={robinhoodExplorerAddressUrl(launch.tokenAddress)}
          copyValue={launch.tokenAddress}
          mono
        />
        <DetailRow
          label="Creator wallet"
          value={shortenEvmAddress(launch.creatorWallet, 6)}
          href={robinhoodExplorerAddressUrl(launch.creatorWallet)}
          copyValue={launch.creatorWallet}
          mono
        />
        <DetailRow
          label="Liquidity pool"
          value={launch.poolAddress ? shortenEvmAddress(launch.poolAddress, 6) : "—"}
          href={launch.poolAddress ? robinhoodExplorerAddressUrl(launch.poolAddress) : undefined}
          copyValue={launch.poolAddress ?? undefined}
          mono
        />
        <DetailRow
          label="Launch tx"
          value={shortenEvmAddress(launch.txHash, 6)}
          href={launch.txHash.startsWith("0x") ? robinhoodExplorerTxUrl(launch.txHash) : undefined}
          copyValue={launch.txHash}
          mono
        />
        <DetailRow label="Chain" value="Robinhood Chain (4663)" />
        <DetailRow
          label="Fee split on claim"
          value={`${creatorPct}% creator / ${arPct}% AgentRanking`}
        />
        {linkedAgent ? (
          <DetailRow label="Linked agent" value={linkedAgent.name} />
        ) : null}
        <DetailRow
          label="Launched"
          value={new Date(launch.blockTimestamp).toLocaleString()}
        />
      </div>
      <p className="text-muted-foreground mt-3 text-[11px]">
        Claim pays WETH from the Quiver LP locker. AgentRanking&apos;s
        share is sent on claim.
      </p>
    </div>
  );
}
function DetailRow({
  label,
  value,
  href,
  copyValue,
  mono,
}: {
  label: string;
  value: string;
  href?: string;
  copyValue?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useTransientState(false, 1500);
  const handleCopy = useCallback(async () => {
    if (!copyValue) return;
    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
  }, [copyValue, setCopied]);
  return (
    <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2.5">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {label}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={
              mono
                ? "truncate font-mono text-xs transition-colors hover:text-[var(--pm-accent)]"
                : "truncate text-xs transition-colors hover:text-[var(--pm-accent)]"
            }
          >
            {value}
          </a>
        ) : (
          <span className={mono ? "truncate font-mono text-xs" : "truncate text-xs"}>
            {value}
          </span>
        )}
        {copyValue ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="text-muted-foreground hover:text-[var(--pm-accent)] shrink-0 transition-colors"
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="size-3.5 text-[var(--pm-accent)]" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
function buildRobinhoodShareInput({
  tokenName,
  symbol,
  imageUrl,
  launch,
  marketView,
  linkedAgent,
}: {
  readonly tokenName: string;
  readonly symbol: string;
  readonly imageUrl: string | null;
  readonly launch: RobinhoodPublicTokenDetailData["launch"];
  readonly marketView: PublicTokenMarketViewModel;
  readonly linkedAgent: RobinhoodPublicTokenDetailData["linkedAgent"];
}): TokenDetailShareCardInput {
  return {
    tokenName,
    symbol,
    tokenImageUrl:
      launch.tokenLogoGatewayUrl ??
      imageUrl ??
      launch.tokenImageUrl ??
      null,
    chainLabel: "EVM",
    venueLabel: "Robinhood",
    sharePath: `/tokens/robinhood/${launch.tokenAddress}`,
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
  launch,
  marketView,
  linkedAgent,
  uniswapPoolUrl,
}: {
  tokenName: string;
  symbol: string;
  imageUrl: string | null;
  launch: RobinhoodPublicTokenDetailData["launch"];
  marketView: PublicTokenMarketViewModel;
  linkedAgent: RobinhoodPublicTokenDetailData["linkedAgent"];
  uniswapPoolUrl: string | null;
}) {
  const shareInput = buildRobinhoodShareInput({
    tokenName,
    symbol,
    imageUrl,
    launch,
    marketView,
    linkedAgent,
  });
  return (
    <div className="ui-panel">
      <div className="mb-4 flex items-start gap-3">
        <div className="relative size-10 shrink-0 overflow-hidden rounded-xl border border-[var(--app-border)]">
          <RobinhoodTokenImage
            source={{
              tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl ?? imageUrl,
              tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
              tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
              tokenImageUrl: launch.tokenImageUrl,
              tokenName: launch.tokenName,
              tokenSymbol: launch.tokenSymbol,
            }}
            alt={tokenName}
            fill
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tokenName}</p>
          {symbol ? <p className="text-foreground/70 font-mono text-xs">{symbol}</p> : null}
        </div>
        <TokenDetailShareButton shareInput={shareInput} className="-mt-0.5 -mr-1" />
      </div>
      <div className="mb-4 space-y-2">
        <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          Trade
        </p>
        {uniswapPoolUrl ? (
          <Button className="w-full" size="sm" asChild>
            <a href={uniswapPoolUrl} target="_blank" rel="noopener noreferrer">
              Trade on Uniswap
              <ExternalLink className="ml-1.5 size-3.5" />
            </a>
          </Button>
        ) : null}
        {marketView.dexPairUrl ? (
          <Button variant="outline" className="w-full" size="sm" asChild>
            <a href={marketView.dexPairUrl} target="_blank" rel="noopener noreferrer">
              Open Dexscreener
              <ExternalLink className="ml-1.5 size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
      <div className="mb-4">
        <QuiverLiquidityCard
          tokenAddress={launch.tokenAddress}
          tokenSymbol={launch.tokenSymbol}
          detailLabel={marketView.graduation.detailLabel}
          statusLabel={marketView.graduation.statusLabel}
        />
      </div>
      <RailAddressCopy
        label="CA"
        address={launch.tokenAddress}
        display={shortenEvmAddress(launch.tokenAddress, 8)}
      />
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          Links
        </p>
        <div className="space-y-1">
          {uniswapPoolUrl ? <RailLink href={uniswapPoolUrl} label="Uniswap" /> : null}
          {marketView.dexPairUrl ? (
            <RailLink href={marketView.dexPairUrl} label="Dexscreener" />
          ) : null}
          <RailLink href={quiverfunTokenUrl(launch.tokenAddress)} label="Quiverfun" />
          <RailLink
            href={robinhoodExplorerAddressUrl(launch.tokenAddress)}
            label="Explorer"
          />
          {launch.website ? (
            <RailLink
              href={
                launch.website.startsWith("http") ? launch.website : `https://${launch.website}`
              }
              label="Website"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
function RailAddressCopy({
  label,
  address,
  display,
}: {
  label: string;
  address: string;
  display: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
  }, [address, setCopied]);
  return (
    <div className="mb-4 space-y-1.5">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-inset)] px-3 py-2">
        <p className="flex-1 truncate font-mono text-xs">{display}</p>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="text-muted-foreground hover:text-[var(--pm-accent)] shrink-0 transition-colors"
          aria-label="Copy contract address"
        >
          {copied ? (
            <Check className="size-3.5 text-[var(--pm-accent)]" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
function RailLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--app-panel-hover)]"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}
