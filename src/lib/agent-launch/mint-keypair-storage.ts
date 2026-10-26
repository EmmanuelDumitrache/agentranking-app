"use client";
import { Keypair } from "@solana/web3.js";
import {
  exportMintSecretKeyBase58,
  importMintSecretKeyBase58,
} from "@/lib/agent-launch/wallet-client";
const STORAGE_PREFIX = "ar-launch-mint:";
export function persistMintKeypairForLaunch(launchId: string, keypair: Keypair): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      `${STORAGE_PREFIX}${launchId}`,
      exportMintSecretKeyBase58(keypair),
    );
  } catch {
    // Quota or private mode — launch can still proceed with in-memory keypair.
  }
}
export function loadMintKeypairForLaunch(launchId: string): Keypair | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const encoded = sessionStorage.getItem(`${STORAGE_PREFIX}${launchId}`);
    if (!encoded) return null;
    return Keypair.fromSecretKey(importMintSecretKeyBase58(encoded));
  } catch {
    return null;
  }
}
export function clearMintKeypairForLaunch(launchId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${launchId}`);
  } catch {
    // ignore
  }
}