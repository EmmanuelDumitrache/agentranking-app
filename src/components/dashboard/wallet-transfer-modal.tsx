"use client";
import { useState, useCallback } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DashboardAgentWalletPicker,
  type TransferTargetAgent,
} from "@/components/dashboard/agent-wallet-picker";
type Props = {
  readonly agentDbId: number;
  readonly agentName: string;
  readonly agentWalletPublicKey: string;
  readonly balanceSol: number; // SOL as number
  readonly solscanUrl: string | null;
  readonly network: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSent: (sig: string) => void;
};
type Step = "form" | "review" | "sending" | "success" | "error";
const SOL_BUFFER = 0.01;
const TX_FEE_ESTIMATE = 0.00001; // ~5000-10000 lamports for a simple SOL transfer
export function DashboardWalletTransferModal({
  agentDbId,
  agentName,
  agentWalletPublicKey,
  balanceSol,
  network,
  open,
  onClose,
  onSent,
}: Props) {
  const [step, setStep] = useState<Step>("form");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<"SOL" | "USDC">("SOL");
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<TransferTargetAgent | null>(null);
  const maxSendable = Math.max(0, balanceSol - SOL_BUFFER - TX_FEE_ESTIMATE);
  const belowBuffer = balanceSol < (SOL_BUFFER + TX_FEE_ESTIMATE);
  const reset = useCallback(() => {
    setStep("form");
    setRecipient("");
    setAmount("");
    setToken("SOL");
    setError(null);
    setSignature(null);
    setSentAmount("");
    setSelectedAgent(null);
  }, []);
  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);
  // Validate
  const recipientTrimmed = recipient.trim();
  const amountNum = Number.parseFloat(amount);
  const isValidRecipient =
    recipientTrimmed.length >= 32 && recipientTrimmed.length <= 44;
  const formError = (() => {
    if (!recipientTrimmed) return null;
    if (!isValidRecipient) return "Invalid Solana address";
    return null;
  })();
  const amountError = (() => {
    if (!amount) return null;
    if (!Number.isFinite(amountNum) || amountNum <= 0) return "Amount must be greater than 0";
    if (amountNum > balanceSol) return "Insufficient balance";
    if (amountNum > maxSendable) return `This would leave less than ${SOL_BUFFER} SOL in the wallet (minimum buffer). Try a smaller amount.`;
    return null;
  })();
  const canReview =
    isValidRecipient &&
    amountNum > 0 &&
    amountNum <= maxSendable &&
    !formError &&
    !amountError;
  // Max button
  const setMax = () => {
    if (maxSendable > 0) {
      setAmount(maxSendable.toFixed(6).replace(/\.?0+$/, ""));
    }
  };
  const handleReview = () => {
    if (!canReview) return;
    setError(null);
    setStep("review");
  };
  const handleSend = async () => {
    setStep("sending");
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/send-sol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: recipientTrimmed,
          amountSol: amountNum,
          token: "SOL",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        signature?: string;
        solscanUrl?: string;
        error?: string;
      };
      if (res.ok && data.ok && data.signature) {
        setSignature(data.signature);
        setSentAmount(amount);
        setStep("success");
        onSent(data.signature);
      } else {
        setError(data.error || "Transfer failed. Please try again.");
        setStep("error");
      }
    } catch {
      setError("Transfer failed. Please try again.");
      setStep("error");
    }
  };
  if (!open) return null;
  const shortPubkey =
    agentWalletPublicKey.length > 12
      ? `${agentWalletPublicKey.slice(0, 6)}…${agentWalletPublicKey.slice(-4)}`
      : agentWalletPublicKey;
  const solscanTxBase = "https://solscan.io/tx";
  const txSolscanUrl =
    signature && network === "devnet"
      ? `${solscanTxBase}/${signature}?cluster=devnet`
      : signature
        ? `${solscanTxBase}/${signature}`
        : null;
  const networkLabel = network === "devnet" ? "Devnet" : "Mainnet";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="ui-overview-panel w-full max-w-md overflow-hidden rounded-xl p-0 shadow-2xl">
        {/* Header */}
        <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Transfer</h2>
            <p className="text-muted-foreground text-xs">
              Move real funds from this agent wallet.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-5 py-5">
          {step === "form" && (
            <div className="space-y-4">
              {/* Token selector */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Token</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={token === "SOL" ? "default" : "outline"}
                    className="h-9"
                    onClick={() => setToken("SOL")}
                  >
                    SOL
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 text-muted-foreground"
                    disabled
                    title="USDC transfers coming soon"
                  >
                    USDC
                  </Button>
                </div>
                {token === "USDC" && (
                  <p className="text-muted-foreground text-xs">USDC transfers coming soon</p>
                )}
              </div>
              {/* Recipient */}
              <div className="space-y-1.5">
                <Label htmlFor="w-recipient" className="text-xs font-medium">
                  Destination address
                </Label>
                <Input
                  id="w-recipient"
                  placeholder="Recipient Solana address"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setSelectedAgent(null);
                  }}
                  className={cn(formError && "border-red-500")}
                />
                {formError && (
                  <p className="text-destructive text-xs">{formError}</p>
                )}
              </div>
              <DashboardAgentWalletPicker
                excludeAgentId={agentDbId}
                excludeAddress={agentWalletPublicKey}
                chain="solana"
                selectedAgentDbId={selectedAgent?.agentDbId ?? null}
                onSelect={(target) => {
                  setSelectedAgent(target);
                  setRecipient(target?.solAddress ?? "");
                }}
              />
              {/* Amount */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="w-amount" className="text-xs font-medium">
                    Amount
                  </Label>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {balanceSol.toFixed(4)} SOL available
                  </span>
                </div>
                <div className="relative">
                  <Input
                    id="w-amount"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={cn("pr-14", amountError && "border-red-500")}
                  />
                  <button
                    type="button"
                    onClick={setMax}
                    className="text-foreground absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs font-medium hover:underline"
                    disabled={maxSendable <= 0}
                  >
                    Max
                  </button>
                </div>
                {amountError && (
                  <p className="text-destructive text-xs">{amountError}</p>
                )}
                {belowBuffer && (
                  <p className="text-muted-foreground text-xs">
                    Insufficient balance after required network buffer.
                  </p>
                )}
              </div>
              {/* Disclaimer */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                Transfers are signed by AgentRanking using the agent&apos;s
                encrypted custodial wallet. Private keys are never shown.
              </p>
              <Button
                type="button"
                className="w-full"
                size="sm"
                disabled={!canReview}
                onClick={handleReview}
              >
                <Send className="mr-2 h-4 w-4" />
                Review transfer
              </Button>
            </div>
          )}
          {step === "review" && (
            <div className="space-y-4">
              <div className="ui-overview-metric rounded-lg p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Confirm transfer
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-mono text-xs">
                      {agentName} · {shortPubkey}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">To</span>
                    <span className="text-right text-xs">
                      {selectedAgent ? (
                        <>
                          <span className="font-medium">{selectedAgent.name}</span>
                          <span className="text-muted-foreground mt-0.5 block font-mono">
                            {recipientTrimmed.length > 16
                              ? `${recipientTrimmed.slice(0, 8)}…${recipientTrimmed.slice(-8)}`
                              : recipientTrimmed}
                          </span>
                        </>
                      ) : (
                        <span className="font-mono">
                          {recipientTrimmed.length > 16
                            ? `${recipientTrimmed.slice(0, 8)}…${recipientTrimmed.slice(-8)}`
                            : recipientTrimmed}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold tabular-nums">{amountNum} SOL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Network</span>
                    <span>{networkLabel}</span>
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep("form")}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={() => void handleSend()}
                >
                  Send SOL
                </Button>
              </div>
            </div>
          )}
          {step === "sending" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              <p className="text-sm">Sending {sentAmount || amount} SOL…</p>
            </div>
          )}
          {step === "success" && (
            <div className="space-y-4">
              <div className="ui-overview-metric flex flex-col items-center gap-2 rounded-lg p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted">
                  <Check className="h-5 w-5 text-foreground" />
                </div>
                <p className="font-semibold">Transfer sent</p>
                <p className="text-muted-foreground text-sm">
                  {sentAmount} SOL was sent from this agent wallet.
                </p>
                {signature && (
                  <p className="text-muted-foreground font-mono text-xs">
                    {signature.slice(0, 8)}…{signature.slice(-8)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {txSolscanUrl && (
                  <Button size="sm" variant="outline" className="flex-1" asChild>
                    <a href={txSolscanUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      View on Solscan
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={handleClose}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
          {step === "error" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <p className="text-destructive text-sm">{error || "Transfer failed"}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep("form")}
                >
                  Try again
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={handleClose}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
