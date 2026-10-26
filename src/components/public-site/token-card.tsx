import Link from "next/link";
import type { ReactNode } from "react";
import type { LaunchIndexCardModel, TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import { PublicTokenAvatar } from "@/components/public-site/token-avatar";
import { TokenMarketPills } from "@/components/public-site/token-market-pills";
import { CardSocialIcons } from "@/components/public-site/card-social-icons";
import { formatUsdCompact } from "@/lib/public-site/formatters";
import { isArTokenVerified } from "@/lib/agent-launch/token-verification";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { shortenEvmAddress } from "@/lib/evm-wallet-utils";
import { TokenGraduationBar } from "@/components/public-site/token-graduation-bar";
import { QuiverLiquidityCard } from "@/components/robinhood-chain/quiver-liquidity-card";
import type { TokenGraduationDisplay } from "@/lib/public-site/token-graduation";
import type { TokenCardSocials } from "@/lib/public-site/token-card-market";
import { resolveSolanaLaunchVenue } from "@/lib/agent-launch/launch-venue";
type Props = {
  readonly model: LaunchIndexCardModel | TokenDiscoveryCardModel;
  readonly compact?: boolean;
};
function isDiscovery(model: LaunchIndexCardModel | TokenDiscoveryCardModel): model is TokenDiscoveryCardModel {
  return "chain" in model;
}
const EMPTY_GRADUATION: TokenGraduationDisplay = {
  progressPct: 0,
  graduated: false,
  statusLabel: "0%",
  detailLabel: null,
  showBar: true,
};
function MetricCell({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-h-[2.75rem] flex-col justify-center rounded-md border border-border/60 px-2 py-1.5">
      <span className="text-muted-foreground block text-[10px] uppercase leading-none">{label}</span>
      <span className="mt-1 font-medium tabular-nums leading-none">{value}</span>
    </div>
  );
}
function resolveGraduation(graduation: TokenGraduationDisplay | null): TokenGraduationDisplay {
  if (!graduation?.showBar || graduation.progressPct == null) {
    return EMPTY_GRADUATION;
  }
  return graduation;
}
export function PublicTokenCard({ model, compact = false }: Props) {
  let href: string;
  let symbol: string;
  let imageUrl: string | null;
  let displayName: string;
  let linkedAgent: LaunchIndexCardModel["linkedAgent"] | null;
  let market: LaunchIndexCardModel["market"] | null;
  let socials: TokenCardSocials;
  let chain: "solana" | "robinhood" = "solana";
  let tokenVerified = false;
  let graduation: TokenGraduationDisplay | null = null;
  let creatorWallet: string | null = null;
  let robinhoodTokenAddress: string | null = null;
  let solanaVenue: "pumpswap" | "metaplex" = "pumpswap";
  if (isDiscovery(model)) {
    href = model.detailHref;
    linkedAgent = model.linkedAgent;
    market = model.market;
    socials = model.socials ?? { twitter: null, telegram: null, website: null };
    graduation = model.graduation;
    chain = model.chain;
    if (model.chain === "robinhood") {
      symbol = model.tokenSymbol ? `$${model.tokenSymbol}` : "—";
      imageUrl = model.tokenImageUrl;
      displayName = model.tokenName ?? "Unnamed";
      creatorWallet = model.rh?.creatorWallet ?? null;
      robinhoodTokenAddress = model.rh?.tokenAddress ?? null;
    } else {
      const launch = model.launch?.launch;
      symbol = launch?.tokenSymbol ? `$${launch.tokenSymbol}` : "—";
      imageUrl = model.tokenImageUrl;
      displayName = model.tokenName ?? "Unnamed";
      tokenVerified = launch ? isArTokenVerified(launch.arTokenVerificationStatus) : false;
      solanaVenue = resolveSolanaLaunchVenue(launch?.launchKind);
    }
  } else {
    const { launch, profile } = model;
    solanaVenue = resolveSolanaLaunchVenue(launch.launchKind);
    href = launch.mint ? `/tokens/${launch.mint}` : "#";
    symbol = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "—";
    imageUrl = model.tokenImageUrl;
    displayName = profile.displayName;
    linkedAgent = model.linkedAgent;
    market = model.market;
    socials = model.socials ?? { twitter: null, telegram: null, website: null };
    graduation = model.graduation;
    tokenVerified = isArTokenVerified(launch.arTokenVerificationStatus);
  }
  const barGraduation = resolveGraduation(graduation);
  const mcap = market?.marketCapUsd ?? market?.fdvUsd;
  const ath = market?.athMarketCapUsd;
  const volume24h = market?.volume24hUsd;
  let byline: ReactNode = "\u00a0";
  if (linkedAgent) {
    byline = (
      <>
        By <span className="text-foreground/90">{linkedAgent.name}</span>
      </>
    );
  } else if (creatorWallet) {
    byline = (
      <>
        Creator{" "}
        <span className="text-foreground/90 font-mono text-[10px]">
          {shortenEvmAddress(creatorWallet)}
        </span>
      </>
    );
  }
  return (
    <div className="ui-public-site-card group relative flex h-full min-h-[16.5rem] flex-col transition-colors hover:border-[var(--app-border-strong)]">
      <CardSocialIcons socials={socials} />
      <Link href={href} className="flex h-full min-h-0 flex-col p-3">
        {/* Header — fixed 3-line slot so cards stay even with/without byline/socials */}
        <div className="flex min-h-[3.75rem] items-start gap-3 pr-14">
          <PublicTokenAvatar
            name={displayName}
            symbol={isDiscovery(model) ? model.tokenSymbol : model.launch.tokenSymbol}
            imageUrl={imageUrl}
            size={compact ? "sm" : "md"}
          />
          <div className="min-w-0 flex-1">
            <p className="flex h-5 items-center gap-1 truncate text-sm font-semibold leading-none">
              <span className="truncate">{displayName}</span>
              {tokenVerified ? <VerifiedTick size="sm" tone="foreground" /> : null}
            </p>
            <p className="text-muted-foreground mt-1 h-4 truncate font-mono text-xs leading-none">
              {symbol}
            </p>
            <p className="text-muted-foreground mt-1 h-4 truncate text-[11px] leading-none">
              {byline}
            </p>
          </div>
        </div>
        <TokenMarketPills
          className="mt-3 min-h-[1.5rem]"
          chain={chain === "robinhood" ? "evm" : "solana"}
          venue={chain === "robinhood" ? "robinhood" : solanaVenue}
          originLabel="AR Launch"
        />
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <MetricCell label="MCAP" value={formatUsdCompact(mcap)} />
          <MetricCell label="ATH" value={formatUsdCompact(ath)} />
          <MetricCell label="24H" value={formatUsdCompact(volume24h)} />
        </div>
        {/* Footer pinned to bottom — graduation + CTA always same place */}
        <div className="mt-auto flex flex-col pt-3">
          <div className="min-h-[2.5rem]">
            {chain === "robinhood" && robinhoodTokenAddress ? (
              <QuiverLiquidityCard
                tokenAddress={robinhoodTokenAddress}
                tokenSymbol={isDiscovery(model) ? model.tokenSymbol : null}
                detailLabel={graduation?.detailLabel}
                statusLabel={graduation?.statusLabel ?? "Live"}
                compact
                className="mt-0"
              />
            ) : solanaVenue === "metaplex" ? (
              <div className="text-muted-foreground rounded-md border border-border/60 px-2 py-1.5 text-[10px] uppercase tracking-wide">
                Metaplex Genesis
              </div>
            ) : (
              <TokenGraduationBar
                graduation={barGraduation}
                compact
                title="Graduation"
                tone="solana"
                className="mt-0"
              />
            )}
          </div>
          <div className="flex h-5 items-center justify-end pt-2">
            <span className="ui-public-site-accent text-xs font-semibold">View →</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
