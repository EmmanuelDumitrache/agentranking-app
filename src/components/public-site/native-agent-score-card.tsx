"use client";
import type { NativeAgentScoreBreakdown, ScoreComponent } from "@/lib/public-site/native-agent-score";
import { cn } from "@/lib/utils";
type Props = {
  readonly score: NativeAgentScoreBreakdown;
};
function BarRow({ label, data }: { readonly label: string; readonly data: ScoreComponent }) {
  const pct = data.max > 0 ? Math.round((data.score / data.max) * 100) : 0;
  let barColor: string;
  if (pct >= 80) barColor = "bg-foreground/70";
  else if (pct >= 50) barColor = "bg-foreground/40";
  else barColor = "bg-foreground/15";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-foreground/80">{label}</span>
        <span className="tabular-nums text-foreground/50">
          {data.score} / {data.max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-foreground/8 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {data.missing.length > 0 && data.score < data.max && (
        <p className="text-[10px] text-foreground/35 leading-tight">
          Missing: {data.missing.join(", ")}
        </p>
      )}
    </div>
  );
}
export function NativeAgentScoreCard({ score }: Props) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const pct = score.total / 100;
  const offset = circumference * (1 - pct);
  return (
    <div className="ui-panel ui-panel--stack gap-4">
      {/* Header with ring */}
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width={96} height={96} className="-rotate-90">
            <circle
              cx={48}
              cy={48}
              r={radius}
              fill="none"
              stroke="var(--app-border)"
              strokeWidth={6}
            />
            <circle
              cx={48}
              cy={48}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="text-foreground/80 transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl font-bold tabular-nums leading-none text-foreground">{score.total}</span>
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
            AR Agent Score
          </h3>
          <p className="mt-0.5 text-sm font-medium text-foreground/80">
            {score.label}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground/45">AgentRanking-created AI agent</p>
        </div>
      </div>
      {/* Breakdown */}
      <div className="space-y-3">
        <BarRow label="Identity" data={score.identity} />
        <BarRow label="Verification" data={score.verification} />
        <BarRow label="Wallet" data={score.wallet} />
        <BarRow label="Tokenization" data={score.tokenization} />
        <BarRow label="Capabilities" data={score.capabilities} />
        <BarRow label="Activity" data={score.activity} />
        <BarRow label="Developer" data={score.developer} />
      </div>
      {/* Missing signals summary */}
      {(() => {
        const allMissing = [
          ...score.identity.missing,
          ...score.verification.missing,
          ...score.wallet.missing,
          ...score.tokenization.missing,
          ...score.capabilities.missing,
          ...score.activity.missing,
          ...score.developer.missing,
        ];
        if (allMissing.length === 0) return null;
        return (
          <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1.5">
              Missing signals
            </p>
            <ul className="space-y-0.5">
              {allMissing.map((m) => (
                <li key={m} className="text-[10px] text-foreground/45">{m}</li>
              ))}
            </ul>
          </div>
        );
      })()}
      {/* Verified sources */}
      <div className="rounded-md border border-border/40 bg-[var(--app-inset)] p-2.5">
        <p className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1.5">
          Verified sources
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-foreground/[0.06] border border-border/60 px-2 py-0.5 text-[10px] text-foreground/60">
            AgentRanking
          </span>
          {score.wallet.score > 0 && (
            <span className="rounded-full bg-foreground/[0.06] border border-border/60 px-2 py-0.5 text-[10px] text-foreground/60">
              Wallet
            </span>
          )}
          {score.tokenization.score > 0 && (
            <span className="rounded-full bg-foreground/[0.06] border border-border/60 px-2 py-0.5 text-[10px] text-foreground/60">
              Token
            </span>
          )}
          {score.identity.score > 10 && (
            <span className="rounded-full bg-foreground/[0.06] border border-border/60 px-2 py-0.5 text-[10px] text-foreground/60">
              Metadata
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
