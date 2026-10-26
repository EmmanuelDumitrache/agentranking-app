import type { AgentLaunch } from "@/generated/prisma/client";
import type { PublicKey } from "@solana/web3.js";
import { trySolanaPublicKey } from "@/lib/ar-token-ledger";
/** Mint proposed at metadata time (before DB `mint` column is set). */
export function resolveProposedMintFromLaunch(
  launch: AgentLaunch,
  explicitMint?: string | null,
): PublicKey | null {
  const direct = explicitMint?.trim() || launch.mint?.trim();
  if (direct) {
    return trySolanaPublicKey(direct);
  }
  const metadata = launch.metadataJson as { external_url?: string; website?: string } | null;
  for (const url of [metadata?.external_url, metadata?.website]) {
    if (!url?.trim()) continue;
    const match = /\/tokens\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:[/?#]|$)/.exec(url.trim());
    if (match?.[1]) {
      const fromUrl = trySolanaPublicKey(match[1]);
      if (fromUrl) return fromUrl;
    }
  }
  return null;
}