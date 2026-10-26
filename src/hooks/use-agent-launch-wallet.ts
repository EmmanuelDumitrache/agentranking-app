"use client";
import { useCallback, useEffect, useState } from "react";
import type { WalletNetworkHint } from "@/lib/agent-launch/wallet-client";
import {
  connectAgentLaunchWallet,
  detectWalletNetworkHint,
  disconnectAgentLaunchWallet,
  getConnectedWalletAddress,
  isPhantomAvailable,
  subscribeInjectedWalletAccount,
} from "@/lib/agent-launch/wallet-client";
export type AgentLaunchWalletState = {
  connected: boolean;
  address: string | null;
  networkHint: WalletNetworkHint;
  phantomAvailable: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshNetworkHint: () => Promise<void>;
};
export function useAgentLaunchWallet(): AgentLaunchWalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [networkHint, setNetworkHint] = useState<WalletNetworkHint>("unknown");
  const [phantomAvailable, setPhantomAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshNetworkHint = useCallback(async () => {
    const hint = await detectWalletNetworkHint();
    setNetworkHint(hint);
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeInjectedWalletAccount({
      onAccountChange: (publicKey) => {
        setPhantomAvailable(isPhantomAvailable());
        setAddress(publicKey?.toBase58() ?? getConnectedWalletAddress());
        void refreshNetworkHint().catch(() => setNetworkHint("unknown"));
      },
      onDisconnect: () => {
        setAddress(null);
        setNetworkHint("unknown");
      },
    });
    return unsubscribe;
  }, [refreshNetworkHint]);
  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { publicKey } = await connectAgentLaunchWallet();
      setAddress(publicKey.toBase58());
      await refreshNetworkHint();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection failed");
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [refreshNetworkHint]);
  const disconnect = useCallback(async () => {
    setError(null);
    await disconnectAgentLaunchWallet();
    setAddress(null);
    setNetworkHint("unknown");
  }, []);
  return {
    connected: Boolean(address),
    address,
    networkHint,
    phantomAvailable,
    connecting,
    error,
    connect,
    disconnect,
    refreshNetworkHint,
  };
}
