"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useCallback, useState } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedBadge, VerifiedTick, TokenVerifiedPill } from "@/components/shared/verified-badge";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/ui/toast-simple";
import type { DashboardVerificationStateDto } from "@/lib/dashboard/verification-state";
import { DashboardPayboxWalletCheck } from "@/components/dashboard/paybox-wallet-check";
type Props = {
  agentDbId: number;
  initialData: DashboardVerificationStateDto;
};
type VerifyPhase =
  | "idle"
  | "checking"
  | "confirming"
  | "processing"
  | "confirming_chain"
  | "finalizing";
const PHASE_LABELS: Record<VerifyPhase, string> = {
  idle: "Verify agent",
  checking: "Checking eligibility...",
  confirming: "Pay & verify",
  processing: "Processing verification...",
  confirming_chain: "Confirming on-chain...",
  finalizing: "Finalizing verification...",
};
export function DashboardVerificationPage({ agentDbId, initialData }: Props) {
  const [phase, setPhase] = useState<VerifyPhase>("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useTransientState<string | null>(null, 2000);
  const fetchState = useCallback(async (signal: AbortSignal): Promise<DashboardVerificationStateDto> => {
    const response = await fetch(`/api/dashboard/agents/${agentDbId}/verification`, { signal });
    if (!response.ok) throw new Error("Failed to load verification state.");
    return (await response.json()) as DashboardVerificationStateDto;
  }, [agentDbId]);
  const resourceKey = `verification:${agentDbId}`;
  const verificationResource = useAsyncResource(resourceKey, fetchState, {
    initialData,
    initialDataKey: resourceKey,
    revalidateOnMount: false,
  });
  const refreshVerification = verificationResource.refresh;
  const state = verificationResource.data;
  const loading = verificationResource.loading;
  const error = verificationResource.error?.message ?? null;
  const handleVerify = useCallback(async () => {
    setShowConfirm(false);
    setPhase("processing");
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/verification/verify`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.status === 402) {
        showToast("Insufficient agent wallet balance. Fund this agent's wallet and try again.", "error");
        setPhase("idle");
        return;
      }
      if (!res.ok) {
        showToast(data.error || "Verification failed.", "error");
        setPhase("idle");
        return;
      }
      setPhase("finalizing");
      showToast(`Agent verified successfully${data.tokenVerified ? " — token auto-verified" : ""}.`, "success");
      refreshVerification();
      setPhase("idle");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Verification failed", "error");
      setPhase("idle");
    }
  }, [agentDbId, refreshVerification]);
  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
  }, [setCopied]);
  const isVerified = state?.verificationStatus === "verified";
  const isPending = state?.verificationStatus === "pending";
  const tokenVerified = state?.token?.verificationStatus === "verified";
  const busy = phase !== "idle" && phase !== "confirming";
  if (loading) {
    return (
      <div className="ui-page-stack flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !state) {
    return (
      <div className="ui-page-stack">
        <div className="ui-panel ui-panel--stack text-center py-12">
          <p className="text-red-400">{error || "Could not load verification state."}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="ui-page-stack space-y-6">
      {/* Header */}
      <div className="ui-panel ui-panel--stack space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="ui-page-title flex items-center gap-2">
              Verification
              {isVerified && <VerifiedTick size="lg" />}
            </h1>
            <p className="ui-page-subtitle mt-1">
              Verify your agent and official token to unlock premium trust signals across AgentRanking.
            </p>
          </div>
          <VerifiedTick size="lg" />
        </div>
        {!isVerified && !isPending && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--ui-gold-border)]/20 bg-[var(--ui-gold-soft)]/20 px-3 py-2 text-sm text-[var(--ui-gold-bright)]/70">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--ui-gold-bright)]/60" />
            <span>
              Verification is an on-chain action. A fee of {state.feeSol} SOL will be paid from this agent&apos;s wallet.
            </span>
          </div>
        )}
      </div>

      <DashboardPayboxWalletCheck />

      {/* Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Agent verification card */}
        <div
          className={cn(
            "ui-panel space-y-4",
            isVerified && "border-[var(--ui-gold-border)]/30 shadow-[0_0_20px_-4px_rgba(251,191,36,0.1)]",
          )}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Agent Verification</h2>
            {isVerified ? (
              <VerifiedBadge variant="sm" />
            ) : isPending ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Processing
              </span>
            ) : null}
          </div>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Status</span>
              <span className={cn(isVerified ? "text-[var(--ui-gold-bright)]" : "text-foreground")}>
                {isVerified ? "Verified" : isPending ? "Pending" : "Unverified"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Verification fee</span>
              <span className="text-foreground">{state.feeSol} SOL</span>
            </div>
          </div>
          {/* Payment readiness */}
          {!isVerified && !isPending && (
            <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Verification payment</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span>{state.feeSol} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pays from</span>
                <span className="text-foreground font-medium">Agent wallet</span>
              </div>
              {state.agentWalletPublicKey ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wallet address</span>
                  <span className="font-mono text-xs text-foreground">
                    {state.agentWalletPublicKey.slice(0, 6)}...{state.agentWalletPublicKey.slice(-4)}
                  </span>
                </div>
              ) : null}
              {state.agentWalletBalanceSol != null ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent wallet balance</span>
                  <span className={cn(
                    "text-foreground",
                    state.agentWalletBalanceSol < state.feeSol + 0.00001 ? "text-red-400" : "text-emerald-400",
                  )}>
                    {state.agentWalletBalanceSol.toFixed(6)} SOL
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Required</span>
                <span className="text-foreground">~{(state.feeSol + 0.00001).toFixed(5)} SOL (fee + network)</span>
              </div>
              {state.treasuryWallet ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recipient</span>
                  <span className="font-mono text-xs text-foreground">
                    {state.treasuryWallet.slice(0, 6)}...{state.treasuryWallet.slice(-4)}
                  </span>
                </div>
              ) : null}
              {state.agentWalletPublicKey && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleCopy(state.agentWalletPublicKey!, "aw")}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copied === "aw" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    Copy wallet
                  </button>
                  <button
                    onClick={() => window.open(`/dashboard/agents/${agentDbId}/wallet`, "_blank")}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open wallet
                  </button>
                  <button
                    onClick={refreshVerification}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Loader2 className="h-3 w-3" />
                    Refresh
                  </button>
                </div>
              )}
              {state.agentWalletBalanceSol != null && state.agentWalletBalanceSol < state.feeSol + 0.00001 && (
                <p className="text-xs text-red-400 pt-1">
                  Insufficient agent wallet balance. Fund this agent&apos;s wallet to verify.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1 text-xs text-muted-foreground/60">
            <p>Included benefits:</p>
            <ul className="list-inside list-disc space-y-0.5">
              <li>Gold verified badge on all public surfaces</li>
              <li>Premium trust signal for your agent</li>
              <li>Official token auto-verification (if launched)</li>
              <li>Higher visibility in rankings and search</li>
            </ul>
          </div>
          {!isVerified && !isPending && (
            <Button
              className="w-full border border-[var(--ui-gold-border)] bg-[var(--ui-gold-soft)] text-[var(--ui-gold-bright)]/90 hover:border-[var(--ui-gold-border)]/70 hover:bg-[var(--ui-gold-soft)]/80 hover:text-[var(--ui-gold-bright)]"
              onClick={() => {
                if (!state.eligible) {
                  showToast(state.eligibilityReason, "error");
                  return;
                }
                setShowConfirm(true);
              }}
              disabled={busy}
            >
              {phase === "idle" ? (
                <>
                  <BadgeCheck className="mr-2 h-4 w-4" />
                  Pay {state.feeSol} SOL & Verify
                </>
              ) : (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {PHASE_LABELS[phase]}
                </>
              )}
            </Button>
          )}
        </div>
        {/* Token verification card */}
        <div
          className={cn(
            "ui-panel space-y-4",
            tokenVerified && "border-[var(--ui-gold-border)]/30 shadow-[0_0_20px_-4px_rgba(251,191,36,0.1)]",
          )}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Token Verification</h2>
            {tokenVerified ? (
              <TokenVerifiedPill />
            ) : state.tokenExists ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <XCircle className="h-3 w-3 text-red-400" /> Unverified
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No token</span>
            )}
          </div>
          {state.token ? (
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Token</span>
                <span className="text-foreground">
                  {state.token.tokenName || state.token.tokenSymbol || "Unknown"}
                </span>
              </div>
              {state.token.mint && (
                <div className="flex justify-between">
                  <span>Mint</span>
                  <span className="font-mono text-xs text-foreground">
                    {state.token.mint.slice(0, 6)}...{state.token.mint.slice(-4)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Launch status</span>
                <span className="text-foreground capitalize">{state.token.launchStatus}</span>
              </div>
              <div className="flex justify-between">
                <span>Verification</span>
                <span className={cn(tokenVerified ? "text-[var(--ui-gold-bright)]" : "text-foreground")}>
                  {tokenVerified ? "Verified" : "Not verified"}
                </span>
              </div>
              {!tokenVerified && (
                <div className="flex justify-between">
                  <span>How to verify</span>
                  <span className={cn(isVerified ? "text-[var(--ui-gold-bright)]" : "text-muted-foreground")}>
                    {isVerified
                      ? "Will auto-verify when agent is verified"
                      : "Verify agent first"}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No token linked to this agent yet. Launch a token to enable verification.
            </p>
          )}
        </div>
      </div>
      {/* Requirements Checklist */}
      <div className="ui-panel space-y-3">
        <h2 className="text-base font-semibold">Requirements</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {/* Agent checklist */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Agent</p>
            {state.eligibilityChecks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 text-sm">
                {check.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                )}
                <span className={check.passed ? "text-foreground" : "text-red-400"}>{check.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-sm">
              {isVerified ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              )}
              <span className={isVerified ? "text-foreground" : "text-red-400"}>
                Verification payment complete
              </span>
            </div>
          </div>
          {/* Token checklist */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Token</p>
            <CheckItem passed={state.tokenExists} label="Token linked" />
            <CheckItem passed={Boolean(state.token?.mint)} label="Mint found" />
            <CheckItem passed={state.tokenLaunched} label="Launch indexed" />
            <CheckItem passed={isVerified} label="Agent verified" />
            <CheckItem passed={tokenVerified} label="Token verified" />
          </div>
        </div>
      </div>
      {/* Verification Receipt (only when verified) */}
      {isVerified && state.verificationTxSignature && (
        <div className="ui-panel space-y-3">
          <h2 className="text-base font-semibold">Verification Receipt</h2>
          <div className="space-y-2 text-sm">
            <Row label="Verified at" value={state.verifiedAt ? new Date(state.verifiedAt).toLocaleString() : "—"} />
            <Row label="Fee paid" value={`${state.verificationFeeSol?.toFixed(6) ?? "—"} SOL`} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Transaction</span>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-foreground max-w-[200px] truncate">
                  {state.verificationTxSignature.slice(0, 12)}...
                </code>
                <button onClick={() => handleCopy(state.verificationTxSignature!, "tx")} className="text-muted-foreground hover:text-foreground">
                  {copied === "tx" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <a
                  href={`https://solscan.io/tx/${state.verificationTxSignature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <Row label="Wallet used" value={state.verificationWallet ? `${state.verificationWallet.slice(0, 8)}...` : "—"} />
          </div>
        </div>
      )}
      {/* Confirm Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="ui-panel mx-4 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Confirm Verification</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                You are about to verify <strong className="text-foreground">{state.agentName}</strong> on AgentRanking.
              </p>
              <ul className="list-inside list-disc space-y-1">
                <li>A fee of <strong className="text-foreground">{state.feeSol} SOL</strong> will be paid from this agent&apos;s wallet</li>
                <li>On-chain transaction will be sent to the verification treasury</li>
                <li>This action cannot be reversed</li>
                <li>Your token will be auto-verified if launched</li>
              </ul>
              {/* Wallet details in modal */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paying from</span>
                  <span className="text-foreground font-medium">Agent wallet</span>
                </div>
                {state.agentWalletPublicKey && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Address</span>
                    <span className="font-mono tracking-tight">
                      {state.agentWalletPublicKey.slice(0, 8)}...{state.agentWalletPublicKey.slice(-6)}
                    </span>
                  </div>
                )}
                {state.agentWalletBalanceSol != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Balance</span>
                    <span>{state.agentWalletBalanceSol.toFixed(6)} SOL</span>
                  </div>
                )}
                {state.treasuryWallet && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipient</span>
                    <span className="font-mono tracking-tight">
                      {state.treasuryWallet.slice(0, 8)}...{state.treasuryWallet.slice(-6)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
              <Button className="flex-1 border border-[var(--ui-gold-border)] bg-[var(--ui-gold-soft)] text-[var(--ui-gold-bright)]/90 hover:border-[var(--ui-gold-border)]/70 hover:bg-[var(--ui-gold-soft)]/80 hover:text-[var(--ui-gold-bright)]" onClick={handleVerify}>
                Pay {state.feeSol} SOL & Verify
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function CheckItem({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {passed ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-400 shrink-0" />
      )}
      <span className={passed ? "text-foreground" : "text-red-400"}>{label}</span>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
