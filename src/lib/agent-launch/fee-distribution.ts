import "server-only";
import bs58 from "bs58";
import {
  coinCreatorVaultAtaPda,
  coinCreatorVaultAuthorityPda,
} from "@pump-fun/pump-swap-sdk";
import {
  feeSharingConfigPda,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type {
  AgentLaunch,
  AgentLaunchFeeDistribution,
  AgentLaunchFeeDistributionAttempt,
} from "@/generated/prisma/client";
import { getAgentLaunchWorkerConfig } from "@/lib/agent-launch/config-worker.server";
import {
  decideFeeDistributionReconciliation,
  isRetryableFeeDistributionFailure,
  splitFeeDistributionAmounts,
} from "@/lib/agent-launch/fee-distribution-state";
import {
  recordAgentLaunchEvent,
  recordAgentLaunchEventInTx,
} from "@/lib/agent-launch/events";
import { getAgentLaunchConnection, getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { prisma } from "@/lib/db";
import { enqueueApplicationJob, enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { buildFeeDistributionFeedEvent } from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
const ACTIVE_ATTEMPT_STATUSES = ["prepared", "submitted"] as const;
type ActiveAttemptStatus = (typeof ACTIVE_ATTEMPT_STATUSES)[number];
export type DistributionRunMode = "standard" | "recovery";
type ReconcileResult =
  | { kind: "complete"; result: DistributionRunResult }
  | { kind: "prepare_new" };
class RecordedDistributionFailure extends Error {}
export type DistributionRunResult =
  | {
      status: "pending";
      attemptId: string;
      txSignature: string;
      mint: string;
    }
  | {
      status: "distributed";
      txSignature: string;
      mint: string;
      totalAmount: string;
      creatorAmount: string;
      arAmount: string;
      note: string;
    }
  | {
      status: "skipped";
      reason: string;
      mint: string;
    }
  | {
      status: "failed";
      reason: string;
      mint: string;
      retryable: boolean;
    };
export function loadFeeBotKeypair(): Keypair {
  const { feeBotPrivateKey } = getAgentLaunchWorkerConfig();
  if (!feeBotPrivateKey) {
    throw new Error("AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY is not configured");
  }
  try {
    if (feeBotPrivateKey.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(feeBotPrivateKey)));
    }
    return Keypair.fromSecretKey(bs58.decode(feeBotPrivateKey));
  } catch {
    throw new Error("Invalid AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY format");
  }
}
async function buildDistributionInstructions(
  mint: PublicKey,
  payer: PublicKey,
): Promise<{
  instructions: TransactionInstruction[];
  distributableLamports: bigint;
  canDistribute: boolean;
  isGraduated: boolean;
}> {
  const connection = getAgentLaunchConnection();
  const onlineSdk = new OnlinePumpSdk(connection);
  const minFee = await onlineSdk.getMinimumDistributableFee(mint, payer);
  const distributableLamports = BigInt(minFee.distributableFees.toString());
  if (!minFee.canDistribute) {
    return {
      instructions: [],
      distributableLamports,
      canDistribute: false,
      isGraduated: minFee.isGraduated,
    };
  }
  const sharingConfigPubkey = feeSharingConfigPda(mint);
  const sharingConfigInfo = await connection.getAccountInfo(sharingConfigPubkey);
  if (!sharingConfigInfo) {
    throw new Error(`Sharing config not found for mint ${mint.toBase58()}`);
  }
  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigInfo);
  const instructions: TransactionInstruction[] = [];
  if (minFee.isGraduated) {
    const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(sharingConfigPubkey);
    const ammVaultAta = coinCreatorVaultAtaPda(
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    );
    const ammVaultAtaInfo = await connection.getAccountInfo(ammVaultAta);
    if (ammVaultAtaInfo) {
      instructions.push(
        await PUMP_SDK.transferCreatorFeesToPumpV2({
          payer,
          mint,
          quoteMint: NATIVE_MINT,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
        }),
      );
    }
  }
  instructions.push(
    await PUMP_SDK.distributeCreatorFeesV2({
      mint,
      sharingConfig,
      sharingConfigAddress: sharingConfigPubkey,
      quoteMint: NATIVE_MINT,
      payer,
      shouldInitializeAta: true,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
  );
  return {
    instructions,
    distributableLamports,
    canDistribute: true,
    isGraduated: minFee.isGraduated,
  };
}
function isActiveAttemptStatus(status: string): status is ActiveAttemptStatus {
  return ACTIVE_ATTEMPT_STATUSES.includes(status as ActiveAttemptStatus);
}
async function findActiveAttempt(
  launchId: string,
): Promise<AgentLaunchFeeDistributionAttempt | null> {
  return prisma.agentLaunchFeeDistributionAttempt.findFirst({
    where: { launchId, status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}
function distributedResult(
  distribution: AgentLaunchFeeDistribution,
): DistributionRunResult {
  return {
    status: "distributed",
    txSignature: distribution.txSignature,
    mint: distribution.mint,
    totalAmount: distribution.totalAmount.toString(),
    creatorAmount: distribution.creatorAmount.toString(),
    arAmount: distribution.arAmount.toString(),
    note: "Amounts are the persisted Pump distributable estimate and configured fee split.",
  };
}
function pendingResult(
  attempt: AgentLaunchFeeDistributionAttempt,
): DistributionRunResult {
  return {
    status: "pending",
    attemptId: attempt.id,
    txSignature: attempt.txSignature,
    mint: attempt.mint,
  };
}
async function promoteAttemptToRecovery(
  attempt: AgentLaunchFeeDistributionAttempt,
): Promise<AgentLaunchFeeDistributionAttempt> {
  if (attempt.mode === "recovery") return attempt;
  return prisma.agentLaunchFeeDistributionAttempt.update({
    where: { id: attempt.id },
    data: { mode: "recovery" },
  });
}
async function enqueueAttemptReconciliation(
  attempt: AgentLaunchFeeDistributionAttempt,
): Promise<string | null> {
  return enqueueApplicationJob(
    JOB_QUEUES.LAUNCH_FEE_RECONCILE,
    { v: 1, attemptId: attempt.id },
    { singletonKey: attempt.id },
  );
}
async function markAttemptFailed(
  attempt: AgentLaunchFeeDistributionAttempt,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.agentLaunchFeeDistributionAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
      },
      data: { status: "failed", lastError: reason },
    });
    if (changed.count === 0) return;
    await recordAgentLaunchEventInTx(tx, {
      launchId: attempt.launchId,
      type: "distribution_failed",
      txSignature: attempt.txSignature,
      payloadJson: {
        attemptId: attempt.id,
        mint: attempt.mint,
        reason,
      },
    });
  });
}
async function noteAttemptError(
  attemptId: string,
  reason: string,
): Promise<void> {
  await prisma.agentLaunchFeeDistributionAttempt.updateMany({
    where: {
      id: attemptId,
      status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
    },
    data: { lastError: reason },
  });
}
async function finalizeConfirmedAttempt(
  launch: AgentLaunch,
  attempt: AgentLaunchFeeDistributionAttempt,
): Promise<DistributionRunResult> {
  const result = await prisma.$transaction(async (tx) => {
    const insert = await tx.agentLaunchFeeDistribution.createMany({
      data: [
        {
          launchId: launch.id,
          network: attempt.network,
          mint: attempt.mint,
          txSignature: attempt.txSignature,
          quoteSymbol: attempt.quoteSymbol,
          totalAmount: attempt.totalAmount,
          creatorAmount: attempt.creatorAmount,
          arAmount: attempt.arAmount,
          payloadJson: {
            attemptId: attempt.id,
            recentBlockhash: attempt.recentBlockhash,
            lastValidBlockHeight: attempt.lastValidBlockHeight.toString(),
            accountingSource: "pump_distributable_estimate",
          },
        },
      ],
      skipDuplicates: true,
    });
    if (insert.count === 1) {
      await tx.agentLaunch.update({
        where: { id: launch.id },
        data: {
          totalFeesDistributedLamports: { increment: attempt.totalAmount },
          totalCreatorFeesLamports: { increment: attempt.creatorAmount },
          totalArFeesLamports: { increment: attempt.arAmount },
          lastDistributionAt: new Date(),
        },
      });
      await recordAgentLaunchEventInTx(tx, {
        launchId: launch.id,
        type: "distribution_succeeded",
        txSignature: attempt.txSignature,
        payloadJson: {
          attemptId: attempt.id,
          mint: attempt.mint,
          totalAmount: attempt.totalAmount.toString(),
          creatorAmount: attempt.creatorAmount.toString(),
          arAmount: attempt.arAmount.toString(),
        },
      });
    }
    await tx.agentLaunchFeeDistributionAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "confirmed",
        confirmedAt: new Date(),
        lastError: null,
      },
    });
    const distribution = await tx.agentLaunchFeeDistribution.findUniqueOrThrow({
      where: { txSignature: attempt.txSignature },
    });
    if (distribution.launchId !== launch.id) {
      throw new Error(
        `Distribution signature ${attempt.txSignature} belongs to launch ${distribution.launchId}`,
      );
    }
    return { distribution, inserted: insert.count === 1 };
  });
  if (result.inserted) {
    publishArLiveFeedEvent(
      buildFeeDistributionFeedEvent({
        distributionId: result.distribution.id,
        mint: launch.mint!,
        creatorAmountLamports: result.distribution.creatorAmount,
        tokenSymbol: launch.tokenSymbol,
        tokenName: launch.profileDisplayName ?? launch.tokenName,
        createdAt: result.distribution.createdAt,
      }),
    );
  }
  return distributedResult(result.distribution);
}
async function reconcileAttempt(
  launch: AgentLaunch,
  attempt: AgentLaunchFeeDistributionAttempt,
): Promise<ReconcileResult> {
  if (attempt.network !== launch.network || attempt.mint !== launch.mint) {
    throw new Error(
      `Distribution attempt ${attempt.id} no longer matches launch network/mint`,
    );
  }
  const connection = getAgentLaunchConnection();
  const existingDistribution = await prisma.agentLaunchFeeDistribution.findUnique({
    where: { txSignature: attempt.txSignature },
  });
  if (existingDistribution) {
    if (existingDistribution.launchId !== launch.id) {
      throw new Error(
        `Distribution signature ${attempt.txSignature} belongs to launch ${existingDistribution.launchId}`,
      );
    }
    await prisma.agentLaunchFeeDistributionAttempt.updateMany({
      where: { id: attempt.id, status: { not: "confirmed" } },
      data: { status: "confirmed", confirmedAt: new Date(), lastError: null },
    });
    return { kind: "complete", result: distributedResult(existingDistribution) };
  }
  const statusResponse = await connection.getSignatureStatuses(
    [attempt.txSignature],
    { searchTransactionHistory: true },
  );
  const signatureStatus = statusResponse.value[0] ?? null;
  const currentBlockHeight = BigInt(await connection.getBlockHeight("confirmed"));
  const decision = decideFeeDistributionReconciliation({
    signatureSeen: signatureStatus !== null,
    confirmationStatus: signatureStatus?.confirmationStatus ?? null,
    hasError: Boolean(signatureStatus?.err),
    currentBlockHeight,
    lastValidBlockHeight: attempt.lastValidBlockHeight,
  });
  if (decision === "fail_on_chain") {
    const reason = `on_chain_transaction_error:${JSON.stringify(signatureStatus?.err)}`;
    await markAttemptFailed(attempt, reason);
    throw new RecordedDistributionFailure(reason);
  }
  if (decision === "finalize") {
    return {
      kind: "complete",
      result: await finalizeConfirmedAttempt(launch, attempt),
    };
  }
  if (decision === "prepare_new") {
    await markAttemptFailed(attempt, "blockhash_expired_without_confirmation");
    return { kind: "prepare_new" };
  }
  try {
    const rawTransaction = Buffer.from(attempt.rawTransactionBase64, "base64");
    const sentSignature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    if (sentSignature !== attempt.txSignature) {
      throw new Error(
        `Persisted transaction signature mismatch: ${sentSignature} != ${attempt.txSignature}`,
      );
    }
    await prisma.agentLaunchFeeDistributionAttempt.updateMany({
      where: { id: attempt.id, status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
      data: {
        status: "submitted",
        submittedAt: attempt.submittedAt ?? new Date(),
        lastError: null,
      },
    });
    const confirmation = await connection.confirmTransaction(
      {
        signature: attempt.txSignature,
        blockhash: attempt.recentBlockhash,
        lastValidBlockHeight: Number(attempt.lastValidBlockHeight),
      },
      "confirmed",
    );
    if (confirmation.value.err) {
      const reason = `on_chain_transaction_error:${JSON.stringify(confirmation.value.err)}`;
      await markAttemptFailed(attempt, reason);
      throw new RecordedDistributionFailure(reason);
    }
    return {
      kind: "complete",
      result: await finalizeConfirmedAttempt(launch, attempt),
    };
  } catch (error) {
    // The RPC acknowledgement is not authoritative. A send/confirm call can fail
    // after the transaction landed, so reconcile the signature before surfacing
    // a retryable error. Never prepare a second transaction while this signature
    // is still visible on-chain.
    const latest = await connection.getSignatureStatuses(
      [attempt.txSignature],
      { searchTransactionHistory: true },
    );
    const latestStatus = latest.value[0] ?? null;
    if (latestStatus?.err) {
      const reason = `on_chain_transaction_error:${JSON.stringify(latestStatus.err)}`;
      await markAttemptFailed(attempt, reason);
      throw new RecordedDistributionFailure(reason);
    }
    if (
      latestStatus?.confirmationStatus === "confirmed" ||
      latestStatus?.confirmationStatus === "finalized"
    ) {
      return {
        kind: "complete",
        result: await finalizeConfirmedAttempt(launch, attempt),
      };
    }
    const reason = Error.isError(error) ? error.message : String(error);
    await noteAttemptError(attempt.id, reason);
    throw error;
  }
}
type PreparedAttemptResult =
  | { kind: "attempt"; attempt: AgentLaunchFeeDistributionAttempt }
  | {
      kind: "skipped";
      result: Extract<DistributionRunResult, { status: "skipped" }>;
    };
async function createPreparedAttempt(
  launch: AgentLaunch,
  mint: PublicKey,
  payer: Keypair,
  mode: DistributionRunMode,
): Promise<PreparedAttemptResult> {
  const workerConfig = getAgentLaunchWorkerConfig();
  const connection = getAgentLaunchConnection();
  const preparation = await buildDistributionInstructions(mint, payer.publicKey);
  if (
    !preparation.canDistribute ||
    preparation.distributableLamports < workerConfig.minDistributeLamports
  ) {
    // This is the normal steady state for a 15-minute scanner, not a durable
    // domain event. Persisting one event per launch per scan would create an
    // unbounded no-op event stream; the job result still reports the skip.
    return {
      kind: "skipped",
      result: {
        status: "skipped",
        reason: "below_threshold_or_no_claimable_fees",
        mint: launch.mint!,
      },
    };
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  for (const instruction of preparation.instructions) tx.add(instruction);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(payer);
  const signatureBytes = tx.signature;
  if (!signatureBytes) {
    throw new Error("Prepared fee distribution transaction is missing a payer signature");
  }
  const txSignature = bs58.encode(signatureBytes);
  const rawTransactionBase64 = tx.serialize().toString("base64");
  const { creatorAmount, arAmount } = splitFeeDistributionAmounts(
    preparation.distributableLamports,
    launch.creatorShareBps,
    launch.arShareBps,
  );
  try {
    const attempt = await prisma.$transaction(async (db) => {
      const created = await db.agentLaunchFeeDistributionAttempt.create({
        data: {
          launchId: launch.id,
          network: launch.network,
          mint: launch.mint!,
          status: "prepared",
          mode,
          txSignature,
          rawTransactionBase64,
          recentBlockhash: blockhash,
          lastValidBlockHeight: BigInt(lastValidBlockHeight),
          quoteSymbol: launch.quoteSymbol,
          totalAmount: preparation.distributableLamports,
          creatorAmount,
          arAmount,
          payloadJson: {
            isGraduated: preparation.isGraduated,
            payer: payer.publicKey.toBase58(),
            accountingSource: "pump_distributable_estimate",
          },
        },
      });
      await recordAgentLaunchEventInTx(db, {
        launchId: launch.id,
        type: "distribution_attempted",
        txSignature,
        payloadJson: {
          attemptId: created.id,
          mint: launch.mint,
          totalAmount: preparation.distributableLamports.toString(),
          lastValidBlockHeight,
        },
      });
      await enqueueApplicationJobInTx(
        db,
        JOB_QUEUES.LAUNCH_FEE_RECONCILE,
        { v: 1, attemptId: created.id },
        { singletonKey: created.id, startAfter: 5 },
      );
      return created;
    });
    return { kind: "attempt", attempt };
  } catch (error) {
    // The partial unique index is the cross-process lock. A competing standard
    // or recovery worker may have persisted the winning transaction while this
    // process was preparing its own. Only the persisted winner may be sent.
    let active = await findActiveAttempt(launch.id);
    if (active) {
      if (mode === "recovery") active = await promoteAttemptToRecovery(active);
      return { kind: "attempt", attempt: active };
    }
    throw error;
  }
}
export async function reconcileDistributionAttempt(
  attemptId: string,
): Promise<DistributionRunResult> {
  const attempt = await prisma.agentLaunchFeeDistributionAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt) {
    return {
      status: "failed",
      reason: "distribution_attempt_not_found",
      mint: "",
      retryable: false,
    };
  }
  const launch = await prisma.agentLaunch.findUnique({ where: { id: attempt.launchId } });
  if (!launch) {
    return {
      status: "failed",
      reason: "launch_not_found",
      mint: attempt.mint,
      retryable: false,
    };
  }
  const configuredNetwork = getAgentLaunchNetwork();
  if (attempt.network !== configuredNetwork || launch.network !== configuredNetwork) {
    const reason = `launch_network_mismatch:${launch.network}:${configuredNetwork}`;
    if (isActiveAttemptStatus(attempt.status)) {
      await markAttemptFailed(attempt, reason);
    }
    return {
      status: "failed",
      reason,
      mint: attempt.mint,
      retryable: false,
    };
  }
  if (attempt.status === "confirmed") {
    const distribution = await prisma.agentLaunchFeeDistribution.findUnique({
      where: { txSignature: attempt.txSignature },
    });
    if (!distribution) {
      return {
        status: "failed",
        reason: "confirmed_attempt_missing_distribution",
        mint: attempt.mint,
        retryable: false,
      };
    }
    if (distribution.launchId !== launch.id) {
      return {
        status: "failed",
        reason: `Distribution signature ${attempt.txSignature} belongs to launch ${distribution.launchId}`,
        mint: attempt.mint,
        retryable: false,
      };
    }
    return distributedResult(distribution);
  }
  if (attempt.status === "failed") {
    if (attempt.lastError === "blockhash_expired_without_confirmation") {
      return runDistributionForLaunch(launch, {
        mode: attempt.mode === "recovery" ? "recovery" : "standard",
      });
    }
    return {
      status: "failed",
      reason: attempt.lastError ?? "distribution_attempt_failed",
      mint: attempt.mint,
      retryable: false,
    };
  }
  if (!isActiveAttemptStatus(attempt.status)) {
    return {
      status: "failed",
      reason: `distribution_attempt_invalid_status:${attempt.status}`,
      mint: attempt.mint,
      retryable: false,
    };
  }
  try {
    const reconciled = await reconcileAttempt(launch, attempt);
    if (reconciled.kind === "complete") return reconciled.result;
    return runDistributionForLaunch(launch, {
      mode: attempt.mode === "recovery" ? "recovery" : "standard",
    });
  } catch (error) {
    const reason = Error.isError(error) ? error.message : String(error);
    const retryable = isRetryableFeeDistributionFailure(
      reason,
      error instanceof RecordedDistributionFailure,
    );
    if (!retryable) {
      await markAttemptFailed(attempt, reason);
    }
    return {
      status: "failed",
      reason,
      mint: attempt.mint,
      retryable,
    };
  }
}
export async function runDistributionForLaunch(
  launchInput: AgentLaunch,
  options: { mode?: DistributionRunMode } = {},
): Promise<DistributionRunResult> {
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchInput.id } });
  if (!launch) {
    return { status: "failed", reason: "launch_not_found", mint: launchInput.mint ?? "", retryable: false };
  }
  if (!launch.mint) {
    return { status: "failed", reason: "missing_mint", mint: "", retryable: false };
  }
  const configuredNetwork = getAgentLaunchNetwork();
  if (launch.network !== configuredNetwork) {
    return {
      status: "failed",
      reason: `launch_network_mismatch:${launch.network}:${configuredNetwork}`,
      mint: launch.mint,
      retryable: false,
    };
  }
  try {
    let mode: DistributionRunMode = options.mode ?? "standard";
    const payer = loadFeeBotKeypair();
    const workerConfig = getAgentLaunchWorkerConfig();
    if (!workerConfig.feeBotPublicKey) {
      throw new Error("AGENT_LAUNCH_FEE_BOT_PUBLIC_KEY is not configured");
    }
    if (payer.publicKey.toBase58() !== workerConfig.feeBotPublicKey) {
      throw new Error("fee_bot_public_key_mismatch");
    }
    let mint: PublicKey;
    try {
      mint = new PublicKey(launch.mint);
    } catch {
      return {
        status: "failed",
        reason: "invalid_mint",
        mint: launch.mint,
        retryable: false,
      };
    }
    let active = await findActiveAttempt(launch.id);
    if (active) {
      if (mode === "recovery") {
        active = await promoteAttemptToRecovery(active);
      } else if (active.mode === "recovery") {
        mode = "recovery";
      }
      await enqueueAttemptReconciliation(active);
      return pendingResult(active);
    }
    const prepared = await createPreparedAttempt(
      launch,
      mint,
      payer,
      mode,
    );
    if (prepared.kind === "skipped") return prepared.result;
    const attempt = prepared.attempt;
    if (!isActiveAttemptStatus(attempt.status)) {
      throw new Error(
        `Prepared distribution attempt ${attempt.id} has invalid status ${attempt.status}`,
      );
    }
    return pendingResult(attempt);
  } catch (error) {
    const reason = Error.isError(error) ? error.message : String(error);
    const retryable = isRetryableFeeDistributionFailure(
      reason,
      error instanceof RecordedDistributionFailure,
    );
    if (!retryable && !(error instanceof RecordedDistributionFailure)) {
      await recordAgentLaunchEvent({
        launchId: launch.id,
        type: "distribution_failed",
        payloadJson: { mint: launch.mint, reason },
      });
    }
    return {
      status: "failed",
      reason,
      mint: launch.mint,
      retryable,
    };
  }
}
