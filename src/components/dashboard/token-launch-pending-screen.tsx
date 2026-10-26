"use client";
import { Loader2 } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { cn } from "@/lib/utils";
type Props = {
  readonly title?: string;
  readonly subtitle?: string;
  readonly tokenName?: string;
  readonly tokenSymbol?: string;
  readonly imageUrl?: string | null;
  readonly phaseLabel?: string | null;
  readonly className?: string;
};
/** Full-page waiting state after Solana / Metaplex / Robinhood launch. */
export function LaunchTokenPendingScreen({
  title = "Launching your token",
  subtitle = "Hang tight — we’re publishing your launch to AgentRanking.",
  tokenName,
  tokenSymbol,
  imageUrl,
  phaseLabel,
  className,
}: Props) {
  const symbolLabel = (() => {
    const raw = tokenSymbol?.trim();
    if (!raw) return null;
    return raw.startsWith("$") ? raw : `$${raw}`;
  })();
  return (
    <div
      className={cn(
        "ui-panel flex min-h-[420px] flex-col items-center justify-center gap-5 p-8 text-center",
        className,
      )}
    >
      <div className="relative">
        <AgentAvatar
          image={imageUrl || undefined}
          name={tokenName || symbolLabel || "Token"}
          size="lg"
          className="!h-20 !w-20 rounded-2xl"
        />
        <span className="bg-background absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 shadow-sm">
          <Loader2 className="text-primary h-4 w-4 animate-spin" aria-hidden />
        </span>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {(tokenName || symbolLabel) && (
          <p className="text-sm font-medium">
            {tokenName}
            {tokenName && symbolLabel ? " · " : null}
            {symbolLabel}
          </p>
        )}
        <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
          {subtitle}
        </p>
        {phaseLabel ? (
          <p className="text-muted-foreground pt-1 text-xs capitalize">{phaseLabel}</p>
        ) : null}
      </div>
    </div>
  );
}
