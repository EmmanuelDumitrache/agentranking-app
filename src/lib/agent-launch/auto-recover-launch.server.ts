import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import { PublicKey } from "@solana/web3.js";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { recoverTokenCreateFromChain } from "@/lib/agent-launch/launch-create-confirm.server";
import { resolveProposedMintFromLaunch } from "@/lib/agent-launch/launch-mint-resolve";
import {
  discoverPumpMintCreatedByWallet,
  pumpBondingCurveExists,
} from "@/lib/agent-launch/pump-onchain";
import { loadAgentCustodialWalletPublicKey } from "@/lib/custodial-wallet/read";
export type AutoRecoverLaunchResult = {
  launch: AgentLaunch;
  recovered: boolean;
  mint?: string;
  signature?: string;
};
async function resolveCreatorWalletForLaunch(
  launch: AgentLaunch,
  creatorWalletHint?: string | null,
): Promise<PublicKey | null> {
  const direct = creatorWalletHint?.trim() || launch.creatorWallet?.trim();
  if (direct) {
    try {
      return new PublicKey(direct);
    } catch {
      return null;
    }
  }
  const agentDbId = resolveLaunchAgentDbId(launch);
  if (!agentDbId) return null;
  const wallet = await loadAgentCustodialWalletPublicKey(agentDbId);
  if (!wallet) return null;
  try {
    return new PublicKey(wallet);
  } catch {
    return null;
  }
}
async function discoverMintForStuckLaunch(
  launch: AgentLaunch,
  creator: PublicKey,
): Promise<{ mint: PublicKey; signature?: string } | null> {
  const proposed = resolveProposedMintFromLaunch(launch);
  if (proposed && (await pumpBondingCurveExists(proposed))) {
    return { mint: proposed };
  }
  const notBeforeUnix = Math.floor(launch.createdAt.getTime() / 1000) - 10 * 60;
  const discovered = await discoverPumpMintCreatedByWallet(creator, notBeforeUnix);
  if (!discovered) return null;
  return { mint: discovered.mint, signature: discovered.signature };
}
/**
 * If a draft launch already created its Pump token on-chain, sync DB state without a new create tx.
 */
export async function autoRecoverStuckAgentLaunch(
  launch: AgentLaunch,
  creatorWalletHint?: string | null,
): Promise<AutoRecoverLaunchResult> {
  if (
    launch.launchStatus === "token_created" ||
    launch.launchStatus === "fee_share_pending" ||
    launch.launchStatus === "indexed"
  ) {
    return { launch, recovered: false };
  }
  if (launch.launchStatus !== "draft") {
    return { launch, recovered: false };
  }
  const creator = await resolveCreatorWalletForLaunch(launch, creatorWalletHint);
  if (!creator) {
    return { launch, recovered: false };
  }
  let discovered: { mint: PublicKey; signature?: string } | null = null;
  try {
    discovered = await discoverMintForStuckLaunch(launch, creator);
  } catch (error) {
    console.warn(
      "[agent-launch] auto-recover RPC failed; continuing with draft",
      error instanceof Error ? error.message : error,
    );
    return { launch, recovered: false };
  }
  if (!discovered) {
    return { launch, recovered: false };
  }
  const result = await recoverTokenCreateFromChain({
    launch,
    launchId: launch.id,
    mint: discovered.mint,
    creatorWallet: creator,
    signature: discovered.signature ?? null,
  });
  if (!result) {
    return { launch, recovered: false };
  }
  return {
    launch: result.launch,
    recovered: result.recovered,
    mint: discovered.mint.toBase58(),
    signature: result.signature,
  };
}