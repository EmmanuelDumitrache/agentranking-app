"use client";
import { useState, useCallback } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  shortenEvmAddress,
  formatEthCompact,
  ethereumMainnetExplorerTxUrl,
  robinhoodChainExplorerTxUrl,
  ETHEREUM_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_NAME,
  EVM_CHAIN_ID,
  EVM_NETWORK_NAME,
} from "@/lib/evm-wallet-utils";
import { useAgentEvmSend } from "@/lib/use-agent-evm-send";
import { isAddress } from "viem";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import {
  DashboardAgentWalletPicker,
  type TransferTargetAgent,
} from "@/components/dashboard/agent-wallet-picker";
export type EvmSendChain = "mainnet" | "robinhood";
type Props = {
  readonly agentDbId?: number;
  readonly evmAddress: string;
  readonly mainnetBalanceEth: string | null;
  readonly robinhoodBalanceEth: string | null;
  readonly defaultChain?: EvmSendChain;
  readonly custodial?: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSent: (txHash: string) => void;
};
type Step = "form" | "review" | "sending" | "success" | "error";
const ETH_BUFFER = 0.0001;
const CHAIN_META: Record<
  EvmSendChain,
  { chainId: number; network: string; explorerTx: (hash: string) => string }
> = {
  mainnet: {
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    network: ETHEREUM_MAINNET_NAME,
    explorerTx: ethereumMainnetExplorerTxUrl,
  },
  robinhood: {
    chainId: EVM_CHAIN_ID,
    network: EVM_NETWORK_NAME,
    explorerTx: robinhoodChainExplorerTxUrl,
  },
};
export function DashboardEvmSendModal({
  agentDbId,
  evmAddress,
  mainnetBalanceEth,
  robinhoodBalanceEth,
  defaultChain = "mainnet",
  custodial = false,
  open,
  onClose,
  onSent,
}: Props) {
  const [step, setStep] = useState<Step>("form");
  const [selectedChain, setSelectedChain] = useState<EvmSendChain>(defaultChain);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState("");
  const [sendingTx, setSendingTx] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<TransferTargetAgent | null>(null);
  const { sendEth } = useAgentEvmSend();
  const balanceEth =
    selectedChain === "mainnet" ? mainnetBalanceEth : robinhoodBalanceEth;
  const balanceNum = balanceEth ? Number.parseFloat(balanceEth) : 0;
  const maxSendable = Math.max(0, balanceNum - ETH_BUFFER);
  const belowBuffer = balanceNum < ETH_BUFFER;
  const chainMeta = CHAIN_META[selectedChain];
  const reset = useCallback(() => {
    setStep("form");
    setRecipient("");
    setAmount("");
    setError(null);
    setTxHash(null);
    setSentAmount("");
    setSelectedChain(defaultChain);
    setSelectedAgent(null);
  }, [defaultChain]);
  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);
  const recipientTrimmed = recipient.trim();
  const amountNum = Number.parseFloat(amount);
  const isValidRecipient = isAddress(recipientTrimmed);
  const formError = (() => {
    if (!recipientTrimmed) return null;
    if (!isValidRecipient) return "Invalid EVM address";
    if (recipientTrimmed.toLowerCase() === evmAddress.toLowerCase())
      return "Cannot send to your own wallet";
    return null;
  })();
  const amountError = (() => {
    if (!amount) return null;
    if (!Number.isFinite(amountNum) || amountNum <= 0)
      return "Amount must be greater than 0";
    if (amountNum > balanceNum) return "Insufficient balance";
    if (amountNum > maxSendable)
      return `This would leave less than ${ETH_BUFFER} ETH for gas. Try a smaller amount.`;
    return null;
  })();
  const canReview =
    isValidRecipient &&
    amountNum > 0 &&
    amountNum <= maxSendable &&
    !formError &&
    !amountError;
  const setMax = () => {
    if (maxSendable > 0) {
      const rounded = Math.floor(maxSendable * 1_000_000) / 1_000_000;
      setAmount(rounded.toFixed(6).replace(/\.?0+$/, ""));
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
    setSendingTx(true);
    try {
      const hash = await sendEth({
        evmAddress,
        to: recipientTrimmed as `0x${string}`,
        amount,
        chainId: chainMeta.chainId,
        agentDbId,
        custodial,
      });
      setTxHash(hash);
      setSentAmount(amount);
      setStep("success");
      onSent(hash);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setError(
        message.includes("user rejected")
          ? "Transaction rejected by user."
          : message,
      );
      setStep("error");
    } finally {
      setSendingTx(false);
    }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="ui-overview-panel w-full max-w-md overflow-hidden rounded-xl p-0 shadow-2xl">
        <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Send ETH</h2>
            <p className="text-muted-foreground text-xs">
              Send from this agent&apos;s EVM wallet on {chainMeta.network}.
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
              <div className="space-y-2">
                <Label className="text-xs font-medium">Network</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChain("mainnet");
                      setAmount("");
                      setSelectedAgent(null);
                      setRecipient("");
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selectedChain === "mainnet"
                        ? "border-foreground/25 bg-muted"
                        : "border-border/60 hover:bg-muted/30",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <EthereumIcon className="h-3.5 w-3.5" />
                      Ethereum
                    </span>
                    <span className="text-muted-foreground mt-1 block text-[11px] tabular-nums">
                      {formatEthCompact(mainnetBalanceEth)} ETH
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChain("robinhood");
                      setAmount("");
                      setSelectedAgent(null);
                      setRecipient("");
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selectedChain === "robinhood"
                        ? "border-foreground/25 bg-muted"
                        : "border-border/60 hover:bg-muted/30",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <RobinhoodChainIcon className="h-3.5 w-3.5" />
                      Robinhood
                    </span>
                    <span className="text-muted-foreground mt-1 block text-[11px] tabular-nums">
                      {formatEthCompact(robinhoodBalanceEth)} ETH
                    </span>
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evm-recipient" className="text-xs font-medium">
                  Destination address
                </Label>
                <Input
                  id="evm-recipient"
                  placeholder="0x..."
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
                excludeAddress={evmAddress}
                chain={selectedChain === "mainnet" ? "evm-mainnet" : "evm-robinhood"}
                selectedAgentDbId={selectedAgent?.agentDbId ?? null}
                onSelect={(target) => {
                  setSelectedAgent(target);
                  setRecipient(target?.evmAddress ?? "");
                }}
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="evm-amount" className="text-xs font-medium">
                    Amount
                  </Label>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatEthCompact(balanceEth)} ETH available
                  </span>
                </div>
                <div className="relative">
                  <Input
                    id="evm-amount"
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
                    Insufficient balance after required gas buffer on {chainMeta.network}.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Sending from{" "}
                  <span className="font-mono">
                    {shortenEvmAddress(evmAddress)}
                  </span>{" "}
                  on {chainMeta.network}. A small amount of ETH is reserved for gas.
                </p>
              </div>
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
                      {shortenEvmAddress(evmAddress)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">To</span>
                    <span className="text-right text-xs">
                      {selectedAgent ? (
                        <>
                          <span className="font-medium">{selectedAgent.name}</span>
                          <span className="text-muted-foreground mt-0.5 block font-mono">
                            {shortenEvmAddress(recipientTrimmed, 6)}
                          </span>
                        </>
                      ) : (
                        <span className="font-mono">
                          {shortenEvmAddress(recipientTrimmed, 6)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold tabular-nums">
                      {amountNum} ETH
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Network</span>
                    <span>{chainMeta.network}</span>
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                This cannot be undone. The transaction will be signed by this
                agent&apos;s {custodial ? "custodial" : "embedded"} wallet.
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
                  disabled={sendingTx}
                >
                  {sendingTx ? (
                    <>
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{" "}
                      Sending…
                    </>
                  ) : (
                    "Send ETH"
                  )}
                </Button>
              </div>
            </div>
          )}
          {step === "sending" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              <p className="text-sm">
                Sending {sentAmount || amount} ETH on {chainMeta.network}…
              </p>
              <p className="text-muted-foreground text-xs">
                {custodial
                  ? "Signing with the agent's custodial wallet…"
                  : "Confirm the transaction in your wallet."}
              </p>
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
                  {sentAmount} ETH sent on {chainMeta.network}.
                </p>
                {txHash && (
                  <p className="text-muted-foreground font-mono text-xs">
                    {shortenEvmAddress(txHash)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {txHash && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    asChild
                  >
                    <a
                      href={chainMeta.explorerTx(txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      View on Explorer
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
                <p className="text-destructive text-sm">
                  {error || "Transfer failed"}
                </p>
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
