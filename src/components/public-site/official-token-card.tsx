import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { PublicTokenAvatar } from "@/components/public-site/token-avatar";
import { TokenMarketPills } from "@/components/public-site/token-market-pills";
import { formatUsdCompact } from "@/lib/public-site/formatters";
import type { OfficialPublicToken } from "@/lib/public-site/official-tokens";
import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import { TokenGraduationBar } from "@/components/public-site/token-graduation-bar";
type Props = {
  readonly token: OfficialPublicToken;
  readonly market: TokenMarketSnapshot | null;
};
export function OfficialTokenCard({ token, market }: Props) {
  const href = publicTokenDetailHref(token.mint);
  const symbol = token.symbol ? `$${token.symbol}` : "—";
  const mcap = market?.marketCapUsd ?? market?.fdvUsd;
  const volume24h = market?.volume24hUsd;
  return (
    <Link
      href={href}
      className="ui-public-site-card group flex h-full flex-col p-3 transition-colors hover:border-[var(--app-border-strong)]"
    >
      <div className="flex items-start gap-3">
        <PublicTokenAvatar
          name={token.name}
          symbol={token.symbol}
          imageUrl={token.imageUrl}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[1.375rem] min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{token.name}</p>
            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-foreground" aria-label="Verified official token" />
          </div>
          <p className="text-muted-foreground font-mono text-xs">{symbol}</p>
        </div>
      </div>
      <TokenMarketPills
        className="mt-3"
        chain="solana"
        venue="pumpswap"
        originLabel="AR Token"
      />
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border/60 px-2 py-1.5">
          <span className="text-muted-foreground block text-[10px] uppercase">MCAP</span>
          <span className="font-medium tabular-nums">{formatUsdCompact(mcap)}</span>
        </div>
        <div className="rounded-md border border-border/60 px-2 py-1.5">
          <span className="text-muted-foreground block text-[10px] uppercase">24h</span>
          <span className="font-medium tabular-nums">{formatUsdCompact(volume24h)}</span>
        </div>
      </div>
      <TokenGraduationBar
        graduation={{
          progressPct: 100,
          graduated: true,
          statusLabel: "Graduated",
          detailLabel: "Official $AR",
          showBar: true,
        }}
        compact
        title="Graduation"
        tone="solana"
      />
      <div className="mt-auto flex items-center justify-end pt-3">
        <span className="ui-public-site-accent text-xs font-semibold">View →</span>
      </div>
    </Link>
  );
}
