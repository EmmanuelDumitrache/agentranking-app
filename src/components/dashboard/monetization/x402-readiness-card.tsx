"use client";
import type { X402DisplayState } from "@/lib/dashboard/x402-display";
import { x402SummaryLabel } from "@/lib/dashboard/x402-display";
import { DashboardStatusBadge } from "@/components/dashboard/shared/status-badge";
import { formatPortfolioRelative } from "@/components/dashboard/portfolio/portfolio-utils";
type Props = {
  state: X402DisplayState;
  compact?: boolean;
};
export function DashboardX402ReadinessCard({ state, compact = false }: Props) {
  const summary = x402SummaryLabel(state);
  const variant =
    state.payable ? "available" : state.detected ? "live" : state.failureReason ? "failing" : "no_data";
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <DashboardStatusBadge variant={variant} label={summary} />
        {state.httpStatus != null ? (
          <span className="text-[10px] text-muted-foreground">HTTP {state.httpStatus}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">x402 readiness</p>
        <DashboardStatusBadge variant={variant} label={summary} />
      </div>
      {state.failureReason && !state.detected ? (
        <p className="text-xs text-muted-foreground">{state.failureReason}</p>
      ) : null}
      <dl className="grid gap-1.5 text-[11px]">
        {state.endpoint ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Endpoint</dt>
            <dd className="font-mono truncate">{state.endpoint}</dd>
          </div>
        ) : null}
        {state.httpStatus != null ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">HTTP status</dt>
            <dd className="tabular-nums">{state.httpStatus}</dd>
          </div>
        ) : null}
        {state.lastScanned ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Last scanned</dt>
            <dd>{formatPortfolioRelative(state.lastScanned)}</dd>
          </div>
        ) : null}
        {state.priceHint ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Price hint</dt>
            <dd>{state.priceHint}</dd>
          </div>
        ) : null}
        {state.assetHint ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Asset hint</dt>
            <dd className="font-mono truncate">{state.assetHint}</dd>
          </div>
        ) : null}
        {state.recipientHint ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Recipient</dt>
            <dd className="font-mono truncate">{state.recipientHint}</dd>
          </div>
        ) : null}
        {state.hints.length > 0 ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Hints</dt>
            <dd className="text-muted-foreground">{state.hints.join(" · ")}</dd>
          </div>
        ) : null}
        {state.paymentHeaders.length > 0 ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0 w-24">Headers</dt>
            <dd className="font-mono text-[10px] truncate">{state.paymentHeaders.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
