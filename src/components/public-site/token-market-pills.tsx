import { RuntimeImage } from "@/components/shared/runtime-image";
import type { ReactNode } from "react";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { cn } from "@/lib/utils";
export type TokenMarketPillChain = "solana" | "evm";
export type TokenMarketPillVenue = "pumpswap" | "metaplex" | "robinhood" | null;
function ChainPill({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "ui-pill ui-pill--info inline-flex items-center gap-1 text-[9px]",
        className,
      )}
    >
      {children}
    </span>
  );
}
function SolanaMark({ className }: { readonly className?: string }) {
  return (
    <RuntimeImage
      src="/branding/solana/solanaLogoMark.svg"
      alt=""
      className={cn("h-3 w-3 shrink-0", className)}
      aria-hidden
    />
  );
}
function PumpSwapMark({ className }: { readonly className?: string }) {
  return (
    <RuntimeImage
      src="/brandkit/protocol-logos/pumpfun.png"
      alt=""
      className={cn("h-3 w-3 shrink-0 rounded-sm object-cover", className)}
      aria-hidden
    />
  );
}
function MetaplexMark({ className }: { readonly className?: string }) {
  return (
    <RuntimeImage
      src="/branding/metaplex/metaplex-icon.png"
      alt=""
      className={cn("h-3 w-3 shrink-0 rounded-sm object-cover", className)}
      aria-hidden
    />
  );
}
type Props = {
  readonly chain: TokenMarketPillChain;
  readonly venue?: TokenMarketPillVenue;
  /** Use "AR Token" for official $AR; default "AR Launch". */
  readonly originLabel?: "AR Launch" | "AR Token";
  readonly className?: string;
};
/** Consistent pills for token cards + detail heroes (Solana / EVM + venue). */
export function TokenMarketPills({
  chain,
  venue = null,
  originLabel = "AR Launch",
  className,
}: Props) {
  const resolvedVenue: TokenMarketPillVenue =
    venue ?? (chain === "solana" ? "pumpswap" : "robinhood");
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <ChainPill>{originLabel}</ChainPill>
      {chain === "solana" ? (
        <ChainPill>
          <SolanaMark />
          Solana
        </ChainPill>
      ) : (
        <ChainPill>
          <EthereumIcon className="h-3 w-3" />
          EVM
        </ChainPill>
      )}
      {resolvedVenue === "pumpswap" ? (
        <ChainPill>
          <PumpSwapMark />
          PumpSwap
        </ChainPill>
      ) : null}
      {resolvedVenue === "metaplex" ? (
        <ChainPill>
          <MetaplexMark />
          Metaplex
        </ChainPill>
      ) : null}
      {resolvedVenue === "robinhood" ? (
        <ChainPill>
          <RobinhoodChainIcon className="h-3 w-3" />
          Robinhood
        </ChainPill>
      ) : null}
    </div>
  );
}
