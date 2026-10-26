"use client";
import bs58 from "bs58";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import type { LaunchWalletSessionState } from "@/lib/launch-wallet-session/types";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import { connectInjectedWallet } from "@/lib/solana-injected-wallet";
export async function fetchLaunchWalletSession(): Promise<LaunchWalletSessionState> {
  const res = await fetch("/api/launch-wallet/session", { cache: "no-store" });
  const data = (await res.json()) as {
    authenticated?: boolean;
    wallet?: string;
    chain?: LaunchWalletChain;
    expiresAt?: string;
  };
  return {
    authenticated: data.authenticated === true,
    wallet: data.wallet ?? null,
    chain: data.chain ?? null,
    expiresAt: data.expiresAt ?? null,
  };
}
async function signSolanaLaunchSession(message: string): Promise<string> {
  const provider = getSolanaWalletProvider();
  if (!provider) {
    throw new Error("Phantom was not detected. Install Phantom and refresh.");
  }
  if (!provider.publicKey) {
    await connectInjectedWallet({ onlyIfTrustedFirst: false });
  }
  const active = getSolanaWalletProvider();
  if (!active?.publicKey) {
    throw new Error("Connect Phantom before signing.");
  }
  const signCapable = active as typeof active & {
    signMessage?: (
      payload: Uint8Array,
      encoding?: string,
    ) => Promise<{ signature: Uint8Array } | Uint8Array>;
  };
  if (typeof signCapable.signMessage !== "function") {
    throw new Error("Wallet does not support signMessage.");
  }
  const encoded = new TextEncoder().encode(message);
  const result = await signCapable.signMessage(encoded, "utf8");
  const sigBytes = result instanceof Uint8Array ? result : result.signature;
  return bs58.encode(sigBytes);
}
async function signEvmLaunchSession(
  wallet: `0x${string}`,
  message: string,
): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No EVM wallet detected.");
  }
  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [message, wallet],
  });
  if (typeof signature !== "string") {
    throw new Error("Wallet did not return a signature.");
  }
  return signature;
}
export type LaunchWalletSessionChallenge = {
  readonly id: string;
  readonly message: string;
};
export async function requestLaunchWalletSessionChallenge(input: {
  chain: LaunchWalletChain;
  wallet: string;
}): Promise<LaunchWalletSessionChallenge> {
  const nonceRes = await fetch("/api/launch-wallet/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain: input.chain, wallet: input.wallet }),
  });
  const nonceData = (await nonceRes.json()) as {
    ok?: boolean;
    id?: string;
    message?: string;
    error?: string;
  };
  if (!nonceRes.ok || !nonceData.id || !nonceData.message) {
    throw new Error(nonceData.error || "Could not start wallet verification.");
  }
  return { id: nonceData.id, message: nonceData.message };
}
export async function verifyLaunchWalletSessionChallenge(input: {
  chain: LaunchWalletChain;
  wallet: string;
  challenge: LaunchWalletSessionChallenge;
  signature: string;
}): Promise<LaunchWalletSessionState> {
  const verifyRes = await fetch("/api/launch-wallet/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: input.challenge.id,
      chain: input.chain,
      wallet: input.wallet,
      message: input.challenge.message,
      signature: input.signature,
    }),
  });
  const verifyData = (await verifyRes.json()) as {
    ok?: boolean;
    wallet?: string;
    chain?: LaunchWalletChain;
    expiresAt?: string;
    error?: string;
  };
  if (!verifyRes.ok || !verifyData.ok) {
    throw new Error(verifyData.error || "Wallet verification failed.");
  }
  return {
    authenticated: true,
    wallet: verifyData.wallet ?? input.wallet,
    chain: verifyData.chain ?? input.chain,
    expiresAt: verifyData.expiresAt ?? null,
  };
}
export async function establishLaunchWalletSessionWithSigner(input: {
  chain: LaunchWalletChain;
  wallet: string;
  signMessage: (message: string) => Promise<string>;
}): Promise<LaunchWalletSessionState> {
  const challenge = await requestLaunchWalletSessionChallenge(input);
  const signature = await input.signMessage(challenge.message);
  return verifyLaunchWalletSessionChallenge({ ...input, challenge, signature });
}
export async function establishLaunchWalletSession(input: {
  chain: LaunchWalletChain;
  wallet: string;
}): Promise<LaunchWalletSessionState> {
  return establishLaunchWalletSessionWithSigner({
    ...input,
    signMessage: (message) =>
      input.chain === "solana"
        ? signSolanaLaunchSession(message)
        : signEvmLaunchSession(input.wallet as `0x${string}`, message),
  });
}
export async function logoutLaunchWalletSession(): Promise<void> {
  await fetch("/api/launch-wallet/logout", { method: "POST" });
}
