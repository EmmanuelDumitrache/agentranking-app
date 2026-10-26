"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import Link from "next/link";

import { Check, Copy, ExternalLink, Hexagon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { showToast } from "@/components/ui/toast-simple";
import { oobeExplorerAccountUrl } from "@/components/agents/sap-verified-badge";
import { cn, timeAgo, truncateAddress } from "@/lib/utils";
export type SapIndexAttributionProps = {
  readonly sapAgentPda?: string | null;
  readonly sapStatsPda?: string | null;
  readonly sapLastSyncedAt?: string | null;
  readonly sapOwnerWallet?: string | null;
  /** `compact` for dashboard footer; `full` for agent detail sections. */
  readonly variant?: "compact" | "full";
  readonly className?: string;
};
function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address)}`;
}
function CopyMini({ value, label }: { readonly value: string; readonly label?: string }) {
  const [copied, setCopied] = useTransientState(false, 1500);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          showToast(label ? `${label} copied` : "Copied");
        });
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
function PdaRow({
  label,
  value,
  explorerHref,
}: {
  readonly label: string;
  readonly value: string;
  readonly explorerHref: string;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <code className="font-mono text-[11px] break-all text-foreground/90">{truncateAddress(value, 8)}</code>
        <CopyMini value={value} label={label} />
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-emerald-400/90 hover:text-emerald-300 text-xs"
        >
          OOBE <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={solscanAccountUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-violet-300/90 hover:text-violet-200 text-xs"
        >
          Solscan <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
function SynapseRpcBadge({ compact }: { readonly compact?: boolean }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/docs/agent-index#chains-and-protocols" className="inline-flex shrink-0">
            <Badge
              variant="outline"
              className={cn(
                "gap-1 border-emerald-500/45 bg-emerald-950/35 text-emerald-300 hover:bg-emerald-900/45",
                compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs font-medium",
              )}
            >
              <Hexagon className={cn("text-emerald-400", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
              Indexed via Synapse RPC
            </Badge>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs border-border bg-card text-card-foreground text-xs">
          SAP fields are synced from the Synapse / OOBE RPC indexer into AgentRanking (not live RPC on this page).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
/** Attribution for SAP-backed listings — Postgres snapshot only. */
export function SapIndexAttribution({
  sapAgentPda,
  sapStatsPda,
  sapLastSyncedAt,
  sapOwnerWallet,
  variant = "full",
  className,
}: SapIndexAttributionProps) {
  const pda = sapAgentPda?.trim() ?? "";
  const statsPda = sapStatsPda?.trim() ?? "";
  const owner = sapOwnerWallet?.trim() ?? "";
  const synced = sapLastSyncedAt?.trim() ?? "";
  const syncedLabel = synced ? timeAgo(new Date(synced)) : null;
  if (variant === "compact") {
    return (
      <p className={cn("text-[11px] text-muted-foreground flex flex-wrap items-center gap-2", className)}>
        <SynapseRpcBadge compact />
        <span>
          SAP listings indexed via periodic sync
          {syncedLabel ? ` · last directory sync ${syncedLabel}` : ""}.
        </span>
        <Link href="/docs/agent-index#chains-and-protocols" className="text-emerald-400/90 hover:text-emerald-300 underline-offset-4 hover:underline">
          Learn more
        </Link>
      </p>
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-3 space-y-3 text-xs min-w-0",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SynapseRpcBadge />
        {syncedLabel ? (
          <span className="text-muted-foreground">
            Last synced: <span className="text-foreground font-medium">{syncedLabel}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Last synced: —</span>
        )}
      </div>
      {pda ? <PdaRow label="SAP Agent PDA" value={pda} explorerHref={oobeExplorerAccountUrl(pda)} /> : null}
      {statsPda ? (
        <PdaRow label="Stats PDA" value={statsPda} explorerHref={oobeExplorerAccountUrl(statsPda)} />
      ) : pda ? (
        <p className="text-muted-foreground">Stats PDA not resolved on last indexer run.</p>
      ) : null}
      {owner ? (
        <div className="flex flex-col gap-2 min-w-0">
          <span className="text-muted-foreground">Owner wallet</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[11px] text-foreground/90">{truncateAddress(owner, 8)}</code>
            <CopyMini value={owner} label="Owner wallet" />
            <a
              href={solscanAccountUrl(owner)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-violet-300/90 hover:text-violet-200"
            >
              Solscan <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}