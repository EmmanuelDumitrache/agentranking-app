"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import {
  connectInjectedWallet,
  InjectedWalletConnectError,
  subscribeInjectedWalletAccount,
} from "@/lib/solana-injected-wallet";
import { showToast } from "@/components/ui/toast-simple";
import { settleWithin } from "@/lib/timing/client-deadline";
const PHANTOM_ADAPTER_NAME = "Phantom";
/**
 * Staking-page Phantom connect — injected connect on user click (same as the internal staking setup tool),
 * then sync @solana/wallet-adapter so Streamflow can sign.
 */
export function useStakingPhantomConnect() {
  const { publicKey, connect, disconnect, connecting, wallet, select, wallets } = useWallet();
  const attemptRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injectedKey, setInjectedKey] = useState<PublicKey | null>(() =>
    typeof window !== "undefined" ? (getSolanaWalletProvider()?.publicKey ?? null) : null,
  );
  useEffect(() => {
    return subscribeInjectedWalletAccount({
      onAccountChange: (pk) => setInjectedKey(pk),
      onDisconnect: () => setInjectedKey(null),
    });
  }, []);
  const activePublicKey = publicKey ?? injectedKey;
  const isBusy = connecting || pending;
  const syncWalletAdapter = useCallback(async () => {
    const name =
      wallet?.adapter.name ??
      wallets.find((w) => w.adapter.name === PHANTOM_ADAPTER_NAME)?.adapter.name ??
      wallets[0]?.adapter.name;
    if (!name) return;
    if (wallet?.adapter.name !== name) {
      await select(name);
    }
    await connect();
  }, [connect, select, wallet?.adapter.name, wallets]);
  const connectPhantom = useCallback(async () => {
    setError(null);
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setPending(true);
    try {
      if (!getSolanaWalletProvider()) {
        const msg = "Phantom extension was not detected. Install Phantom, then refresh this page.";
        setError(msg);
        showToast(msg, "error");
        return;
      }
      // User gesture → open Phantom popup (proven in the internal staking setup tool).
      const { publicKey: pk } = await connectInjectedWallet({ onlyIfTrustedFirst: false });
      if (attemptRef.current !== attempt) return;
      setInjectedKey(pk);
      // Wire wallet-adapter for Streamflow stake signing.
      try {
        await settleWithin(
          syncWalletAdapter(),
          8_000,
          () => new Error("adapter_sync_timeout"),
        );
      } catch {
        // Injected session is live; adapter may catch up on next action.
      }
    } catch (e) {
      if (attemptRef.current !== attempt) return;
      const msg =
        e instanceof InjectedWalletConnectError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not connect Phantom.";
      setError(msg);
      if (e instanceof InjectedWalletConnectError && e.code === "cancelled") {
        showToast("Connection cancelled.", "info");
      } else {
        showToast(msg, "error");
      }
    } finally {
      if (attemptRef.current === attempt) {
        setPending(false);
      }
    }
  }, [syncWalletAdapter]);
  const disconnectPhantom = useCallback(async () => {
    setError(null);
    setInjectedKey(null);
    try {
      await disconnect();
    } catch {
      /* ignore */
    }
    try {
      await getSolanaWalletProvider()?.disconnect();
    } catch {
      /* ignore */
    }
  }, [disconnect]);
  return {
    publicKey: activePublicKey,
    connected: Boolean(activePublicKey),
    adapterReady: Boolean(wallet?.adapter && publicKey),
    connectPhantom,
    disconnectPhantom,
    connecting: isBusy,
    error,
    clearError: () => setError(null),
  };
}
