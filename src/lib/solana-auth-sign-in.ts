"use client";

import { signIn } from "next-auth/react";
import bs58 from "bs58";

import type { SolanaInjectedProvider } from "@/lib/ar-token-ledger";
import {
  connectInjectedWallet,
  InjectedWalletConnectError,
} from "@/lib/solana-injected-wallet";

export const SOLANA_SIGN_IN_PREFIX = "AgentRanking sign-in\n\nWallet: ";

export function buildSolanaSignInMessage(wallet: string, issuedAtIso?: string): string {
  const issued = issuedAtIso ?? new Date().toISOString();
  return `${SOLANA_SIGN_IN_PREFIX}${wallet.trim()}\nIssued At: ${issued}`;
}

export function parseSolanaSignInMessage(message: string): { wallet: string; issuedMs: number } | null {
  if (!message.startsWith(SOLANA_SIGN_IN_PREFIX)) return null;
  const issuedMatch = message.match(/Issued At:\s*(.+)/i);
  if (!issuedMatch) return null;
  const wallet = message.slice(SOLANA_SIGN_IN_PREFIX.length, message.indexOf("\nIssued At:")).trim();
  const issuedMs = Date.parse(issuedMatch[1].trim());
  if (!wallet || !Number.isFinite(issuedMs)) return null;
  return { wallet, issuedMs };
}

export type SignInWithPhantomResult =
  | { ok: true }
  | { ok: false; error: string; cancelled?: boolean };

/** Solana injector only — never `window.ethereum` (avoids Phantom "Unsupported account"). */
function getPhantomSolanaProvider(): SolanaInjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    solana?: SolanaInjectedProvider;
    phantom?: { solana?: SolanaInjectedProvider };
  };
  return w.solana ?? w.phantom?.solana;
}

/**
 * Connect Phantom (if needed), sign SIWS message, create NextAuth session via `solana` provider.
 */
export async function signInWithPhantom(opts?: {
  callbackUrl?: string;
  /** Skip connect popup when provider already has publicKey */
  onlyIfTrusted?: boolean;
}): Promise<SignInWithPhantomResult> {
  try {
    const provider = getPhantomSolanaProvider();
    if (!provider) {
      return {
        ok: false,
        error:
          "Phantom extension was not detected. Install Phantom, switch to your Solana account, and refresh.",
      };
    }

    let publicKeyB58: string;
    if (provider.publicKey && opts?.onlyIfTrusted) {
      publicKeyB58 = provider.publicKey.toBase58();
    } else {
      const { publicKey } = await connectInjectedWallet({
        onlyIfTrustedFirst: opts?.onlyIfTrusted ?? false,
      });
      publicKeyB58 = publicKey.toBase58();
    }

    const message = buildSolanaSignInMessage(publicKeyB58);
    const signCapable = provider as typeof provider & {
      signMessage?: (
        message: Uint8Array,
        encoding?: string,
      ) => Promise<{ signature: Uint8Array } | Uint8Array>;
    };
    if (typeof signCapable.signMessage !== "function") {
      return { ok: false, error: "Phantom did not expose signMessage." };
    }

    const encoded = new TextEncoder().encode(message);
    const result = await signCapable.signMessage(encoded, "utf8");
    const sigBytes = result instanceof Uint8Array ? result : result.signature;
    const signature = bs58.encode(sigBytes);

    const callbackUrl =
      opts?.callbackUrl ?? (typeof window !== "undefined" ? window.location.href : "/");

    // Force same-origin credentials callback so apex/app host mismatch in
    // NEXTAUTH_URL cannot redirect the browser cross-origin mid sign-in.
    const signInResult = await signIn("solana", {
      publicKey: publicKeyB58,
      message,
      signature,
      redirect: false,
      callbackUrl,
    });

    if (signInResult?.error) {
      return { ok: false, error: "Solana sign-in was rejected. Try again or contact support." };
    }
    if (!signInResult?.ok) {
      return { ok: false, error: "Could not complete sign-in." };
    }

    return { ok: true };
  } catch (e) {
    if (e instanceof InjectedWalletConnectError && e.code === "cancelled") {
      return { ok: false, error: "Signature cancelled.", cancelled: true };
    }
    const raw = e instanceof Error ? e.message : "Phantom sign-in failed.";
    // Webpack/chunk mismatches after surgical deploys often surface as `.call` TypeErrors.
    if (/reading ['"]?call['"]?/i.test(raw) || /undefined \(reading/i.test(raw)) {
      return {
        ok: false,
        error:
          "Wallet sign-in hit a stale app bundle. Hard-refresh (Cmd+Shift+R) and try Continue with Phantom again.",
      };
    }
    return {
      ok: false,
      error: raw,
    };
  }
}

/** Sync Solana wallet to dashboard profile after session exists. */
export async function syncSolanaWalletToProfile(wallet: string): Promise<void> {
  const w = wallet.trim();
  if (!w) return;
  try {
    await fetch("/api/dashboard/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: w }),
    });
  } catch {
    /* non-blocking */
  }
}
