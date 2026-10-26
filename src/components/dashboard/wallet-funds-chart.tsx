"use client";
import { useMemo, useState } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { cn } from "@/lib/utils";
export type WalletChartTransfer = {
  token: string;
  fromPublicKey: string;
  toPublicKey: string;
  amountLamports: string;
  status: string;
  createdAt: string;
  confirmedAt?: string | null;
};
export type WalletFundsChartPoint = {
  day: string;
  label: string;
  value: number;
  inflow: number;
  outflow: number;
  net: number;
  hasFlow: boolean;
};
const DAY_MS = 86_400_000;
const USDC_DECIMALS = 1_000_000;
const SOL_DECIMALS = 1_000_000_000;
/** Shorter window = fewer flat days and a more active-looking line. */
const FUNDS_CHART_DAYS = 7;
/** Dashboard monochrome — white line / grey quiet / soft rose outflows only. */
const CHART = {
  stroke: "rgba(250, 250, 250, 0.92)",
  fill: "rgba(250, 250, 250, 0.08)",
  guide: "rgba(255, 255, 255, 0.12)",
  cursor: "rgba(250, 250, 250, 0.35)",
  dotQuiet: "rgba(161, 161, 170, 0.55)",
  dotIn: "rgba(250, 250, 250, 0.95)",
  dotOut: "rgba(251, 113, 133, 0.85)",
} as const;
const CHART_W = 600;
const CHART_H = 120;
const PAD = { top: 14, right: 8, bottom: 10, left: 8 };
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
function formatDayLabel(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
/** Compact axis tick for dense 7-day charts (day number only). */
function formatDayTick(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    timeZone: "UTC",
  });
}
function formatAxisUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 100) / 10}k`;
  if (Math.abs(value) >= 10) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}
function formatDeltaUsd(value: number): string {
  const abs = formatAxisUsd(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${formatAxisUsd(Math.abs(value)).replace("$", "")}`;
  return abs;
}
function sameWallet(a: string, b: string): boolean {
  return a.trim() === b.trim();
}
function isConfirmedTransfer(transfer: WalletChartTransfer): boolean {
  const status = transfer.status.trim().toLowerCase();
  return status === "confirmed" || Boolean(transfer.confirmedAt);
}
function transferDeltaUsd(
  transfer: WalletChartTransfer,
  walletPublicKey: string,
  solPrice: number | null,
): number {
  if (!isConfirmedTransfer(transfer)) return 0;
  const raw = Number(transfer.amountLamports);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const inbound = sameWallet(transfer.toPublicKey, walletPublicKey);
  const outbound = sameWallet(transfer.fromPublicKey, walletPublicKey);
  if (!inbound && !outbound) return 0;
  const sign = outbound && !inbound ? -1 : inbound ? 1 : -1;
  const token = transfer.token.trim().toUpperCase();
  if (token === "SOL") {
    if (solPrice == null || solPrice <= 0) return 0;
    return sign * (raw / SOL_DECIMALS) * solPrice;
  }
  if (token === "USDC" || token === "USDT") {
    return sign * (raw / USDC_DECIMALS);
  }
  return 0;
}
/** Build a daily USD series ending at `currentUsd`, adjusted by known transfers. */
export function buildDailyFundsSeries(params: {
  currentUsd: number;
  transfers?: readonly WalletChartTransfer[];
  walletPublicKey?: string | null;
  solPrice?: number | null;
  days?: number;
}): WalletFundsChartPoint[] {
  const days = params.days ?? FUNDS_CHART_DAYS;
  const today = startOfUtcDay(new Date());
  const current = Math.max(
    0,
    Number.isFinite(params.currentUsd) ? params.currentUsd : 0,
  );
  const inflowByDay = new Map<string, number>();
  const outflowByDay = new Map<string, number>();
  if (params.walletPublicKey && params.transfers?.length) {
    for (const transfer of params.transfers) {
      const delta = transferDeltaUsd(
        transfer,
        params.walletPublicKey,
        params.solPrice ?? null,
      );
      if (delta === 0) continue;
      const day = startOfUtcDay(new Date(transfer.createdAt))
        .toISOString()
        .slice(0, 10);
      if (delta > 0) {
        inflowByDay.set(day, (inflowByDay.get(day) ?? 0) + delta);
      } else {
        outflowByDay.set(day, (outflowByDay.get(day) ?? 0) + Math.abs(delta));
      }
    }
  }
  const closes: number[] = new Array(days);
  let cursor = current;
  for (let i = days - 1; i >= 0; i -= 1) {
    closes[i] = Math.max(0, cursor);
    const day = new Date(today.getTime() - (days - 1 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const net = (inflowByDay.get(day) ?? 0) - (outflowByDay.get(day) ?? 0);
    cursor = Math.max(0, cursor - net);
  }
  return closes.map((value, index) => {
    const day = new Date(today.getTime() - (days - 1 - index) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const inflow = inflowByDay.get(day) ?? 0;
    const outflow = outflowByDay.get(day) ?? 0;
    const net = inflow - outflow;
    return {
      day,
      label: formatDayLabel(day),
      value: Number(value.toFixed(4)),
      inflow: Number(inflow.toFixed(4)),
      outflow: Number(outflow.toFixed(4)),
      net: Number(net.toFixed(4)),
      hasFlow: inflow > 0 || outflow > 0,
    };
  });
}
type Props = {
  readonly title?: string;
  readonly currentUsd: number;
  readonly className?: string;
  readonly transfers?: readonly WalletChartTransfer[];
  readonly walletPublicKey?: string | null;
  readonly solPrice?: number | null;
  readonly loading?: boolean;
  readonly emptyHint?: string;
};
function chartPoints(
  data: readonly WalletFundsChartPoint[],
  peak: number,
): Array<{
  point: WalletFundsChartPoint;
  x: number;
  y: number;
}> {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const yMax = peak > 0 ? peak * 1.08 : 1;
  const n = Math.max(data.length - 1, 1);
  return data.map((point, index) => {
    const x = PAD.left + (index / n) * innerW;
    const y = PAD.top + innerH - (point.value / yMax) * innerH;
    return { point, x, y };
  });
}
function buildLinePath(
  coords: ReadonlyArray<{ x: number; y: number }>,
): string {
  if (coords.length === 0) return "";
  return coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
}
function buildAreaPath(
  coords: ReadonlyArray<{ x: number; y: number }>,
): string {
  if (coords.length === 0) return "";
  const baseline = CHART_H - PAD.bottom;
  const line = buildLinePath(coords);
  const first = coords[0];
  const last = coords.at(-1);
  if (!first || !last) return line;
  return `${line} L${last.x.toFixed(2)} ${baseline} L${first.x.toFixed(2)} ${baseline} Z`;
}
export function WalletFundsChart({
  title = "7-day value",
  currentUsd,
  className,
  transfers,
  walletPublicKey,
  solPrice,
  loading = false,
  emptyHint,
}: Props) {
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const data = useMemo(
    () =>
      buildDailyFundsSeries({
        currentUsd,
        transfers,
        walletPublicKey,
        solPrice,
        days: FUNDS_CHART_DAYS,
      }),
    [currentUsd, transfers, walletPublicKey, solPrice],
  );
  const flowDays = useMemo(
    () => data.filter((point) => point.hasFlow).length,
    [data],
  );
  const peak = Math.max(...data.map((point) => point.value), 0);
  const coords = useMemo(() => chartPoints(data, peak), [data, peak]);
  const linePath = useMemo(() => buildLinePath(coords), [coords]);
  const areaPath = useMemo(() => buildAreaPath(coords), [coords]);
  const active = data.find((point) => point.day === activeDay) ?? null;
  const activeCoord = coords.find((c) => c.point.day === activeDay) ?? null;
  const rangeLabel = useMemo(() => {
    const first = data[0];
    const last = data.at(-1);
    if (!first || !last) return "Last 7 days";
    return `${first.label} – ${last.label}`;
  }, [data]);
  const statusLine = (() => {
    if (loading) return "…";
    if (flowDays > 0) {
      return `${flowDays} active day${flowDays === 1 ? "" : "s"}`;
    }
    return emptyHint ?? "No transfers yet";
  })();
  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-muted/10 px-3 py-3",
        className,
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
            {title}
          </p>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {loading ? "…" : formatAxisUsd(active?.value ?? currentUsd)}
          </p>
        </div>
        <div className="text-muted-foreground shrink-0 text-right text-[10px] leading-tight">
          {active ? (
            <>
              <p className="font-medium text-foreground/80">{active.label}</p>
              {active.hasFlow ? (
                <p className="tabular-nums">
                  {active.inflow > 0 ? (
                    <span className="text-foreground/80">
                      in {formatDeltaUsd(active.inflow)}
                    </span>
                  ) : null}
                  {active.inflow > 0 && active.outflow > 0 ? " · " : null}
                  {active.outflow > 0 ? (
                    <span className="text-rose-400/90">
                      out −{formatAxisUsd(active.outflow).replace("$", "")}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p>No transfers</p>
              )}
            </>
          ) : (
            <>
              <p>{rangeLabel}</p>
              <p className="tabular-nums">{statusLine}</p>
            </>
          )}
        </div>
      </div>
      <div className="relative">
        {loading ? (
          <div className="bg-muted/20 h-28 animate-pulse rounded-md" />
        ) : (
          <div
            className="relative h-28 w-full min-w-0"
            onMouseLeave={() => setActiveDay(null)}
          >
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="h-full w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${title} line chart`}
            >
              <line
                x1={PAD.left}
                x2={CHART_W - PAD.right}
                y1={PAD.top + (CHART_H - PAD.top - PAD.bottom) / 2}
                y2={PAD.top + (CHART_H - PAD.top - PAD.bottom) / 2}
                stroke={CHART.guide}
                strokeWidth={1}
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
              <path d={areaPath} fill={CHART.fill} stroke="none" />
              <path
                d={linePath}
                fill="none"
                stroke={CHART.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {activeCoord ? (
                <line
                  x1={activeCoord.x}
                  x2={activeCoord.x}
                  y1={PAD.top}
                  y2={CHART_H - PAD.bottom}
                  stroke={CHART.cursor}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            <div className="pointer-events-none absolute inset-0">
              {coords.map(({ point, x, y }) => {
                const left = `${(x / CHART_W) * 100}%`;
                const top = `${(y / CHART_H) * 100}%`;
                const isActive = activeDay === point.day;
                if (point.hasFlow) {
                  const color =
                    point.net < 0 ? CHART.dotOut : CHART.dotIn;
                  return (
                    <span
                      key={point.day}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40"
                      style={{
                        left,
                        top,
                        width: isActive ? 10 : 8,
                        height: isActive ? 10 : 8,
                        backgroundColor: color,
                      }}
                    />
                  );
                }
                return (
                  <span
                    key={point.day}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left,
                      top,
                      width: isActive ? 6 : 4,
                      height: isActive ? 6 : 4,
                      backgroundColor: CHART.dotQuiet,
                    }}
                  />
                );
              })}
            </div>
            <div className="absolute inset-0 flex">
              {data.map((point) => (
                <button
                  key={point.day}
                  type="button"
                  className="h-full min-w-0 flex-1 outline-none"
                  aria-label={`${point.label}: ${formatAxisUsd(point.value)}${
                    point.hasFlow ? ", transfer activity" : ""
                  }`}
                  onMouseEnter={() => setActiveDay(point.day)}
                  onFocus={() => setActiveDay(point.day)}
                  onClick={() =>
                    setActiveDay((prev) =>
                      prev === point.day ? null : point.day,
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between gap-0.5 px-0.5 text-[10px] tabular-nums">
        {data.map((point) => (
          <span
            key={point.day}
            className={cn(
              "min-w-0 flex-1 text-center",
              activeDay === point.day && "font-medium text-foreground/80",
            )}
            title={point.label}
          >
            {formatDayTick(point.day)}
          </span>
        ))}
      </div>
    </div>
  );
}
/** Fetches Solana transfers and renders a funds chart for the agent wallet. */
export function SolanaWalletFundsChart({
  agentDbId,
  walletPublicKey,
  currentUsd,
  solPrice,
  initialTransfers,
  revalidateOnMount = false,
  className,
}: Readonly<{
  agentDbId: number;
  walletPublicKey: string;
  currentUsd: number;
  solPrice: number | null;
  initialTransfers?: readonly WalletChartTransfer[];
  revalidateOnMount?: boolean;
  className?: string;
}>) {
  const key = `wallet-chart-transfers:${agentDbId}:${walletPublicKey}`;
  const transferResource = useAsyncResource<WalletChartTransfer[]>(
    key,
    async (signal) => {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/transfers?limit=100`,
        { signal },
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as {
        transfers?: WalletChartTransfer[];
      };
      return payload.transfers ?? [];
    },
    {
      initialData: initialTransfers ? [...initialTransfers] : undefined,
      initialDataKey: initialTransfers ? key : null,
      revalidateOnMount,
    },
  );
  return (
    <WalletFundsChart
      title="Solana funds"
      currentUsd={currentUsd}
      solPrice={solPrice}
      walletPublicKey={walletPublicKey}
      transfers={transferResource.data ?? undefined}
      loading={transferResource.loading}
      className={className}
      emptyHint="No sends yet"
    />
  );
}

export function EvmWalletFundsChart({
  currentUsd,
  className,
}: Readonly<{
  currentUsd: number;
  className?: string;
}>) {
  return (
    <WalletFundsChart
      title="EVM funds"
      currentUsd={currentUsd}
      className={className}
      emptyHint="Transfers not tracked yet"
    />
  );
}
