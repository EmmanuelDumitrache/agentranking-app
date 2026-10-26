"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { createPublicClient, http, type Hex } from "viem";
import { ExternalLink, Gift, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import {
  PublicSitePageHeader,
  PublicSitePanel,
  PublicSiteEmptyState,
} from "@/components/public-site/public-site-ui";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { PublicTokenAvatar } from "@/components/public-site/token-avatar";
import { useAgentLaunchWallet } from "@/hooks/use-agent-launch-wallet";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
import {
  establishLaunchWalletSession,
  logoutLaunchWalletSession,
} from "@/lib/launch-wallet-session/client";
import { fundAddressFromConnectedWallet } from "@/lib/agent-launch/wallet-client";
import {
  continuePublicMetaplexLaunch,
  pollPublicMetaplexFunding,
  type PublicMetaplexFundingInfo,
} from "@/lib/agent-launch/public-metaplex-quick-launch-client";
import { mapTokenLaunchError } from "@/lib/agent-launch/token-launch-utils";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import {
  ROBINHOOD_CHAIN_CONFIG,
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
} from "@/lib/robinhood-chain/config";
import { mapRobinhoodClaimError } from "@/lib/robinhood-chain/map-claim-error";
import type {
  PublicLaunchesResponse,
  PublicMetaplexLaunchRow,
} from "@/lib/public-launch/my-launches-types";
import { cn } from "@/lib/utils";
type ContinuePhase = "idle" | "funding" | "deploying";
export function PublicLaunchMyFeesPage({
  initialData,
}: {
  readonly initialData: PublicLaunchesResponse;
}) {
  const loadLaunchesResource = useCallback(async (signal: AbortSignal): Promise<PublicLaunchesResponse> => {
    const res = await fetch("/api/launch-wallet/my-launches", { cache: "no-store", signal });
    const json = (await res.json()) as PublicLaunchesResponse;
    if (!res.ok) throw new Error(json.error || "Could not load launches");
    return json;
  }, []);
  const launchesResource = useAsyncResource("public-launch-my-fees", loadLaunchesResource, {
    initialData,
    initialDataKey: "public-launch-my-fees",
    revalidateOnMount: false,
  });
  const data = launchesResource.data;
  const loading = launchesResource.loading;
  const [chainMode, setChainMode] = useSourceDraft<"solana" | "evm">(
    data?.wallet ?? null,
    data?.chain ?? "solana",
  );
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [feeInfo, setFeeInfo] = useState<Record<string, { claimable?: string; canClaim?: boolean }>>({});
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [continuePhase, setContinuePhase] = useState<ContinuePhase>("idle");
  const [continueErrorById, setContinueErrorById] = useState<Record<string, string>>({});
  const solWallet = useAgentLaunchWallet();
  const { address, isConnected, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const loadLaunches = launchesResource.refresh;
  const fundMetaplexFromPhantom = useCallback(async (info: PublicMetaplexFundingInfo) => {
    const shortfall =
      info.shortfallLamports > 0
        ? info.shortfallLamports
        : Math.max(0, info.minLamports - info.balanceLamports);
    if (shortfall <= 0) return;
    showToast("Approve the transfer in Phantom…", "info");
    const sent = await fundAddressFromConnectedWallet({
      toAddress: info.custodialWallet,
      lamports: shortfall,
    });
    for (let i = 0; i < 30; i++) {
      const funding = await pollPublicMetaplexFunding(info.attemptId);
      if (funding.funded || funding.balanceLamports >= Math.floor(info.minLamports * 0.9)) {
        return funding;
      }
      if (i > 2 && funding.balanceLamports >= sent.lamportsSent) {
        if (funding.balanceLamports + 5_000_000 >= info.minLamports) return funding;
      }
      await new Promise((r) => setTimeout(r, 1_200));
    }
    throw new Error(
      "Transfer sent, but launch wallet balance is still catching up. Try again in a few seconds.",
    );
  }, []);
  const continueMetaplexOnPage = useCallback(
    async (launch: PublicMetaplexLaunchRow) => {
      setContinueErrorById((prev) => {
        const next = { ...prev };
        delete next[launch.id];
        return next;
      });
      setContinuingId(launch.id);
      try {
        if (!solWallet.address) {
          await solWallet.connect();
        }
        if (!solWallet.address) throw new Error("Connect Phantom first.");
        await establishLaunchWalletSession({ chain: "solana", wallet: solWallet.address });
        setContinuePhase("funding");
        let funding = await pollPublicMetaplexFunding(launch.id);
        if (!funding.funded) {
          await fundMetaplexFromPhantom(funding);
          funding = await pollPublicMetaplexFunding(launch.id);
        }
        if (!funding.funded) {
          throw new Error(funding.fundingMessage);
        }
        setContinuePhase("deploying");
        showToast("Continuing Metaplex deploy…", "info");
        const attempt = await continuePublicMetaplexLaunch(launch.id);
        if (attempt.tokenMint) {
          showToast("Token launched on Metaplex Genesis", "success");
          loadLaunches();
          window.open(publicTokenDetailHref(attempt.tokenMint), "_blank", "noopener,noreferrer");
          return;
        }
        if (attempt.status === "COMPLETE") {
          showToast("Metaplex launch complete", "success");
        } else if (attempt.status === "AR_INDEX_PENDING" || attempt.status === "GENESIS_REGISTERED") {
          showToast("Genesis registered — indexing agent…", "success");
        } else if (attempt.errorMessage) {
          throw new Error(attempt.errorMessage);
        } else if (attempt.status === launch.status) {
          throw new Error(
            `Launch did not advance (still ${attempt.status.replaceAll("_", " ").toLowerCase()}). Try again or contact support.`,
          );
        } else {
          showToast(
            `Status updated: ${attempt.status.replaceAll("_", " ").toLowerCase()}`,
            "success",
          );
        }
        loadLaunches();
      } catch (err) {
        const message = mapTokenLaunchError(err);
        setContinueErrorById((prev) => ({ ...prev, [launch.id]: message }));
        showToast(message, "error");
        loadLaunches();
      } finally {
        setContinuingId(null);
        setContinuePhase("idle");
      }
    },
    [fundMetaplexFromPhantom, loadLaunches, solWallet],
  );
  const connectAndVerify = useCallback(async () => {
    try {
      if (chainMode === "solana") {
        if (!solWallet.address) {
          await solWallet.connect();
        }
        if (!solWallet.address) throw new Error("Connect Phantom first.");
        await establishLaunchWalletSession({ chain: "solana", wallet: solWallet.address });
      } else {
        if (!address) throw new Error("Connect your EVM wallet first.");
        if (chain?.id !== ROBINHOOD_CHAIN_ID) {
          await switchChain({ chainId: ROBINHOOD_CHAIN_ID });
        }
        await establishLaunchWalletSession({ chain: "evm", wallet: address });
      }
      await loadLaunches();
      showToast("Wallet verified");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Verification failed", "error");
    }
  }, [address, chain?.id, chainMode, loadLaunches, solWallet, switchChain]);
  const refreshSolanaFees = useCallback(async (launchId: string) => {
    const res = await fetch(`/api/launch-wallet/solana/fees?launchId=${encodeURIComponent(launchId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      claimableSol?: string | null;
      canDistribute?: boolean;
    };
    if (res.ok) {
      setFeeInfo((prev) => ({
        ...prev,
        [launchId]: { claimable: json.claimableSol ?? "0", canClaim: json.canDistribute },
      }));
    }
  }, []);
  const distributeSolanaFees = useCallback(async (launchId: string) => {
    setClaimingId(launchId);
    try {
      const res = await fetch("/api/launch-wallet/solana/fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchId }),
      });
      const queued = (await res.json()) as { error?: string; jobId?: string };
      if (!res.ok || !queued.jobId) throw new Error(queued.error || "Distribution could not be queued");
      const deadline = Date.now() + 120_000;
      for (;;) {
        const statusRes = await fetch(
          `/api/launch-wallet/solana/fees?launchId=${encodeURIComponent(launchId)}&jobId=${encodeURIComponent(queued.jobId)}`,
          { cache: "no-store" },
        );
        const status = (await statusRes.json()) as {
          error?: string;
          status?: "queued" | "in_progress" | "pending" | "distributed" | "skipped" | "failed";
          reason?: string;
        };
        if (!statusRes.ok) throw new Error(status.error || "Could not read distribution status");
        if (status.status === "distributed") {
          showToast("Fees distributed", "success");
          break;
        }
        if (status.status === "skipped") {
          showToast(status.reason || "No fees were available to distribute", "info");
          break;
        }
        if (status.status === "failed") {
          throw new Error(status.reason || "Distribution failed");
        }
        if (Date.now() >= deadline) {
          throw new Error("Distribution is still processing. Refresh this page to check its status.");
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 1_500));
      }
      await refreshSolanaFees(launchId);
      await loadLaunches();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Distribution failed", "error");
    } finally {
      setClaimingId(null);
    }
  }, [loadLaunches, refreshSolanaFees]);
  const claimRobinhoodFees = useCallback(async (launchId: string) => {
    if (!address) throw new Error("Connect wallet first.");
    setClaimingId(launchId);
    try {
      const prepareRes = await fetch(`/api/launch-wallet/robinhood/${launchId}/fees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const prepareData = (await prepareRes.json()) as {
        ok?: boolean;
        prepared?: {
          chainId: number;
          to: string;
          data: string;
          value: string;
          gasSuggestion?: string;
          steps?: Array<{
            kind: string;
            label: string;
            to: string;
            data: Hex;
            value: string;
            chainId: number;
            optional?: boolean;
          }>;
        };
        error?: string;
      };
      if (!prepareRes.ok || !prepareData.prepared) {
        throw new Error(prepareData.error || "Could not prepare claim");
      }
      const steps = prepareData.prepared.steps?.length
        ? prepareData.prepared.steps
        : [
            {
              kind: "claim",
              label: "Claim fees",
              to: prepareData.prepared.to,
              data: prepareData.prepared.data as Hex,
              value: prepareData.prepared.value,
              chainId: prepareData.prepared.chainId,
            },
          ];
      const client = createPublicClient({
        chain: robinhoodChain,
        transport: http(ROBINHOOD_CHAIN_CONFIG.rpcUrl, {
          timeout: 15_000,
          retryCount: 1,
          retryDelay: 500,
        }),
      });
      const submitted: Array<{ kind: string; hash: Hex }> = [];
      for (const step of steps) {
        if (step.chainId !== ROBINHOOD_CHAIN_ID) {
          throw new Error(`Unexpected chain for ${step.label}.`);
        }
        const transaction = {
          chainId: ROBINHOOD_CHAIN_ID,
          account: address,
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
        const hash = await sendTransactionAsync({ ...transaction, gas });
        const receipt = await client.waitForTransactionReceipt({
          hash,
          pollingInterval: 2_000,
          timeout: 120_000,
        });
        if (receipt.status !== "success") throw new Error(`${step.label} reverted.`);
        submitted.push({ kind: step.kind, hash });
      }
      const txHashes = submitted
        .filter(({ kind }) => kind !== "deploy_splitter")
        .map(({ hash }) => hash);
      if (txHashes.length === 0) throw new Error("No fee-claim transaction was submitted.");
      const recordRes = await fetch(`/api/launch-wallet/robinhood/${launchId}/fees`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHashes }),
      });
      const recordData = (await recordRes.json()) as { ok?: boolean; error?: string };
      if (!recordRes.ok || !recordData.ok) {
        throw new Error(recordData.error || "Claim sent but could not be recorded");
      }
      showToast("Fees claimed", "success");
      await loadLaunches();
    } catch (err) {
      showToast(mapRobinhoodClaimError(err), "error");
    } finally {
      setClaimingId(null);
    }
  }, [address, loadLaunches, sendTransactionAsync]);
  const solanaPumpLaunches = chainMode === "solana" ? data?.solana ?? [] : [];
  const metaplexLaunches = chainMode === "solana" ? data?.metaplex ?? [] : [];
  const robinhoodLaunches = chainMode === "evm" ? data?.robinhood ?? [] : [];
  const hasAnyLaunches =
    solanaPumpLaunches.length > 0 || metaplexLaunches.length > 0 || robinhoodLaunches.length > 0;
  const authenticated = Boolean(data?.ok && data.wallet);
  return (
    <PublicSitePageShell>
      <PublicSitePageHeader
        eyebrow="Launchpad"
        title="My launches & fees"
        description="Connect the wallet that created your tokens to review launches and claim creator fees."
        actions={
          <Link href="/launch" className="ui-btn ui-btn-secondary ui-btn-sm">
            New launch
          </Link>
        }
      />
      <PublicSitePanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={chainMode === "solana" ? "default" : "outline"}
              onClick={() => setChainMode("solana")}
            >
              Solana
            </Button>
            <Button
              type="button"
              size="sm"
              variant={chainMode === "evm" ? "default" : "outline"}
              onClick={() => setChainMode("evm")}
            >
              Robinhood
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chainMode === "solana" ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void solWallet.connect()}>
                {solWallet.connected ? "Phantom connected" : "Connect Phantom"}
              </Button>
            ) : (
              <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
            )}
            <Button type="button" size="sm" onClick={() => void connectAndVerify()}>
              Verify wallet
            </Button>
            {authenticated ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void logoutLaunchWalletSession().then(() => loadLaunches())}
              >
                End session
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => void loadLaunches()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {data?.wallet ? (
          <p className="text-muted-foreground mt-3 font-mono text-xs">{data.wallet}</p>
        ) : null}
      </PublicSitePanel>
      {loading ? (
        <PublicSitePanel className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </PublicSitePanel>
      ) : !authenticated ? (
        <PublicSiteEmptyState
          message="Verify your wallet to see launches created from this address."
          actionHref="/launch"
          actionLabel="Go to launchpad"
        />
      ) : !hasAnyLaunches ? (
        <PublicSiteEmptyState
          message={`No ${chainMode === "solana" ? "Solana" : "Robinhood"} launches found for this wallet yet.`}
          actionHref="/launch"
          actionLabel="Launch a token"
        />
      ) : (
        <div className="grid gap-3">
          {metaplexLaunches.map((launch) => {
            const shortfallSol = launch.shortfallLamports / 1e9;
            const isContinuing = continuingId === launch.id;
            return (
              <PublicSitePanel key={`metaplex-${launch.id}`} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <PublicTokenAvatar
                      name={launch.name || "Untitled"}
                      symbol={launch.symbol}
                      imageUrl={launch.imageUrl}
                      className="size-12"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {launch.name || "Untitled"}{" "}
                        {launch.symbol ? `(${launch.symbol})` : ""}
                        <span className="text-muted-foreground ml-1 text-xs">· Metaplex · incomplete</span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {launch.status.replaceAll("_", " ").toLowerCase()} ·{" "}
                        {new Date(launch.updatedAt).toLocaleDateString()}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">{launch.fundingMessage}</p>
                      {!launch.funded && shortfallSol > 0 ? (
                        <p className="mt-1 text-xs text-amber-400">
                          Remaining to fund: ~{shortfallSol.toFixed(4)} SOL — Phantom will prompt to send it
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-emerald-400">
                          Funded — ready to retry mint / deploy
                        </p>
                      )}
                      {isContinuing ? (
                        <p className="mt-1 text-xs text-foreground">
                          {continuePhase === "funding"
                            ? "Waiting for Phantom / funding confirmation…"
                            : "Deploying on-chain — keep this tab open…"}
                        </p>
                      ) : null}
                      {launch.href ? (
                        <Link href={launch.href} className="mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                          View token <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={Boolean(continuingId)}
                    onClick={() => void continueMetaplexOnPage(launch)}
                  >
                    {isContinuing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {continuePhase === "funding" ? "Funding…" : "Deploying…"}
                      </>
                    ) : null}
                    {!isContinuing && (launch.funded ? "Continue deploy" : "Fund & continue")}
                  </Button>
                </div>
                {launch.errorMessage ? (
                  <p className="mt-3 text-xs text-amber-400">{launch.errorMessage}</p>
                ) : null}
                {continueErrorById[launch.id] ? (
                  <p className="mt-3 text-xs text-red-400">{continueErrorById[launch.id]}</p>
                ) : null}
              </PublicSitePanel>
            );
          })}
          {solanaPumpLaunches.map((launch) => (
            <PublicSitePanel key={launch.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <PublicTokenAvatar
                    name={launch.name || "Untitled"}
                    symbol={launch.symbol}
                    imageUrl={launch.imageUrl}
                    className="size-12"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {launch.name || "Untitled"} {launch.symbol ? `(${launch.symbol})` : ""}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {"status" in launch ? launch.status : "indexed"} ·{" "}
                      {new Date(launch.createdAt).toLocaleDateString()}
                    </p>
                    {launch.href ? (
                      <Link href={launch.href} className="mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                        View token <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshSolanaFees(launch.id)}
                  >
                    Check fees
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={claimingId === launch.id}
                    onClick={() => void distributeSolanaFees(launch.id)}
                  >
                    {claimingId === launch.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Gift className="mr-1 h-4 w-4" />
                        Claim
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {feeInfo[launch.id]?.claimable != null ? (
                <p className={cn("mt-3 text-xs", feeInfo[launch.id].canClaim ? "text-emerald-300" : "text-muted-foreground")}>
                  Claimable: {feeInfo[launch.id].claimable} {chainMode === "solana" ? "SOL" : "WETH"}
                </p>
              ) : null}
            </PublicSitePanel>
          ))}
          {robinhoodLaunches.map((launch) => (
            <PublicSitePanel key={launch.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <PublicTokenAvatar
                    name={launch.name || "Untitled"}
                    symbol={launch.symbol}
                    imageUrl={launch.imageUrl}
                    className="size-12"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {launch.name || "Untitled"} {launch.symbol ? `(${launch.symbol})` : ""}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      indexed · {new Date(launch.createdAt).toLocaleDateString()}
                    </p>
                    {launch.href ? (
                      <Link href={launch.href} className="mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                        View token <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={claimingId === launch.id || !isConnected}
                    onClick={() => void claimRobinhoodFees(launch.id)}
                  >
                    {claimingId === launch.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Gift className="mr-1 h-4 w-4" />
                        Claim fees
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </PublicSitePanel>
          ))}
        </div>
      )}
    </PublicSitePageShell>
  );
}