import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { PublicKey } from "@solana/web3.js";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { buildAgentPassportFromLaunch } from "@/lib/agent-launch/passport";
import {
  findRecentMintCreationSignature,
  pumpBondingCurveExists,
} from "@/lib/agent-launch/pump-onchain";
import { assertAgentLaunchChainConfig, getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { fetchTransactionWithRetry } from "@/lib/agent-launch/tx-poll";
import { verifyCreationTransaction } from "@/lib/agent-launch/tx-verify";
import { parseSolanaPubkey } from "@/lib/agent-launch/validation";
import { prisma } from "@/lib/db";
export type ConfirmCreateResult = {
  launch: AgentLaunch;
  signature: string;
  recovered: boolean;
};
/** Mint proposed at metadata time (before DB `mint` column is set). */
export { resolveProposedMintFromLaunch } from "@/lib/agent-launch/launch-mint-resolve";
async function persistTokenCreatedLaunch(input: {
  launch: AgentLaunch;
  launchId: string;
  mint: PublicKey;
  creatorWallet: PublicKey;
  signature: string;
  treasury: string;
  creationFeeLamports: bigint;
  recovered: boolean;
  transferredLamports: bigint;
}): Promise<AgentLaunch> {
  const updated = await prisma.agentLaunch.update({
    where: { id: input.launchId },
    data: {
      mint: input.mint.toBase58(),
      creatorWallet: input.creatorWallet.toBase58(),
      creationTx: input.signature,
      launchStatus: "token_created",
      feeSharingStatus: "pending",
      arTreasuryWallet: input.treasury,
      creationFeeLamports: input.creationFeeLamports,
      passportJson: buildAgentPassportFromLaunch({
        ...input.launch,
        mint: input.mint.toBase58(),
        creatorWallet: input.creatorWallet.toBase58(),
        creationTx: input.signature,
        launchStatus: "token_created",
        feeSharingStatus: "pending",
        arTreasuryWallet: input.treasury,
        creationFeeLamports: input.creationFeeLamports,
      }) as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAgentLaunchEvent({
    launchId: input.launchId,
    type: input.recovered ? "creation_recovered" : "creation_confirmed",
    txSignature: input.signature,
    payloadJson: {
      mint: input.mint.toBase58(),
      recovered: input.recovered,
      transferredLamports: input.transferredLamports.toString(),
    },
  });
  return updated;
}
async function resolveCreationSignature(
  mint: PublicKey,
  preferredSignature?: string,
): Promise<string | null> {
  const connection = getAgentLaunchConnection();
  if (preferredSignature?.trim()) {
    const statuses = await connection.getSignatureStatuses([preferredSignature]);
    const status = statuses.value[0];
    if (!status?.err) {
      return preferredSignature;
    }
  }
  return findRecentMintCreationSignature(mint);
}
/**
 * Confirm create tx on-chain, or recover when RPC lag hid the tx but Pump bonding curve exists.
 */
export async function confirmOrRecoverTokenCreate(input: {
  launch: AgentLaunch;
  launchId: string;
  signature: string;
  mint: PublicKey;
  creatorWallet: PublicKey;
}): Promise<ConfirmCreateResult> {
  const config = getAgentLaunchConfig();
  const { treasury } = assertAgentLaunchChainConfig();
  const treasuryPk = parseSolanaPubkey(treasury, "Treasury");
  if (
    input.launch.launchStatus === "token_created" ||
    input.launch.launchStatus === "fee_share_pending" ||
    input.launch.launchStatus === "indexed"
  ) {
    return {
      launch: input.launch,
      signature: input.launch.creationTx ?? input.signature,
      recovered: false,
    };
  }
  const verification = await verifyCreationTransaction({
    signature: input.signature,
    expectedCreator: input.creatorWallet,
    expectedTreasury: treasuryPk,
    minimumFeeLamports: config.creationFeeLamports,
    expectedMint: input.mint,
  });
  if (verification.ok) {
    const curveExists = await pumpBondingCurveExists(input.mint);
    if (!curveExists) {
      throw new Error(
        "Creation fee verified but Pump bonding curve not found — Pump create_v2 did not land. Do not mark token as created.",
      );
    }
    const launch = await persistTokenCreatedLaunch({
      launch: input.launch,
      launchId: input.launchId,
      mint: input.mint,
      creatorWallet: input.creatorWallet,
      signature: input.signature,
      treasury,
      creationFeeLamports: config.creationFeeLamports,
      recovered: false,
      transferredLamports: verification.transferredLamports,
    });
    return { launch, signature: input.signature, recovered: false };
  }
  const curveExists = await pumpBondingCurveExists(input.mint);
  if (!curveExists) {
    throw new Error(verification.reason ?? "Creation transaction verification failed");
  }
  const connection = getAgentLaunchConnection();
  const indexedTx = await fetchTransactionWithRetry(connection, input.signature, {
    attempts: 25,
    delayMs: 2_500,
  });
  if (indexedTx) {
    const retryVerification = await verifyCreationTransaction({
      signature: input.signature,
      expectedCreator: input.creatorWallet,
      expectedTreasury: treasuryPk,
      minimumFeeLamports: config.creationFeeLamports,
      expectedMint: input.mint,
    });
    if (retryVerification.ok) {
      const launch = await persistTokenCreatedLaunch({
        launch: input.launch,
        launchId: input.launchId,
        mint: input.mint,
        creatorWallet: input.creatorWallet,
        signature: input.signature,
        treasury,
        creationFeeLamports: config.creationFeeLamports,
        recovered: true,
        transferredLamports: retryVerification.transferredLamports,
      });
      return { launch, signature: input.signature, recovered: true };
    }
  }
  const recoverySignature = await resolveCreationSignature(input.mint, input.signature);
  if (!recoverySignature) {
    throw new Error(
      "Token exists on Pump.fun but creation transaction could not be verified yet. Wait a minute and use Recover launch, or contact support with your mint address.",
    );
  }
  const launch = await persistTokenCreatedLaunch({
    launch: input.launch,
    launchId: input.launchId,
    mint: input.mint,
    creatorWallet: input.creatorWallet,
    signature: recoverySignature,
    treasury,
    creationFeeLamports: config.creationFeeLamports,
    recovered: true,
    transferredLamports: verification.transferredLamports,
  });
  return { launch, signature: recoverySignature, recovered: true };
}
/** Recover a draft launch when create_v2 already landed (no new create tx). */
export async function recoverTokenCreateFromChain(input: {
  launch: AgentLaunch;
  launchId: string;
  mint: PublicKey;
  creatorWallet: PublicKey;
  signature?: string | null;
}): Promise<ConfirmCreateResult | null> {
  if (
    input.launch.launchStatus === "token_created" ||
    input.launch.launchStatus === "fee_share_pending" ||
    input.launch.launchStatus === "indexed"
  ) {
    return {
      launch: input.launch,
      signature: input.launch.creationTx ?? input.signature ?? "",
      recovered: false,
    };
  }
  if (input.launch.launchStatus !== "draft") {
    return null;
  }
  if (!(await pumpBondingCurveExists(input.mint))) {
    return null;
  }
  const signature = await resolveCreationSignature(input.mint, input.signature ?? undefined);
  if (!signature) {
    throw new Error(
      "Token exists on Pump.fun but the creation transaction signature is not indexed yet. Wait ~1 minute and try again.",
    );
  }
  const config = getAgentLaunchConfig();
  const { treasury } = assertAgentLaunchChainConfig();
  const launch = await persistTokenCreatedLaunch({
    launch: input.launch,
    launchId: input.launchId,
    mint: input.mint,
    creatorWallet: input.creatorWallet,
    signature,
    treasury,
    creationFeeLamports: config.creationFeeLamports,
    recovered: true,
    transferredLamports: BigInt(0),
  });
  return { launch, signature, recovered: true };
}
