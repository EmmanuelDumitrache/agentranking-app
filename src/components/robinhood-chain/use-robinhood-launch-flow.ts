"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
import {
  fetchRobinhoodLaunchFee,
  mapRobinhoodLaunchError,
  runRobinhoodLaunchPipeline,
  type RobinhoodLaunchProgressPhase,
  type RobinhoodLaunchResult,
} from "@/lib/robinhood-chain/robinhood-launch-client";
import type { RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
async function sendCustodialEvmTx(
  agentDbId: number,
  tx: {
    chainId: number;
    account: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
  },
): Promise<`0x${string}`> {
  const res = await fetch(`/api/dashboard/agents/${agentDbId}/evm-wallet/send-tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      value: tx.value.toString(),
      gas: tx.gas?.toString(),
      expectedAddress: tx.account,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; hash?: string; error?: string };
  if (!res.ok || !data.ok || !data.hash) {
    throw new Error(data.error || "Custodial EVM send failed");
  }
  return data.hash as `0x${string}`;
}
export function useRobinhoodLaunchFlow() {
  const { address, chain, isConnected } = useAccount();
  const { switchChain, isPending: switchingChain } = useSwitchChain();
  const { sendTransactionAsync, isPending: sendingTx } = useSendTransaction();
  const [launchFeeEth, setLaunchFeeEth] = useState<string | null>(null);
  const [estimatedGasCostEth, setEstimatedGasCostEth] = useState<string | null>(null);
  const [estimatedGasCostWei, setEstimatedGasCostWei] = useState<string | null>(null);
  const [phase, setPhase] = useState<RobinhoodLaunchProgressPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<RobinhoodLaunchResult | null>(null);
  const onRobinhoodChain = chain?.id === ROBINHOOD_CHAIN_ID;
  useEffect(() => {
    let cancelled = false;
    void fetchRobinhoodLaunchFee()
      .then((feeData) => {
        if (cancelled) return;
        setLaunchFeeEth(feeData.launchFeeEth);
        setEstimatedGasCostEth(feeData.estimatedGasCostEth);
        setEstimatedGasCostWei(feeData.estimatedGasCostWei);
      })
      .catch((feeError) => {
        if (!cancelled) {
          setError(feeError instanceof Error ? feeError.message : "Could not load launch fees");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const switchToRobinhood = useCallback(async () => {
    try {
      await switchChain({ chainId: ROBINHOOD_CHAIN_ID });
    } catch (err) {
      throw err instanceof Error ? err : new Error("Could not switch network");
    }
  }, [switchChain]);
  /** Clear prior errors and show preparing state before wallet switch / prepare. */
  const beginLaunch = useCallback(() => {
    setPhase("preparing");
    setError(null);
    setErrorCode(null);
    setPendingTxHash(null);
    setResult(null);
  }, []);
  /**
   * Launch a token on Robinhood Chain.
   *
   * @param form      Token metadata (name, symbol, etc.)
   * @param signerAddress  Creator/signer wallet address (agent EVM wallet).
   * @param opts.agentDbId + custodial → server-sign (no Privy/wagmi).
   */
  const launch = useCallback(
    async (
      form: Omit<RobinhoodLaunchFormFields, "creatorWallet">,
      signerAddress: string,
      opts?: { agentDbId?: number; custodial?: boolean },
    ) => {
      if (!signerAddress) throw new Error("Agent EVM wallet is not available. Set it up first.");
      const custodial = Boolean(opts?.custodial && opts.agentDbId != null);
      if (!custodial && !onRobinhoodChain) {
        const err = new Error("Switch to Robinhood Chain (chain ID 4663) before launching.");
        (err as Error & { code?: string }).code = "WRONG_CHAIN";
        throw err;
      }
      beginLaunch();
      try {
        const agentDbId = opts?.agentDbId;
        const launchResult = await runRobinhoodLaunchPipeline({
          form: { ...form, creatorWallet: signerAddress },
          sendTransaction:
            custodial && agentDbId != null
              ? (tx) => sendCustodialEvmTx(agentDbId, tx)
              : sendTransactionAsync,
          onPhase: setPhase,
        });
        setResult(launchResult);
        return launchResult;
      } catch (err) {
        const mapped = mapRobinhoodLaunchError(err);
        setError(mapped.message);
        setErrorCode(mapped.code ?? null);
        if (mapped.txHash) setPendingTxHash(mapped.txHash);
        setPhase("error");
        throw err;
      }
    },
    [beginLaunch, onRobinhoodChain, sendTransactionAsync],
  );
  return {
    address,
    isConnected,
    onRobinhoodChain,
    switchingChain,
    sendingTx,
    launchFeeEth,
    estimatedGasCostEth,
    estimatedGasCostWei,
    setLaunchFeeEth,
    phase,
    error,
    errorCode,
    pendingTxHash,
    result,
    switchToRobinhood,
    beginLaunch,
    launch,
  };
}
