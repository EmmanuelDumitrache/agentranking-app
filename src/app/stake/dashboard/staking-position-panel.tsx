"use client";
import { useCallback } from "react";
import type { PublicKey } from "@solana/web3.js";
import type { StakePositionRow } from "@/app/stake/integrations/streamflow-stake-form";
import { STAKING_DASHBOARD_REWARD } from "@/lib/staking-dashboard-copy";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { cn } from "@/lib/utils";
import styles from "./staking-dashboard.module.css";
function formatUnlock(lockEndAt: string | null): string {
  if (!lockEndAt) return "—";
  const d = new Date(lockEndAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export function StakingPositionPanel({
  connected,
  publicKey,
}: {
  readonly connected: boolean;
  readonly publicKey: PublicKey | null;
}) {
  const copy = STAKING_DASHBOARD_REWARD;
  const walletAddress = connected ? publicKey?.toBase58() ?? null : null;
  const loadPositions = useCallback(async (signal: AbortSignal): Promise<StakePositionRow[]> => {
    if (!walletAddress) return [];
    const res = await fetch(
      `/api/token/staking/positions?wallet=${encodeURIComponent(walletAddress)}`,
      { cache: "no-store", signal },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { positions?: StakePositionRow[] };
    return data.positions ?? [];
  }, [walletAddress]);
  const positionsKey = `staking-positions:${walletAddress ?? "disconnected"}`;
  const positions = useAsyncResource(
    positionsKey,
    loadPositions,
    {
      initialData: [],
      initialDataKey: walletAddress ? null : positionsKey,
      revalidateOnMount: false,
    },
  );
  const rows = positions.data ?? [];
  const loading = Boolean(walletAddress) && positions.loading;
  if (!connected) {
    return (
      <div className={cn(styles.holderLens, "mt-6")}>
        <p className="text-[12px] text-[var(--ar-text-tertiary)]">{copy.positionEmpty}</p>
      </div>
    );
  }
  const primary = rows[0];
  return (
    <div className="mt-6 space-y-3">
      <p className="ar-public-label">{copy.positionTitle}</p>
      {loading ? (
        <p className="text-[12px] text-[var(--ar-text-tertiary)]">Loading position…</p>
      ) : primary ? (
        <dl className={cn(styles.metricTile, "space-y-2 text-[13px]")}>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--ar-text-tertiary)]">Locked</dt>
            <dd className="font-semibold tabular-nums text-[var(--ar-text-primary)]">{primary.amountUi} $AR</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--ar-text-tertiary)]">Unlock</dt>
            <dd className="font-medium tabular-nums text-[var(--ar-text-primary)]">{formatUnlock(primary.lockEndAt)}</dd>
          </div>
          {rows.length > 1 ? (
            <p className="text-[10px] text-[var(--ar-text-muted)]">{rows.length} active lock entries</p>
          ) : null}
        </dl>
      ) : (
        <p className="text-[12px] text-[var(--ar-text-tertiary)]">No active locks yet. Stake $AR to create your first position.</p>
      )}
    </div>
  );
}
