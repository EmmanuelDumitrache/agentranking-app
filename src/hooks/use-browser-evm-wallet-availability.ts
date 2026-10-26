"use client";

import { useSyncExternalStore } from "react";
import { hasBrowserEvmWallet } from "@/lib/wallet-wagmi-config";

function subscribe(onStoreChange: () => void): () => void {
  globalThis.window.addEventListener("ethereum#initialized", onStoreChange);
  globalThis.window.addEventListener("focus", onStoreChange);
  return () => {
    globalThis.window.removeEventListener("ethereum#initialized", onStoreChange);
    globalThis.window.removeEventListener("focus", onStoreChange);
  };
}

export function useBrowserEvmWalletAvailability(): boolean {
  return useSyncExternalStore(subscribe, hasBrowserEvmWallet, () => false);
}
