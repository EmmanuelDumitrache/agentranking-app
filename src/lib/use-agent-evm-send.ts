"use client";
/**
 * Send ETH from an agent's EVM wallet.
 * Custodial: server-signs via /evm-wallet/send-tx (no Privy).
 * Privy: activates the embedded wallet then sendTransaction.
 */
import { useCallback } from "react";
import { useSendTransaction as usePrivySendTransaction } from "@privy-io/react-auth";
import { parseEther } from "viem";
import { useAgentEvmSigner } from "@/lib/use-agent-evm-signer";
import { ETHEREUM_MAINNET_CHAIN_ID } from "@/lib/evm-wallet-utils";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
const IS_PRIVY_CONFIGURED =
  typeof globalThis.window !== "undefined" &&
  Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
export type AgentEvmSendParams = {
  evmAddress: string;
  to: `0x${string}`;
  amount: string;
  chainId: number;
  agentDbId?: number;
  custodial?: boolean;
};
async function sendCustodialEth(params: AgentEvmSendParams): Promise<`0x${string}`> {
  if (params.agentDbId == null) {
    throw new Error("Missing agent id for custodial EVM send.");
  }
  if (
    params.chainId !== ROBINHOOD_CHAIN_ID &&
    params.chainId !== ETHEREUM_MAINNET_CHAIN_ID
  ) {
    throw new Error("Unsupported network for custodial EVM send.");
  }
  const res = await fetch(`/api/dashboard/agents/${params.agentDbId}/evm-wallet/send-tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId: params.chainId,
      to: params.to,
      value: parseEther(params.amount).toString(),
      expectedAddress: params.evmAddress,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; hash?: string; error?: string };
  if (!res.ok || !data.ok || !data.hash) {
    throw new Error(data.error || "Custodial EVM send failed");
  }
  return data.hash as `0x${string}`;
}
async function agentHasCustodialEvm(agentDbId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/dashboard/agents/${agentDbId}/evm-wallet`);
    if (!res.ok) return false;
    const data = (await res.json()) as { isCustodial?: boolean; provider?: string };
    return Boolean(data.isCustodial || data.provider === "custodial");
  } catch {
    return false;
  }
}
function useAgentEvmSendNoop() {
  return {
    sendEth: useCallback(async (params: AgentEvmSendParams): Promise<`0x${string}`> => {
      if (params.custodial) return sendCustodialEth(params);
      if (params.agentDbId != null && (await agentHasCustodialEvm(params.agentDbId))) {
        return sendCustodialEth({ ...params, custodial: true });
      }
      throw new Error("EVM wallet send is not configured.");
    }, []),
    sending: false,
  };
}
function useAgentEvmSendReal() {
  const { ensureWallet } = useAgentEvmSigner();
  const { sendTransaction } = usePrivySendTransaction();
  const sendEth = useCallback(
    async (params: AgentEvmSendParams): Promise<`0x${string}`> => {
      if (params.custodial) {
        return sendCustodialEth(params);
      }
      // If the UI didn't pass custodial but the agent wallet is server-held, use API.
      if (
        params.agentDbId != null &&
        (await agentHasCustodialEvm(params.agentDbId))
      ) {
        return sendCustodialEth({ ...params, custodial: true });
      }
      const ok = await ensureWallet(params.evmAddress, params.chainId);
      if (!ok) {
        throw new Error(
          "Could not activate the agent wallet on the selected network. Try again.",
        );
      }
      const { hash } = await sendTransaction(
        {
          to: params.to,
          value: parseEther(params.amount),
          chainId: params.chainId,
        },
        { address: params.evmAddress },
      );
      return hash;
    },
    [ensureWallet, sendTransaction],
  );
  return {
    sendEth,
    sending: false,
  };
}
export const useAgentEvmSend: typeof useAgentEvmSendReal = IS_PRIVY_CONFIGURED
  ? useAgentEvmSendReal
  : useAgentEvmSendNoop;
