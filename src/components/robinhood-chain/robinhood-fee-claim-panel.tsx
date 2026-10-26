"use client";
import { useCallback, useState } from "react";
import { ArrowUpRight, Gift, Loader2, RefreshCw } from "lucide-react";
import { createPublicClient, http, type Hex } from "viem";
import { useSendTransaction, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { shortenEvmAddress } from "@/lib/evm-wallet-utils";
import {
  ROBINHOOD_CHAIN_CONFIG,
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
  robinhoodExplorerTxUrl,
} from "@/lib/robinhood-chain/config";
import { mapRobinhoodClaimError } from "@/lib/robinhood-chain/map-claim-error";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";
import type { DashboardRobinhoodClaimableFeesDto } from "@/lib/robinhood-chain/dashboard-claimable-fees";
import { cn } from "@/lib/utils";
type ClaimableFeesResponse = DashboardRobinhoodClaimableFeesDto & { error?: string };
type ClaimStep = {
  kind: string;
  chainId: number;
  to: string;
  data: Hex;
  value: string;
  label: string;
  optional?: boolean;
};
type PrepareClaimResponse = {
  ok: boolean;
  prepared?: {
    chainId: number;
    to: string;
    data: Hex;
    value: string;
    expectedRecipient: string;
    claimableWeth: string;
    claimableWei: string;
    claimableTokenRaw: string;
    feeSplit: {
      enabled: boolean;
      label: string;
      splitter: string | null;
      arTreasury: string;
      creatorFeeBps: number;
      arFeeBps: number;
    };
    steps: ClaimStep[];
  };
  error?: string;
};
type RecordClaimResponse = {
  ok?: boolean;
  error?: string;
  recorded?: Array<{ txHash: string; status: "confirmed" | "failed" }>;
};
const REQUEST_TIMEOUT_MS = 20_000;
const RECEIPT_TIMEOUT_MS = 120_000;
function fmtWeth(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (amount === 0) return "0";
  if (amount < 0.0001) return "<0.0001";
  return amount.toFixed(6).replace(/\.?0+$/, "");
}
async function fetchJsonWithTimeout<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const data = (await response.json()) as T;
    return { response, data };
  } finally {
    window.clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
async function sendCustodialEvmTx(
  agentDbId: number,
  transaction: {
    chainId: number;
    account: `0x${string}`;
    to: `0x${string}`;
    data: Hex;
    value: bigint;
    gas?: bigint;
  },
): Promise<Hex> {
  const { response, data } = await fetchJsonWithTimeout<{ ok?: boolean; hash?: string; error?: string }>(
    `/api/dashboard/agents/${agentDbId}/evm-wallet/send-tx`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: transaction.chainId,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value.toString(),
        gas: transaction.gas?.toString(),
        expectedAddress: transaction.account,
      }),
    },
  );
  if (!response.ok || !data.ok || !data.hash) {
    throw new Error(data.error || "Custodial EVM send failed");
  }
  return data.hash as Hex;
}
export function RobinhoodFeeClaimPanel({
  agentDbId,
  launch,
  evmAddress,
  onRobinhoodChain,
  switchToRobinhood,
  initialData,
  custodial = false,
  compact = false,
  refreshNonce = 0,
}: {
  agentDbId: number;
  launch: RobinhoodLaunchRecord;
  evmAddress: string | null;
  onRobinhoodChain: boolean;
  switchToRobinhood: () => Promise<void>;
  initialData?: DashboardRobinhoodClaimableFeesDto | null;
  custodial?: boolean;
  compact?: boolean;
  refreshNonce?: number;
}) {
  const { sendTransactionAsync, isPending: sendingTx } = useSendTransaction();
  const { isPending: switchingChain } = useSwitchChain();
  const loadFees = useCallback(async (signal: AbortSignal): Promise<ClaimableFeesResponse> => {
    const { response, data } = await fetchJsonWithTimeout<ClaimableFeesResponse>(
      `/api/dashboard/agents/${agentDbId}/robinhood-launches/${launch.id}/claimable-fees`,
      { cache: "no-store", signal },
    );
    if (signal.aborted) throw signal.reason;
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load claimable fees");
    return data;
  }, [agentDbId, launch.id]);
  const feesResourceKey =
    `robinhood-claimable-fees:${agentDbId}:${launch.id}:${refreshNonce}`;
  const feesResource = useAsyncResource(feesResourceKey, loadFees, {
    initialData,
    initialDataKey: initialData && refreshNonce === 0 ? feesResourceKey : null,
    revalidateOnMount: false,
  });
  const fees = feesResource.data;
  const loading = feesResource.loading;
  const [claiming, setClaiming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? feesResource.error?.message ?? null;
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const feeSplitEnabled = fees?.feeSplitEnabled ?? Boolean(launch.feeSplitterAddress);
  const creatorFeeBps = fees?.creatorFeeBps ?? launch.creatorFeeBps ?? (feeSplitEnabled ? 7_000 : 10_000);
  const arFeeBps = fees?.arFeeBps ?? launch.arFeeBps ?? (feeSplitEnabled ? 3_000 : 0);
  const feeShareLabel =
    `${creatorFeeBps / 100}% creator / ${arFeeBps / 100}% AgentRanking`;
  const refresh = feesResource.refresh;
  const walletMismatch =
    Boolean(evmAddress) &&
    Boolean(launch.creatorWallet) &&
    launch.creatorWallet.toLowerCase() !== evmAddress!.toLowerCase();
  const claim = useCallback(
    async (force: boolean) => {
      if (!evmAddress) {
        showToast("Set up your agent EVM wallet first.", "error");
        return;
      }
      if (walletMismatch) {
        showToast("Wallet mismatch for this launch.", "error");
        return;
      }
      if (!custodial && !onRobinhoodChain) {
        try {
          await switchToRobinhood();
        } catch {
          showToast("Switch to Robinhood Chain and try again.", "error");
          return;
        }
      }
      setClaiming(true);
      setActionError(null);
      setSuccessTx(null);
      try {
        const { response: prepareResponse, data: prepareData } =
          await fetchJsonWithTimeout<PrepareClaimResponse>(
            `/api/dashboard/agents/${agentDbId}/robinhood-launches/${launch.id}/prepare-claim`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ force }),
            },
          );
        if (!prepareResponse.ok || !prepareData.prepared) {
          throw new Error(prepareData.error ?? "Could not prepare claim");
        }
        const account = evmAddress as `0x${string}`;
        const client = createPublicClient({
          chain: robinhoodChain,
          transport: http(ROBINHOOD_CHAIN_CONFIG.rpcUrl, {
            timeout: 15_000,
            retryCount: 1,
            retryDelay: 500,
          }),
        });
        const submitted: Array<{ kind: string; hash: Hex }> = [];
        for (const step of prepareData.prepared.steps) {
          if (step.chainId !== ROBINHOOD_CHAIN_ID) {
            throw new Error(`Unexpected chain for ${step.label}.`);
          }
          const transaction = {
            chainId: ROBINHOOD_CHAIN_ID,
            account,
            to: step.to as `0x${string}`,
            data: step.data,
            value: BigInt(step.value || "0"),
          };
          let gas: bigint;
          try {
            const estimate = await client.estimateGas(transaction);
            gas = (estimate * 120n) / 100n;
          } catch (cause) {
            if (step.optional) continue;
            throw new Error(`${step.label} is not currently executable.`, { cause });
          }
          const hash = custodial
            ? await sendCustodialEvmTx(agentDbId, { ...transaction, gas })
            : await sendTransactionAsync({ ...transaction, gas });
          const receipt = await client.waitForTransactionReceipt({
            hash,
            pollingInterval: 2_000,
            timeout: RECEIPT_TIMEOUT_MS,
          });
          if (receipt.status !== "success") throw new Error(`${step.label} reverted.`);
          submitted.push({ kind: step.kind, hash });
        }
        if (submitted.length === 0) throw new Error("No claim transaction was submitted.");
        const claimTxHashes = submitted
          .filter(({ kind }) => kind !== "deploy_splitter")
          .map(({ hash }) => hash);
        if (claimTxHashes.length === 0) throw new Error("No fee-claim transaction was submitted.");
        const { response: recordResponse, data: recordData } =
          await fetchJsonWithTimeout<RecordClaimResponse>(
            `/api/dashboard/agents/${agentDbId}/robinhood-launches/${launch.id}/record-claim`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ claimTxHashes }),
            },
          );
        if (!recordResponse.ok || !recordData.ok) {
          throw new Error(recordData.error ?? "Claim sent but confirmation failed.");
        }
        const finalHash = submitted.at(-1)!.hash;
        setSuccessTx(finalHash);
        showToast("Fees claimed");
        await refresh();
      } catch (cause) {
        const message = mapRobinhoodClaimError(cause);
        setActionError(message);
        showToast(message, message === "Claim cancelled." ? "info" : "error");
      } finally {
        setClaiming(false);
      }
    },
    [
      agentDbId,
      custodial,
      evmAddress,
      launch.id,
      onRobinhoodChain,
      refresh,
      sendTransactionAsync,
      switchToRobinhood,
      walletMismatch,
    ],
  );
  const claimableLabel = fees ? `${fmtWeth(fees.claimableWeth)} WETH` : loading ? "…" : "—";
  const busy = claiming || sendingTx || switchingChain;
  const canAttempt = Boolean(evmAddress) && !walletMismatch;
  const showPositionId = Boolean(launch.positionId) && launch.positionId !== "0" && launch.positionId !== "null";
  const shortReason = (() => {
    if (walletMismatch) return "Wallet mismatch for this launch.";
    if (!evmAddress) return "Set up your agent EVM wallet to claim.";
    if (fees && !fees.canClaim && fees.reason) return fees.reason;
    if (fees?.reason && Number(fees.claimableWeth) <= 0) return fees.reason;
    return null;
  })();
  const claimButton = canAttempt ? (
    <div className="flex justify-center pt-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="min-w-[140px]"
        onClick={() => void claim(!fees?.canClaim)}
        disabled={busy || (loading && !fees)}
      >
        {busy ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            Claiming…
          </>
        ) : (
          "Claim"
        )}
      </Button>
    </div>
  ) : null;
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
          <span className="text-muted-foreground text-xs">Claimable now</span>
          <span className="tabular-nums text-sm font-semibold text-amber-400">{claimableLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Est. USD</span>
          <span className="tabular-nums">{fees?.claimableUsd ? `≈ $${fees.claimableUsd}` : "—"}</span>
        </div>
        {error ? <p className="text-muted-foreground text-[10px]">{error}</p> : null}
        {successTx ? (
          <a
            href={robinhoodExplorerTxUrl(successTx)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[10px]"
          >
            Claim tx <ExternalLinkIcon />
          </a>
        ) : null}
        {claimButton}
      </div>
    );
  }
  return (
    <div className="ui-panel space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
          <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Creator fee rewards
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
          {loading ? "Checking…" : "Refresh fees"}
        </Button>
      </div>
      <p className="text-sm">
        {feeSplitEnabled ? (
          <>
            <span className="font-medium">You earn {creatorFeeBps / 100}%</span>
            <span className="text-muted-foreground"> — On claim, fees split {feeShareLabel}.</span>
          </>
        ) : (
          <>
            <span className="font-medium">You earn 100%</span>
            <span className="text-muted-foreground"> — Claim accrued Quiver rewards to your agent EVM wallet.</span>
          </>
        )}
      </p>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-muted-foreground text-xs">Indexed WETH</p>
          <p className="font-semibold tabular-nums">{claimableLabel}</p>
          {fees?.claimableUsd ? <p className="text-muted-foreground text-[11px] tabular-nums">≈ ${fees.claimableUsd}</p> : null}
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-muted-foreground text-xs">Creator wallet</p>
          <p className="font-mono text-xs">{launch.creatorWallet ? shortenEvmAddress(launch.creatorWallet) : "—"}</p>
        </div>
        {showPositionId ? (
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-muted-foreground text-xs">Position ID</p>
            <p className="font-mono text-xs tabular-nums">{launch.positionId}</p>
          </div>
        ) : null}
      </div>
      {shortReason ? <p className="text-muted-foreground text-xs">{shortReason}</p> : null}
      {error ? <p className="text-muted-foreground text-xs">{error}</p> : null}
      {successTx ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Claim confirmed</p>
          <a
            href={robinhoodExplorerTxUrl(successTx)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-all text-xs text-muted-foreground hover:underline"
          >
            {successTx}
            <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        </div>
      ) : null}
      {claimButton}
      <p className="text-muted-foreground text-[11px]">Quiver rewards can include WETH and the launched token.</p>
    </div>
  );
}
function ExternalLinkIcon() {
  return <ArrowUpRight className="h-3 w-3" aria-hidden />;
}
