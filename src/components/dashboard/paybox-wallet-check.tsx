"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  classifyWallet,
  type Recommendation,
  type TrustOraclePayload,
} from "@/lib/trust-oracle-logic";

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string }
  | { status: "result"; payload: TrustOraclePayload };

const LOADING_STEPS = [
  { key: "validate", label: "Validating wallet address" },
  { key: "lookup", label: "Looking up AgentRanking index" },
  { key: "signals", label: "Reading trust signals" },
  { key: "verdict", label: "Computing Safe / Caution / High Risk" },
] as const;

/** Advance through early steps on a timer; hold on the last until the request finishes. */
const STEP_INTERVAL_MS = 480;
const MIN_LOADING_MS = 900;

const VERDICT_LABEL: Record<Recommendation, string> = {
  safe: "Safe",
  caution: "Caution",
  high_risk: "High Risk",
};

function verdictClass(recommendation: Recommendation): string {
  switch (recommendation) {
    case "safe":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "caution":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "high_risk":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    default: {
      const _exhaustive: never = recommendation;
      return _exhaustive;
    }
  }
}

function explanationFor(payload: TrustOraclePayload): string {
  if (!payload.isRegistered) {
    return "This wallet isn’t on AgentRanking yet — no identity history. You can still pay it through PayBox; treat it as unknown until you have another signal.";
  }
  switch (payload.recommendation) {
    case "safe":
      return "Strong identity and trust signals for this wallet on AgentRanking.";
    case "caution":
      return "Some signals look incomplete or mixed — review the profile before paying.";
    case "high_risk":
      return "Elevated risk signals — treat outbound payments to this wallet with care.";
    default: {
      const _exhaustive: never = payload.recommendation;
      return _exhaustive;
    }
  }
}

function profileHref(payload: TrustOraclePayload): string | null {
  if (payload.agent?.profilePath) return payload.agent.profilePath;
  if (payload.evidence.profileUrl) return payload.evidence.profileUrl;
  return null;
}

function PayboxCheckLoadingSequence({ activeStep }: { readonly activeStep: number }) {
  return (
    <div
      className="space-y-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="space-y-1.5">
        {LOADING_STEPS.map((step, idx) => {
          const status: "completed" | "active" | "pending" =
            idx < activeStep ? "completed" : idx === activeStep ? "active" : "pending";
          return (
            <div key={step.key} className="flex items-center gap-2 text-xs">
              {status === "completed" ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
              ) : status === "active" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 text-center text-muted-foreground/40" aria-hidden>
                  –
                </span>
              )}
              <span
                className={
                  status === "completed"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : status === "active"
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/50"
                }
              >
                {step.label}
                {status === "active" ? "…" : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-start justify-between gap-3 border-t border-border/50 pt-3">
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-14" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-[80%] max-w-sm" />
    </div>
  );
}

export function DashboardPayboxWalletCheck() {
  const [wallet, setWallet] = useState("");
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [loadingStep, setLoadingStep] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = window.setInterval(() => {
      setLoadingStep((current) => Math.min(current + 1, LOADING_STEPS.length - 1));
    }, STEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state.status]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = wallet.trim();
    if (!trimmed) {
      setState({ status: "invalid", message: "Paste a Solana or EVM wallet address." });
      return;
    }
    if (!classifyWallet(trimmed)) {
      setState({
        status: "invalid",
        message: "Enter a valid EVM (0x…) or Solana (base58) wallet address.",
      });
      return;
    }

    setLoadingStep(0);
    startTransition(() => {
      void (async () => {
        setState({ status: "loading" });
        const startedAt = Date.now();
        try {
          const res = await fetch(`/api/v1/reputation/${encodeURIComponent(trimmed)}`, {
            cache: "no-store",
          });
          const body: unknown = await res.json().catch(() => ({}));
          const elapsed = Date.now() - startedAt;
          if (elapsed < MIN_LOADING_MS) {
            await new Promise((resolve) => window.setTimeout(resolve, MIN_LOADING_MS - elapsed));
          }
          // Flash final step as complete before revealing the result.
          setLoadingStep(LOADING_STEPS.length);
          await new Promise((resolve) => window.setTimeout(resolve, 220));

          if (res.status === 400) {
            const rec = body as { message?: string };
            setState({
              status: "invalid",
              message:
                typeof rec.message === "string"
                  ? rec.message
                  : "Enter a valid EVM (0x…) or Solana (base58) wallet address.",
            });
            return;
          }
          if (!res.ok) {
            setState({
              status: "error",
              message: "Could not check this wallet right now. Try again shortly.",
            });
            return;
          }
          setState({ status: "result", payload: body as TrustOraclePayload });
        } catch {
          setState({
            status: "error",
            message: "Could not check this wallet right now. Try again shortly.",
          });
        }
      })();
    });
  }

  const busy = isPending || state.status === "loading";
  const profile = state.status === "result" ? profileHref(state.payload) : null;

  return (
    <section className="ui-panel ui-panel--stack space-y-3" aria-labelledby="paybox-wallet-check-title">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" id="paybox-wallet-check-title">
          PayBox Wallet Check
        </p>
        <h2 className="mt-1 text-base font-semibold text-foreground">
          Check a wallet before your AI pays it through PayBox
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste any Solana or EVM address — PayBox can pay wallets that aren&apos;t on AgentRanking.
          If we know the wallet, you&apos;ll get a trust score and verdict first.
        </p>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={onSubmit}>
        <Input
          id="dashboard-paybox-wallet-input"
          name="wallet"
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Wallet address"
          placeholder="Solana or EVM wallet address"
          value={wallet}
          disabled={busy}
          className="font-mono text-xs sm:flex-1"
          onChange={(e) => {
            setWallet(e.target.value);
            if (state.status === "invalid" || state.status === "error") {
              setState({ status: "idle" });
            }
          }}
        />
        <Button type="submit" disabled={busy} className="sm:shrink-0">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking…
            </>
          ) : (
            "Check Wallet"
          )}
        </Button>
      </form>

      {state.status === "invalid" || state.status === "error" ? (
        <p className="text-sm text-muted-foreground" role="status">
          {state.message}
        </p>
      ) : null}

      {state.status === "loading" ? <PayboxCheckLoadingSequence activeStep={loadingStep} /> : null}

      {state.status === "result" ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3" aria-live="polite">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Trust score</p>
                {state.payload.isRegistered ? (
                  <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                    {Math.round(state.payload.protocolTrustScore)}
                  </p>
                ) : (
                  <p className="text-3xl font-semibold tracking-tight text-muted-foreground" title="No AgentRanking score for this wallet">
                    —
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold",
                  verdictClass(state.payload.recommendation),
                )}
              >
                {VERDICT_LABEL[state.payload.recommendation]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{explanationFor(state.payload)}</p>
            {!state.payload.isRegistered ? (
              <p className="text-xs text-muted-foreground/80">
                No AgentRanking profile yet — PayBox can still pay this address; we just don&apos;t have a scored history.
              </p>
            ) : null}
            {profile ? (
              <Link
                href={profile}
                className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                View full profile →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground/70">
        Check any wallet before paying. Works alongside any AI payment tool, including PayBox by
        MoonPay. AgentRanking is not affiliated with MoonPay.
      </p>
    </section>
  );
}
