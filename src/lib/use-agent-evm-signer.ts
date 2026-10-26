"use client";
/**
 * Hook that ensures a specific EVM wallet address is the active signer
 * on the requested chain in Privy/wagmi.
 */
import { useCallback, useEffect, useRef } from "react";
import { useWallets as _useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet as _useSetActiveWallet } from "@privy-io/wagmi";
import { useConfig as _useConfig, useSwitchChain as _useSwitchChain } from "wagmi";
import { getAccount, getChainId } from "wagmi/actions";
const IS_PRIVY_CONFIGURED =
  typeof globalThis.window !== "undefined" &&
  Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
type EthereumPrivyWallet = {
  type: string;
  address?: string;
  switchChain?: (targetChainId: number) => Promise<void>;
};
/* ── No-op implementation ─────────────────────────────────────────── */
function useAgentEvmSignerNoop() {
  return {
    ensureWallet: useCallback(
      async (): Promise<boolean> => false,
      [],
    ),
  };
}
/* ── Real implementation ──────────────────────────────────────────── */
function waitForWalletStateDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (completed: boolean) => {
      if (timer !== null) globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      timer = null;
      resolve(completed);
    };
    const onAbort = () => finish(false);
    timer = globalThis.setTimeout(() => finish(true), Math.max(1, ms));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function useAgentEvmSignerReal() {
  const { wallets } = _useWallets();
  const { setActiveWallet } = _useSetActiveWallet();
  const { switchChainAsync } = _useSwitchChain();
  const wagmiConfig = _useConfig();
  const walletsRef = useRef(wallets);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);
  useEffect(() => () => {
    requestRef.current?.abort("agent-evm-signer-unmounted");
    requestRef.current = null;
  }, []);
  const ensureWallet = useCallback(
    async (evmAddress: string, chainId?: number): Promise<boolean> => {
      requestRef.current?.abort("agent-evm-signer-superseded");
      const request = new AbortController();
      requestRef.current = request;
      try {
        const normalized = evmAddress.toLowerCase();
        const target = walletsRef.current.find(
          (wallet) =>
            wallet.type === "ethereum" &&
            wallet.address?.toLowerCase() === normalized,
        ) as EthereumPrivyWallet | undefined;
        if (!target) {
          console.warn(
            "[AgentEvmSigner] Agent EVM wallet not found in Privy wallet list.",
          );
          return false;
        }
        try {
          await setActiveWallet(target as Parameters<typeof setActiveWallet>[0]);
        } catch (error) {
          console.warn("[AgentEvmSigner] setActiveWallet failed:", error);
          return false;
        }
        if (request.signal.aborted) return false;
        if (chainId != null) {
          try {
            if (typeof target.switchChain === "function") {
              await target.switchChain(chainId);
            }
          } catch (error) {
              console.warn("[AgentEvmSigner] Privy switchChain failed:", error);
            return false;
          }
          if (request.signal.aborted) return false;
          try {
            await switchChainAsync({ chainId });
          } catch {
            // wagmi switch can noop when Privy already switched — verify chain below
          }
        }
        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline && !request.signal.aborted) {
          if (!(await waitForWalletStateDelay(150, request.signal))) return false;
          const account = getAccount(wagmiConfig);
          const connected =
            account.isConnected &&
            account.address?.toLowerCase() === normalized;
          const chainOk = chainId == null || getChainId(wagmiConfig) === chainId;
          if (connected && chainOk) return true;
        }
        if (!request.signal.aborted) {
          console.warn(
            "[AgentEvmSigner] Timeout waiting for wallet/chain sync.",
            chainId != null ? { expectedChainId: chainId } : undefined,
          );
        }
        return false;
      } finally {
        if (requestRef.current === request) requestRef.current = null;
      }
    },
    [setActiveWallet, switchChainAsync, wagmiConfig],
  );
  return { ensureWallet };
}
export const useAgentEvmSigner: typeof useAgentEvmSignerReal = IS_PRIVY_CONFIGURED
  ? useAgentEvmSignerReal
  : useAgentEvmSignerNoop;
