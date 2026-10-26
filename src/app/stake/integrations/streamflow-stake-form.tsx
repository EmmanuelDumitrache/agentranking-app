"use client";
import BN from "bn.js";
import { useCallback, useMemo, useState } from "react";
import type { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getMint } from "@solana/spl-token";
import { PublicKey, Transaction, type PublicKey as PublicKeyType } from "@solana/web3.js";
import { getBN } from "@streamflow/common";
import { SolanaStakingClient } from "@streamflow/staking";
import { CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Info, Loader2, Lock } from "lucide-react";
import "@/app/stake/styles/staking-wallet.css";
import dashboardStyles from "@/app/stake/dashboard/staking-dashboard.module.css";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  firstFreeStakeNonce,
  solanaExplorerTxUrl,
  streamflowICluster,
  streamflowRpcEndpoint,
  streamflowStakePoolDefaults,
  type StreamflowPoolConfigDto,
} from "@/lib/streamflow-stake-config";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import { resolveArSolanaMint, resolveArTokenDecimals } from "@/lib/ar-token-public";
import { parseHumanAmountNumber } from "@/lib/ar-staking-preview";
import { resolveTokenProgramIdForMint } from "@/lib/solana-mint-token-program";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
export { parseArAmountToTierScale } from "@/lib/ar-staking-preview";
export const LOCK_DAY_OPTIONS = [7, 14, 30] as const;
export type StakingLockDays = (typeof LOCK_DAY_OPTIONS)[number];
export type StreamflowStakeFormProps = Readonly<{
  onStakeSuccess?: () => void;
  amountStr: string;
  lockDays: StakingLockDays;
  hideSubmitUi?: boolean;
  /** Active stake nonces for this wallet (from positions API). */
  usedStakeNonces?: readonly number[];
  /** Stake-site embedding hides operator controls and duplicate actions. */
  variant?: "default" | "stake-site";
  initialPoolConfig?: StreamflowPoolConfigDto | null;
}>;
export function StreamflowStakeForm({
  onStakeSuccess,
  amountStr,
  lockDays,
  hideSubmitUi = false,
  usedStakeNonces = [],
  variant = "default",
  initialPoolConfig,
}: StreamflowStakeFormProps) {
  const isStakeSite = variant === "stake-site";
  const { connection } = useConnection();
  const { publicKey, wallet, connect, select, wallets } = useWallet();
  const injectedPk = getSolanaWalletProvider()?.publicKey ?? null;
  const signerPk = publicKey ?? injectedPk;
  const defs = useMemo(() => streamflowStakePoolDefaults(), []);
  const poolEnvLocked = Boolean(defs.stakePool.trim() && defs.stakePoolMint.trim());
  const stakingClient = useMemo(
    () =>
      new SolanaStakingClient({
        clusterUrl: streamflowRpcEndpoint(),
        cluster: streamflowICluster(),
      }),
    [],
  );
  const [stakePoolStr, setStakePoolStr] = useState(defs.stakePool);
  const initialNonce = firstFreeStakeNonce(usedStakeNonces);
  const [nonceDraft, setNonceStr] = useState(initialNonce == null ? "" : String(initialNonce));
  const parsedNonceDraft = Number.parseInt(nonceDraft, 10);
  const nonceWasClaimed = Number.isFinite(parsedNonceDraft) && usedStakeNonces.includes(parsedNonceDraft);
  const fallbackNonce = firstFreeStakeNonce(usedStakeNonces);
  const nonceStr = nonceWasClaimed ? (fallbackNonce == null ? "" : String(fallbackNonce)) : nonceDraft;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const resolveMintDecimals = useCallback(
    async (stakeMintPk: PublicKey, underlyingMintPk: PublicKey): Promise<number | null> => {
      try {
        const info = await getMint(connection, stakeMintPk);
        return info.decimals;
      } catch {
        /* fall through */
      }
      if (!stakeMintPk.equals(underlyingMintPk)) {
        try {
          const info = await getMint(connection, underlyingMintPk);
          return info.decimals;
        } catch {
          /* fall through */
        }
      }
      if (underlyingMintPk.toBase58() === resolveArSolanaMint()) {
        return resolveArTokenDecimals();
      }
      return null;
    },
    [connection],
  );
  const loadPoolConfig = useCallback(async () => {
    const poolAddress = stakePoolStr.trim();
    if (!poolAddress) return null;
    const pool = await stakingClient.getStakePool(new PublicKey(poolAddress));
    const stakeMintPk = pool.stakeMint;
    const underlyingMintPk = pool.mint;
    let decimals = await resolveMintDecimals(underlyingMintPk, underlyingMintPk);
    if (decimals == null && poolEnvLocked) decimals = resolveArTokenDecimals();
    if (decimals == null) decimals = await resolveMintDecimals(stakeMintPk, underlyingMintPk);
    if (decimals == null && poolEnvLocked) decimals = resolveArTokenDecimals();
    if (decimals == null) throw new Error("Staking is initializing — try again in a moment.");
    return {
      poolAddress,
      stakeMint: stakeMintPk.toBase58(),
      underlyingMint: underlyingMintPk.toBase58(),
      constraints: { min: pool.minDuration.toString(), max: pool.maxDuration.toString() },
      decimals,
      fetchedAt: new Date().toISOString(),
    } satisfies StreamflowPoolConfigDto;
  }, [poolEnvLocked, resolveMintDecimals, stakePoolStr, stakingClient]);
  const {
    data: poolConfig,
    loading: poolConfigLoading,
    error: poolConfigError,
    refresh: refreshPoolConfig,
  } = useAsyncResource(`streamflow-pool:${stakePoolStr.trim()}`, loadPoolConfig, {
    initialData:
      initialPoolConfig?.poolAddress === stakePoolStr.trim()
        ? initialPoolConfig
        : undefined,
    initialDataKey: initialPoolConfig
      ? `streamflow-pool:${initialPoolConfig.poolAddress}`
      : null,
    revalidateOnMount: false,
  });
  const stakeMintSource = poolConfig?.stakeMint ?? defs.stakePoolMint;
  const [stakePoolMintStr, setStakePoolMintStr] = useSourceDraft(stakeMintSource, stakeMintSource);
  const mintDecimals = poolConfig?.decimals ?? (poolEnvLocked ? resolveArTokenDecimals() : null);
  const loadingPool = Boolean(stakePoolStr.trim()) && poolConfigLoading;
  const resolvingMint = loadingPool;
  const poolError = poolConfigError?.message ?? null;
  const bootstrapPoolConfig = useCallback(async () => {
    refreshPoolConfig();
  }, [refreshPoolConfig]);
  const suggestedNonce = useMemo(() => firstFreeStakeNonce(usedStakeNonces), [usedStakeNonces]);
  const onStake = useCallback(async () => {
    setError(null);
    setLastSignature(null);
    const injected = getSolanaWalletProvider();
    let signerKey = publicKey ?? injected?.publicKey ?? null;
    if (!signerKey) {
      setError("Connect your Phantom wallet first.");
      return;
    }
    if (!wallet?.adapter?.publicKey && injected?.publicKey) {
      try {
        const name =
          wallets.find((w) => w.adapter.name === "Phantom")?.adapter.name ?? wallets[0]?.adapter.name;
        if (name && wallet?.adapter.name !== name) await select(name);
        await connect();
        signerKey = publicKey ?? injected.publicKey ?? signerKey;
      } catch {
        /* Streamflow can sign via injected Phantom below */
      }
    }
    const adapter = resolveStakingSignerAdapter(signerKey, wallet);
    if (!adapter?.publicKey) {
      setError(
        "Wallet signer is not ready. Disconnect, connect Phantom again, wait for Connected, then retry stake.",
      );
      return;
    }
    if (mintDecimals == null) {
      setError(poolError ?? "Staking is initializing — try again in a moment.");
      return;
    }
    const amountNum = parseHumanAmountNumber(amountStr);
    if (amountNum == null) {
      setError("Enter a valid whole-number stake amount (e.g. 250000).");
      return;
    }
    const durationSec = lockDays * 86_400;
    const nonce = Number.parseInt(nonceStr, 10);
    if (!Number.isFinite(nonce) || nonce < 0 || nonce > 255) {
      setError("Nonce must be 0–255.");
      return;
    }
    let stakePoolPk: PublicKey;
    try {
      stakePoolPk = new PublicKey(stakePoolStr.trim());
    } catch {
      setError("Stake pool address is not valid.");
      return;
    }
    const amount = getBN(amountNum, mintDecimals);
    const duration = new BN(durationSec);
    setSubmitting(true);
    try {
      const poolMeta = await stakingClient.getStakePool(stakePoolPk);
      const minDurationSec = Number(poolMeta.minDuration.toString());
      const maxDurationSec = Number(poolMeta.maxDuration.toString());
      if (durationSec < minDurationSec || durationSec > maxDurationSec) {
        const minDays = Math.ceil(minDurationSec / 86_400);
        const maxDays = Math.floor(maxDurationSec / 86_400);
        throw new Error(`Lock period must be between ${minDays} and ${maxDays} days for this pool.`);
      }
      const payerPk = adapter.publicKey;
      const onChainEntries = await stakingClient.searchStakeEntries({
        stakePool: stakePoolPk,
        payer: payerPk,
      });
      const activeNonces = onChainEntries
        .filter((row) => Number((row.account as { closedTs?: { toString(): string } }).closedTs?.toString() ?? "0") === 0)
        .map((row) => Number((row.account as { nonce: { toString(): string } }).nonce.toString()));
      if (activeNonces.includes(nonce)) {
        const free = firstFreeStakeNonce(activeNonces);
        if (free == null) {
          setNonceStr("");
          throw new Error("All 256 stake slots already have active positions.");
        }
        setNonceStr(String(free));
        throw new Error(
          `Stake slot #${nonce} already has an active position. Slot #${free} is selected — click Stake again to confirm.`,
        );
      }
      const depositMintPk = poolMeta.mint;
      const receiptMintPk = poolMeta.stakeMint;
      const tokenProgramId = await resolveTokenProgramIdForMint(connection, depositMintPk);
      const res = await stakingClient.stake(
        {
          nonce,
          amount,
          duration,
          stakePool: stakePoolPk,
          /** Underlying $AR mint — debited from the wallet (not the receipt `stakeMint`). */
          stakePoolMint: depositMintPk,
          tokenProgramId,
        },
        {
          invoker: adapter,
          computeLimit: "autoSimulate",
        },
      );
      setLastSignature(res.txId);
      void fetch("/api/token/staking/report-stake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: signerKey.toBase58(),
          poolAddress: stakePoolStr.trim(),
          mintAddress: receiptMintPk.toBase58(),
          amountRaw: amount.toString(),
          amountUi: amountStr,
          nonce,
          durationSec,
          txSignature: res.txId,
        }),
      }).catch(() => {});
      void fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "stake_tx_confirmed", path: "/" }),
      }).catch(() => {});
      onStakeSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction failed.";
      if (/ConstraintTokenMint|2014|token mint constraint/i.test(msg)) {
        setError(
          "Token mint mismatch — refresh the page and try again. Your $AR wallet balance is used for new stakes.",
        );
      } else if (/insufficient|0x1/i.test(msg)) {
        setError("Insufficient $AR or SOL for fees. Lower the amount or add funds.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    amountStr,
    lockDays,
    mintDecimals,
    nonceStr,
    onStakeSuccess,
    stakePoolStr,
    stakingClient,
    wallet,
    publicKey,
    connect,
    select,
    wallets,
    connection,
    poolError,
  ]);
  const explorerUrl = lastSignature ? solanaExplorerTxUrl(lastSignature) : null;
  const formattedAmount = (() => {
    const n = parseHumanAmountNumber(amountStr);
    if (n == null) return null;
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  })();
  if (lastSignature && explorerUrl) {
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="size-7 text-emerald-500" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400">Stake confirmed!</p>
          <p className="text-sm text-muted-foreground">Your transaction was submitted to Solana.</p>
        </div>
        <a
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 font-mono text-xs text-primary hover:bg-primary/10"
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {lastSignature.slice(0, 20)}…{lastSignature.slice(-8)}
          <ExternalLink className="size-3.5" />
        </a>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setLastSignature(null)}>
            Stake again
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="gap-1.5">
              View on Solscan
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {!isStakeSite && !poolEnvLocked && !stakePoolStr.trim() && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Stake pool not configured in server .env</p>
            <p className="mt-0.5 text-muted-foreground">
              Add NEXT_PUBLIC_STREAMFLOW_STAKE_POOL and NEXT_PUBLIC_STREAMFLOW_STAKE_POOL_MINT to the app .env on your VPS, rebuild, and
              restart — or paste pool addresses below for local testing only.
            </p>
          </div>
        </div>
      )}
      {!isStakeSite ? (
        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <a
            href="https://streamflow.finance"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            Streamflow Finance
          </a>
          {" "}
          · Non-custodial
        </p>
      ) : null}
      {!isStakeSite && !poolEnvLocked ? (
      <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-0 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        Advanced options
      </Button>
      {showAdvanced && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
          {!poolEnvLocked ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="sf-pool">
                  Stake pool address
                </label>
                <Input
                  id="sf-pool"
                  className="font-mono text-xs"
                  value={stakePoolStr}
                  onChange={(e) => setStakePoolStr(e.target.value)}
                  placeholder="Streamflow stake pool pubkey"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="sf-mint">
                  Receipt mint (reference)
                </label>
                <Input
                  id="sf-mint"
                  className="font-mono text-xs"
                  value={stakePoolMintStr}
                  onChange={(e) => setStakePoolMintStr(e.target.value)}
                  placeholder="SPL token mint address"
                />
              </div>
            </div>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              Pool {stakePoolStr.slice(0, 8)}…{stakePoolStr.slice(-6)} · Mint {stakePoolMintStr.slice(0, 8)}…
              {stakePoolMintStr.slice(-6)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void bootstrapPoolConfig()}
              disabled={loadingPool || !stakePoolStr.trim()}
              className="h-8 gap-1.5"
            >
              {loadingPool ? <Loader2 className="size-3.5 animate-spin" /> : <Info className="size-3.5" />}
              Reload pool constraints
            </Button>
            {poolError ? <p className="text-xs text-destructive">{poolError}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="sf-nonce">
              Stake entry nonce (0–255)
            </label>
            <Input
              id="sf-nonce"
              inputMode="numeric"
              value={nonceStr}
              onChange={(e) => setNonceStr(e.target.value)}
              className="max-w-[140px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Each nonce is a separate stake entry. The next free slot is chosen automatically when one is already in use.
            </p>
          </div>
        </div>
      )}
      </>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {usedStakeNonces.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          Active stake slot{usedStakeNonces.length === 1 ? "" : "s"}:{" "}
          {usedStakeNonces.join(", ")} — {suggestedNonce == null
            ? "all stake slots are currently in use."
            : `this transaction uses slot #${suggestedNonce}.`}
        </p>
      ) : null}
      {!hideSubmitUi ? (
        <div className={cn("flex flex-col gap-3 pt-2", isStakeSite ? "items-stretch" : "items-center")}>
          <Button
            type="button"
            size="lg"
            variant={isStakeSite ? "ghost" : "default"}
            className={cn(
              "gap-2",
              isStakeSite
                ? cn(dashboardStyles.stakeSubmitMarketing, "h-12 w-full rounded-xl shadow-none hover:bg-[color-mix(in_oklab,#e4e4e4_20%,transparent)]")
                : "h-11 min-w-[220px] rounded-full px-8 shadow-md",
            )}
            onClick={() => void onStake()}
            disabled={
              submitting ||
              resolvingMint ||
              mintDecimals == null ||
              !signerPk ||
              !formattedAmount
            }
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {submitting ? "Signing…" : resolvingMint ? "Loading pool…" : "Stake $AR"}
          </Button>
          {!signerPk ? (
            <p className="text-center text-[12px] text-[var(--ar-text-muted)]">
              {isStakeSite ? "Connect Phantom above to enable staking." : "Connect your Phantom wallet above to stake."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
export type StakePositionRow = {
  id: string;
  poolAddress: string;
  mintAddress: string;
  amountUi: string;
  amountRaw?: string;
  nonce: number;
  durationSec: number;
  lockStartAt: string | null;
  lockEndAt: string | null;
  createdAt: string;
  txSignature: string;
};
function buildInjectedSignerAdapter(
  signerPublicKey: PublicKeyType,
  injected: NonNullable<ReturnType<typeof getSolanaWalletProvider>>,
): SignerWalletAdapter {
  return {
    publicKey: signerPublicKey,
    signTransaction: injected.signTransaction!.bind(injected),
    signAllTransactions: async (txs) => {
      const signed: Transaction[] = [];
      for (const tx of txs) {
        signed.push(await injected.signTransaction!(tx as Transaction));
      }
      return signed;
    },
  } as SignerWalletAdapter;
}
/** Streamflow requires `invoker.publicKey` — never pass wallet-adapter before connect() finishes. */
function resolveStakingSignerAdapter(
  signerPublicKey: PublicKeyType | null,
  wallet: ReturnType<typeof useWallet>["wallet"],
): SignerWalletAdapter | null {
  const injected = getSolanaWalletProvider();
  const adapter = wallet?.adapter as SignerWalletAdapter | undefined;
  if (adapter?.publicKey) return adapter;
  const pk = signerPublicKey ?? injected?.publicKey ?? null;
  if (!pk || !injected?.signTransaction) return null;
  return buildInjectedSignerAdapter(pk, injected);
}
