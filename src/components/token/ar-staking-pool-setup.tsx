"use client";
import BN from "bn.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  deriveStakeMintPDA,
  deriveStakePoolPDA,
  SolanaStakingClient,
} from "@streamflow/staking";
import { CheckCircle2, Copy, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showToast } from "@/components/ui/toast-simple";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import { AR_SOLANA_MINT } from "@/lib/ar-token-public";
import {
  connectInjectedWallet,
  InjectedWalletConnectError,
  subscribeInjectedWalletAccount,
} from "@/lib/solana-injected-wallet";
import { resolveTokenProgramIdForMint, tokenProgramLabel } from "@/lib/solana-mint-token-program";
import {
  solanaExplorerTxUrl,
  stakingPageSolanaClusterLabel,
  streamflowICluster,
  streamflowRpcEndpoint,
} from "@/lib/streamflow-stake-config";
const SCALE_PRECISION_FACTOR = 1_000_000_000;
const SECONDS_PER_DAY = 86_400;
type PoolCreateResult = {
  stakePool: string;
  stakePoolMint: string;
  txId: string;
  env: string;
};
async function copyToClipboard(text: string, label: string) {
  await navigator.clipboard.writeText(text);
  showToast(`${label} copied to clipboard.`);
}
function parsePositiveInt(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function parseNonce(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 && n <= 255 ? n : 0;
}
function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
export function ArStakingPoolSetup() {
  const clusterLabel = stakingPageSolanaClusterLabel();
  const isMainnetTarget = clusterLabel === "Mainnet";
  const connectAttemptRef = useRef(0);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [mint, setMint] = useState<string>(AR_SOLANA_MINT);
  const [nonce, setNonce] = useState("0");
  const [minDays, setMinDays] = useState("7");
  const [maxDays, setMaxDays] = useState("365");
  const [maxWeight, setMaxWeight] = useState("1");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PoolCreateResult | null>(null);
  const stakingClient = useMemo(
    () =>
      new SolanaStakingClient({
        clusterUrl: streamflowRpcEndpoint(),
        cluster: streamflowICluster(),
      }),
    [],
  );
  useEffect(() => subscribeInjectedWalletAccount({
    onAccountChange: (pk) => {
      setProviderAvailable(Boolean(getSolanaWalletProvider()));
      setPublicKey(pk);
    },
    onDisconnect: () => setPublicKey(null),
  }), []);
  const loadTokenProgram = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    const trimmed = mint.trim();
    if (!trimmed) return null;
    try {
      const mintPk = new PublicKey(trimmed);
      const programId = await resolveTokenProgramIdForMint(stakingClient.connection, mintPk);
      if (signal.aborted) throw signal.reason;
      return tokenProgramLabel(programId);
    } catch (cause) {
      if (signal.aborted) throw cause;
      return null;
    }
  }, [mint, stakingClient]);
  const tokenProgramResource = useAsyncResource(
    `staking-pool-token-program:${mint.trim()}`,
    loadTokenProgram,
  );
  const underlyingTokenProgram = tokenProgramResource.data;
  const predicted = useMemo(() => {
    if (!publicKey) return null;
    try {
      const mintPk = new PublicKey(mint.trim());
      const stakePoolProgram = stakingClient.getCurrentProgramId("stakePoolProgram");
      const stakePool = deriveStakePoolPDA(stakePoolProgram, mintPk, publicKey, parseNonce(nonce));
      const stakePoolMint = deriveStakeMintPDA(stakePoolProgram, stakePool);
      return {
        stakePool: stakePool.toBase58(),
        stakePoolMint: stakePoolMint.toBase58(),
      };
    } catch {
      return null;
    }
  }, [mint, nonce, publicKey, stakingClient]);
  function cancelConnect() {
    connectAttemptRef.current += 1;
    setConnecting(false);
    setWalletError("Connection cancelled. Close any open Phantom popup and try again.");
  }
  async function connectPhantom() {
    setWalletError(null);
    const attempt = connectAttemptRef.current + 1;
    connectAttemptRef.current = attempt;
    setConnecting(true);
    try {
      const { publicKey: pk } = await connectInjectedWallet();
      if (connectAttemptRef.current !== attempt) return;
      setPublicKey(pk);
    } catch (e) {
      if (connectAttemptRef.current !== attempt) return;
      if (e instanceof InjectedWalletConnectError) {
        setWalletError(e.message);
      } else {
        setWalletError(e instanceof Error ? e.message : "Could not connect Phantom.");
      }
    } finally {
      if (connectAttemptRef.current === attempt) {
        setConnecting(false);
      }
    }
  }
  async function disconnectPhantom() {
    setWalletError(null);
    const p = getSolanaWalletProvider();
    try {
      await p?.disconnect();
    } catch {
      /* ignore */
    }
    setPublicKey(null);
  }
  async function createPool() {
    setError(null);
    setResult(null);
    const p = getSolanaWalletProvider();
    if (!p || !publicKey) {
      setError("Connect the founder/operator Phantom wallet first.");
      return;
    }
    let mintPk: PublicKey;
    try {
      mintPk = new PublicKey(mint.trim());
    } catch {
      setError("Enter a valid $AR mint address.");
      return;
    }
    const minDuration = parsePositiveInt(minDays, 7) * SECONDS_PER_DAY;
    const maxDuration = parsePositiveInt(maxDays, 365) * SECONDS_PER_DAY;
    if (minDuration > maxDuration) {
      setError("Minimum lock days cannot be greater than maximum lock days.");
      return;
    }
    const weightNumber = Number.parseFloat(maxWeight);
    const safeWeight = Number.isFinite(weightNumber) && weightNumber >= 1 ? weightNumber : 1;
    const maxWeightRaw = Math.round(safeWeight * SCALE_PRECISION_FACTOR);
    const safeNonce = parseNonce(nonce);
    const stakePoolProgram = stakingClient.getCurrentProgramId("stakePoolProgram");
    const stakePool = deriveStakePoolPDA(stakePoolProgram, mintPk, publicKey, safeNonce);
    const stakePoolMint = deriveStakeMintPDA(stakePoolProgram, stakePool);
    setSubmitting(true);
    try {
      const tokenProgramId = await resolveTokenProgramIdForMint(stakingClient.connection, mintPk);
      const { ixs } = await stakingClient.prepareCreateStakePoolInstructions(
        {
          mint: mintPk,
          nonce: safeNonce,
          maxWeight: new BN(maxWeightRaw),
          minDuration: new BN(minDuration),
          maxDuration: new BN(maxDuration),
          permissionless: true,
          freezeStakeMint: false,
          unstakePeriod: new BN(0),
          tokenProgramId,
        },
        {
          invoker: { publicKey },
        } as never,
      );
      const { blockhash, lastValidBlockHeight } = await stakingClient.connection.getLatestBlockhash("confirmed");
      const tx = new Transaction();
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;
      tx.add(...ixs);
      let txId: string;
      if (p.signAndSendTransaction) {
        const sent = await p.signAndSendTransaction(tx);
        txId = typeof sent === "string" ? sent : sent.signature;
      } else if (p.signTransaction) {
        const signed = await p.signTransaction(tx);
        txId = await stakingClient.connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
      } else {
        throw new Error("Connected Phantom provider cannot sign Solana transactions.");
      }
      await stakingClient.connection.confirmTransaction(
        { signature: txId, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      const env = [
        `NEXT_PUBLIC_STREAMFLOW_STAKE_POOL=${stakePool.toBase58()}`,
        `NEXT_PUBLIC_STREAMFLOW_STAKE_POOL_MINT=${stakePoolMint.toBase58()}`,
      ].join("\n");
      setResult({
        stakePool: stakePool.toBase58(),
        stakePoolMint: stakePoolMint.toBase58(),
        txId,
        env,
      });
      showToast("Stake pool created. Copy env vars, restart dev, then test the staking site.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create Streamflow stake pool.");
    } finally {
      setSubmitting(false);
    }
  }
  const showCliFallback =
    walletError?.includes("timed out") ||
    walletError?.includes("not detected") ||
    walletError?.includes("cancelled");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 size-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <CardTitle>Operator-only Streamflow pool setup</CardTitle>
              <CardDescription>
                Open{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">http://localhost:3000/internal/staking/setup</code>{" "}
                to create the one-time $AR stake pool with Phantom.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            After creation, copy the generated pool address and stake mint into local <code>.env</code>, restart the dev server, and then use the
            staking-site root page to test locking and tier perks.
          </p>
          <div className="space-y-3">
            <p className="text-xs">
              Network: <span className="font-medium text-foreground">{clusterLabel}</span> — switch Phantom to{" "}
              <span className="font-medium text-foreground">{clusterLabel}</span> and keep a little SOL for fees.
            </p>
            {!isMainnetTarget ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                This page shows <strong>{clusterLabel}</strong>, but live $AR is on <strong>Mainnet</strong>. Set{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta</code> in{" "}
                <code>.env.local</code>, restart the dev server, then create the pool — do not create on devnet for go-live.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {publicKey ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => void disconnectPhantom()}>
                    Disconnect
                  </Button>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Connected: <span className="font-mono">{short(publicKey.toBase58())}</span>
                  </p>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-2"
                    disabled={connecting || !providerAvailable}
                    onClick={() => void connectPhantom()}
                  >
                    {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
                    {connecting ? "Connecting…" : "Connect Phantom"}
                  </Button>
                  {connecting ? (
                    <Button type="button" variant="outline" size="sm" onClick={cancelConnect}>
                      Cancel
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {walletError ? <p className="text-xs text-destructive">{walletError}</p> : null}
            {showCliFallback ? (
              <p className="text-xs text-muted-foreground">
                CLI fallback:{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">Use the authenticated staking setup action from the admin interface</code>{" "}
                with a funded keypair at <code className="rounded bg-muted px-1 font-mono text-[11px]">~/.config/solana/id.json</code>.
              </p>
            ) : null}
            {publicKey ? null : (
              <p className="text-xs text-muted-foreground">
                Allow browser popups for Phantom. Use{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">http://localhost:3000/internal/staking/setup</code>{" "}
                for the local development server.
              </p>
            )}
            {!providerAvailable && !publicKey ? (
              <p className="text-xs text-muted-foreground">
                Install{" "}
                <a href="https://phantom.app/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Phantom
                </a>{" "}
                and refresh this page.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Create $AR stake pool</CardTitle>
          <CardDescription>
            Defaults match AgentRanking tiers: Node 7d, Validator 14d, Core 30d. Max lock is set higher so future campaigns can use longer locks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Leave the defaults below</strong> for AgentRanking go-live (250k/7d, 500k/14d, 1M/30d tiers). Only change nonce if you already created a pool with this wallet and mint.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ar-mint">Underlying token mint</Label>
              <Input id="ar-mint" value={mint} onChange={(e) => setMint(e.target.value)} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                This should be the live $AR SPL mint.
                {underlyingTokenProgram ? (
                  <>
                    {" "}
                    Detected token program: <span className="font-medium text-foreground">{underlyingTokenProgram}</span>.
                  </>
                ) : null}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pool-nonce">Pool nonce</Label>
              <Input id="pool-nonce" value={nonce} onChange={(e) => setNonce(e.target.value)} inputMode="numeric" />
              <p className="text-xs text-muted-foreground">Use 0 unless a pool already exists for this wallet/mint/nonce.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-weight">Max weight multiplier</Label>
              <Input id="max-weight" value={maxWeight} onChange={(e) => setMaxWeight(e.target.value)} inputMode="decimal" />
              <p className="text-xs text-muted-foreground">1 = no duration weighting. Higher values increase rewards for longer lock periods.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-days">Minimum lock days</Label>
              <Input id="min-days" value={minDays} onChange={(e) => setMinDays(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-days">Maximum lock days</Label>
              <Input id="max-days" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          {predicted ? (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs">
              <p className="font-semibold text-foreground">Predicted pool accounts</p>
              <p className="mt-2 font-mono text-muted-foreground">Pool: {short(predicted.stakePool)}</p>
              <p className="font-mono text-muted-foreground">Stake mint: {short(predicted.stakePoolMint)}</p>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          ) : null}
          <Button type="button" className="gap-2" onClick={() => void createPool()} disabled={submitting || !publicKey || !isMainnetTarget}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Create stake pool with Phantom
          </Button>
        </CardContent>
      </Card>
      {result ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-600" aria-hidden />
              <div>
                <CardTitle>Stake pool created</CardTitle>
                <CardDescription>Copy these values into local and VPS env, rebuild, then test the normal staking page.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed">
              <pre className="whitespace-pre-wrap break-all">{result.env}</pre>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void copyToClipboard(result.env, "Env vars")}>
                <Copy className="size-3.5" />
                Copy env vars
              </Button>
              {result.txId ? (
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={solanaExplorerTxUrl(result.txId)} target="_blank" rel="noopener noreferrer">
                    View tx
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Target cluster: <span className="font-medium text-foreground">{stakingPageSolanaClusterLabel()}</span>. Restart localhost after
              editing <code>.env</code> because <code>NEXT_PUBLIC_*</code> values are bundled into the client.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
