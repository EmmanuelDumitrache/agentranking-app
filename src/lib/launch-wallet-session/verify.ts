import "server-only";

import { getAddress, verifyMessage } from "viem";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import { LAUNCH_WALLET_NONCE_TTL_MS } from "@/lib/launch-wallet-session/constants";
import { parseLaunchWalletSessionMessage } from "@/lib/launch-wallet-session/messages";
import { normalizeLaunchWallet } from "@/lib/launch-wallet-session/wallet-match";

function isFreshIssuedAt(issuedMs: number, nowMs = Date.now()): boolean {
  return Math.abs(nowMs - issuedMs) <= LAUNCH_WALLET_NONCE_TTL_MS;
}

export async function verifyLaunchWalletSignature(input: {
  chain: LaunchWalletChain;
  wallet: string;
  message: string;
  signature: string;
}): Promise<{ ok: true; wallet: string; nonce: string } | { ok: false; error: string }> {
  const parsed = parseLaunchWalletSessionMessage(input.message);
  if (!parsed) {
    return { ok: false, error: "Invalid launch session message format." };
  }
  if (parsed.chain !== input.chain) {
    return { ok: false, error: "Message chain does not match request." };
  }
  if (!isFreshIssuedAt(parsed.issuedMs)) {
    return { ok: false, error: "Launch session message expired. Try again." };
  }

  const normalized = normalizeLaunchWallet(input.chain, input.wallet);
  if (!normalized) {
    return { ok: false, error: "Invalid wallet address." };
  }
  if (parsed.wallet !== normalized && parsed.wallet.toLowerCase() !== normalized.toLowerCase()) {
    return { ok: false, error: "Message wallet does not match address." };
  }

  if (input.chain === "solana") {
    if (!verifySolanaSignMessage(input.message, input.signature, normalized)) {
      return { ok: false, error: "Signature verification failed." };
    }
    return { ok: true, wallet: normalized, nonce: parsed.nonce };
  }

  try {
    const checksummed = getAddress(input.wallet);
    const valid = await verifyMessage({
      address: checksummed,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    if (!valid) return { ok: false, error: "Signature verification failed." };
    return { ok: true, wallet: checksummed.toLowerCase(), nonce: parsed.nonce };
  } catch {
    return { ok: false, error: "Signature verification failed." };
  }
}
