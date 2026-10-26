"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useState } from "react";
import type { CustomListPricingDto, CustomListPaymentToken } from "@/app/(public-site)/custom-list/custom-list-types";
import { useRouter } from "next/navigation";
import { CustomListRedirect } from "@/app/(public-site)/custom-list/custom-list-redirect";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Package,
  Wallet,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { CHAINS } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { isAbortLike, timeoutSignal } from "@/lib/timing/abort";
type PaymentToken = CustomListPaymentToken;
function getTokenConfig(testMode: boolean): Record<
  PaymentToken,
  { network: string; explorerPrefix: string; explorerName: string; addressKey: keyof CustomListPricingDto["treasury"] }
> {
  const evmNetwork = testMode ? "Ethereum Sepolia" : "Ethereum";
  const evmExplorer = testMode ? "https://sepolia.etherscan.io/address/" : "https://etherscan.io/address/";
  const evmExplorerName = testMode ? "Etherscan (Sepolia)" : "Etherscan";
  return {
    ETH: { network: evmNetwork, explorerPrefix: evmExplorer, explorerName: evmExplorerName, addressKey: "evm" },
    USDC: { network: evmNetwork, explorerPrefix: evmExplorer, explorerName: evmExplorerName, addressKey: "evm" },
    SOL: { network: testMode ? "Solana (mainnet)" : "Solana", explorerPrefix: "https://solscan.io/account/", explorerName: "Solscan", addressKey: "sol" },
  };
}
const CHAIN_OPTIONS = [
  ...CHAINS.filter((c) => c.isActive && c.chainId !== SOLANA_CHAIN_ID)
    .map((c) => ({ id: c.chainId, name: c.name }))
    .sort((a, b) => a.id - b.id),
  { id: 0, name: "Other / Custom" },
];
export function CustomListClient({ initialPricing }: { readonly initialPricing: CustomListPricingDto }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [chainId, setChainId] = useState(8453);
  const [paymentToken, setPaymentToken] = useState<PaymentToken>("ETH");
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [createdAgentPath, setCreatedAgentPath] = useState<string | null>(null);
  const [copied, setCopied] = useTransientState(false, 2000);
  const { prices, treasury, testMode } = initialPricing;
  const tokenConfig = getTokenConfig(testMode);
  const currentConfig = tokenConfig[paymentToken];
  const currentTreasury = treasury[currentConfig.addressKey];
  const currentPrice = prices[paymentToken];
  const handleCopyTreasury = async () => {
    if (!currentTreasury) return;
    try {
      await navigator.clipboard.writeText(currentTreasury);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const handleSubmit = async () => {
    if (!name.trim() || !txHash.trim() || !address) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          image: image.trim(),
          website: website.trim(),
          chainId,
          paymentToken,
          txHash: txHash.trim(),
          wallet: address,
        }),
        signal: timeoutSignal(25_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create listing");
        return;
      }
      setSuccessMsg(`${data.agent.name} listed successfully!`);
      setCreatedAgentPath(data.agent.profilePath);
    } catch (err) {
      setError(
        isAbortLike(err)
          ? "Verification timed out. Please try again."
          : "Failed to submit. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {testMode && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>TEST MODE</strong> — Use Ethereum Sepolia for ETH/USDC (micro amounts). SOL uses mainnet with small amounts.
          </span>
        </div>
      )}
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Package className="h-5 w-5 md:h-6 md:w-6 text-blue-500" />
          Custom List Agent
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          List an agent that isn&apos;t automatically detected by our RPC sync.
          For developers with agents on unsupported chains or custom registries.
        </p>
      </div>
      {!isConnected && (
        <Card className="bg-card border-border">
          <CardContent className="py-16 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <Wallet className="h-8 w-8 text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Connect the wallet that will own this custom-listed agent.
            </p>
            <Button onClick={() => openConnectModal?.()} className="rounded-full px-6">
              <Wallet className="h-4 w-4 mr-2" /> Connect Wallet
            </Button>
          </CardContent>
        </Card>
      )}
      {isConnected && successMsg && createdAgentPath ? (
        <CustomListRedirect href={createdAgentPath} />
      ) : null}
      {isConnected && successMsg && (
        <Card className="bg-card border-border border-green-500/20">
          <CardContent className="py-16 flex flex-col items-center text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            <h2 className="text-lg font-semibold mb-2">{successMsg}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your agent is now listed on AgentRanking. Redirecting to your agent...
            </p>
            <div className="flex gap-3">
              {createdAgentPath && (
                <Button
                  className="rounded-full px-6"
                  onClick={() => router.push(createdAgentPath)}
                >
                  View Your Agent
                </Button>
              )}
              <Button asChild variant="outline" className="rounded-full px-6">
                <Link href="/">Browse Agents</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {isConnected && !successMsg && (
        <div className="space-y-6">
          {/* Agent details form */}
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-4">
              <h3 className="text-sm font-semibold">Agent Details</h3>
              <div>
                <label htmlFor="cl-name" className="block text-xs text-muted-foreground mb-1">
                  Agent Name *
                </label>
                <input
                  id="cl-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My AI Agent"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="cl-desc" className="block text-xs text-muted-foreground mb-1">
                  Description
                </label>
                <textarea
                  id="cl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do?"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cl-image" className="block text-xs text-muted-foreground mb-1">
                    Image URL
                  </label>
                  <input
                    id="cl-image"
                    type="url"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="cl-website" className="block text-xs text-muted-foreground mb-1">
                    Website URL
                  </label>
                  <input
                    id="cl-website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="cl-chain" className="block text-xs text-muted-foreground mb-1">
                  Chain
                </label>
                <select
                  id="cl-chain"
                  value={chainId}
                  onChange={(e) => setChainId(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {CHAIN_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
          {/* Payment section */}
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-4">
              <h3 className="text-sm font-semibold">Payment</h3>
              {/* Token selector */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Pay with</p>
                <div className="flex gap-2">
                  {(["ETH", "USDC", "SOL"] as PaymentToken[]).map((token) => {
                    const price = prices[token];
                    return (
                      <button
                        key={token}
                        type="button"
                        onClick={() => { setPaymentToken(token); setCopied(false); }}
                        className={`flex-1 rounded-lg border px-3 py-2 text-center transition-colors ${
                          paymentToken === token
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <span className="block text-sm font-semibold">{token}</span>
                        <span className="block text-xs opacity-70">
                          {price ?? "—"} {token}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {currentPrice && (
                <p className="text-sm text-muted-foreground">
                  Send exactly{" "}
                  <span className="font-semibold text-foreground">
                    {currentPrice} {paymentToken}
                  </span>{" "}
                  on {currentConfig.network} to the address below.
                </p>
              )}
              {currentTreasury ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 font-mono text-xs break-all">
                    <span className="flex-1 min-w-0">{currentTreasury}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={handleCopyTreasury}
                      aria-label="Copy treasury address"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <a
                    href={`${currentConfig.explorerPrefix}${currentTreasury}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View on {currentConfig.explorerName} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <p className="text-sm text-amber-500">
                  Treasury address not configured for {paymentToken}. Try another
                  payment method.
                </p>
              )}
              <div>
                <label htmlFor="cl-txhash" className="block text-xs text-muted-foreground mb-1">
                  Transaction Hash *
                </label>
                <input
                  id="cl-txhash"
                  type="text"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder={
                    paymentToken === "SOL"
                      ? "Transaction signature"
                      : "Transaction hash (0x...)"
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                />
              </div>
            </CardContent>
          </Card>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button asChild variant="outline">
              <Link href="/create">Cancel</Link>
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !name.trim() ||
                !txHash.trim() ||
                submitting ||
                !currentTreasury ||
                !currentPrice
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Submit Custom Listing"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
