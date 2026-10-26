"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
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

const VERDICT_LABEL: Record<Recommendation, string> = {
  safe: "Safe",
  caution: "Caution",
  high_risk: "High Risk",
};

function verdictClass(recommendation: Recommendation): string {
  switch (recommendation) {
    case "safe":
      return "verified-paybox-verdict--safe";
    case "caution":
      return "verified-paybox-verdict--caution";
    case "high_risk":
      return "verified-paybox-verdict--high-risk";
    default: {
      const _exhaustive: never = recommendation;
      return _exhaustive;
    }
  }
}

function explanationFor(payload: TrustOraclePayload): string {
  if (!payload.isRegistered) {
    return "Not yet indexed on AgentRanking — no score available";
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

export function VerifiedPayboxWalletCheck() {
  const [wallet, setWallet] = useState("");
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

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

    startTransition(() => {
      void (async () => {
        setState({ status: "loading" });
        try {
          const res = await fetch(`/api/v1/reputation/${encodeURIComponent(trimmed)}`, {
            cache: "no-store",
          });
          const body: unknown = await res.json().catch(() => ({}));
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

  return (
    <section className="verified-panel-disclosure verified-paybox-check" aria-labelledby="paybox-wallet-check-title">
      <div className="verified-paybox-check-inner">
        <p className="verified-section-title" id="paybox-wallet-check-title">
          PayBox Wallet Check
        </p>
        <h2 className="verified-paybox-heading">
          Check a wallet before your AI pays it through PayBox
        </h2>
        <p className="verified-panel-description verified-paybox-subtext">
          Paste any wallet address your AI agent is about to pay. We&apos;ll show its AgentRanking
          trust score first.
        </p>

        <form className="verified-paybox-form" onSubmit={onSubmit}>
          <input
            id="paybox-wallet-input"
            className="verified-paybox-input"
            name="wallet"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Wallet address"
            placeholder="Solana or EVM wallet address"
            value={wallet}
            disabled={busy}
            onChange={(e) => {
              setWallet(e.target.value);
              if (state.status === "invalid" || state.status === "error") {
                setState({ status: "idle" });
              }
            }}
          />
          <button
            type="submit"
            className="verified-cta verified-cta--primary verified-paybox-submit"
            disabled={busy}
          >
            {busy ? "Checking…" : "Check Wallet"}
          </button>
        </form>

        {state.status === "invalid" || state.status === "error" ? (
          <p className="verified-paybox-status" role="status">
            {state.message}
          </p>
        ) : null}

        {state.status === "loading" ? (
          <div className="verified-paybox-result" aria-busy="true" aria-live="polite">
            <p className="verified-paybox-status">Looking up trust score…</p>
          </div>
        ) : null}

        {state.status === "result" ? (
          <div className="verified-paybox-result" aria-live="polite">
            {!state.payload.isRegistered ? (
              <p className="verified-paybox-status">
                Not yet indexed on AgentRanking — no score available
              </p>
            ) : (
              <>
                <div className="verified-paybox-score-row">
                  <div className="verified-paybox-score-block">
                    <span className="verified-paybox-score-label">Trust score</span>
                    <span className="verified-paybox-score-value tabular-nums">
                      {Math.round(state.payload.protocolTrustScore)}
                    </span>
                  </div>
                  <span
                    className={`verified-paybox-verdict ${verdictClass(state.payload.recommendation)}`}
                  >
                    {VERDICT_LABEL[state.payload.recommendation]}
                  </span>
                </div>
                <p className="verified-paybox-explanation">{explanationFor(state.payload)}</p>
                {profileHref(state.payload) ? (
                  <Link href={profileHref(state.payload)!} className="verified-text-link">
                    View full profile →
                  </Link>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <p className="verified-paybox-footer">
          Works alongside any AI payment tool, including PayBox by MoonPay. AgentRanking is not
          affiliated with MoonPay.
        </p>
      </div>
    </section>
  );
}
