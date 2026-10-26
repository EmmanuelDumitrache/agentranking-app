import { getAgentLaunchWorkerConfig } from "@/lib/agent-launch/config-worker.server";
import {
  loadFeeBotKeypair,
  reconcileDistributionAttempt,
  runDistributionForLaunch,
  type DistributionRunMode,
} from "@/lib/agent-launch/fee-distribution";
import { assertAgentLaunchServerEnabled } from "@/lib/agent-launch/guards";
import { isMockOnlyLaunch } from "@/lib/agent-launch/launch-access";
import { getAgentLaunchConnection, getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { prisma } from "@/lib/db";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { backgroundJobPausedResult } from "../task-utils";
import { getOrLoadValkeyJson } from "@/lib/valkey-cache";
import type { LaunchFeeScanPayload } from "@/jobs/contracts";
const FEE_BOT_MIN_BALANCE_LAMPORTS = 5_000_000;
const FEE_WORKER_READINESS_CACHE_SECONDS = 30;
const FEE_SCAN_CURSOR_PREFIX = "maintenance:agent-launch-fees";
function feeScanBatchSize(): number {
  const parsed = Number.parseInt(process.env.AGENT_LAUNCH_FEE_SCAN_BATCH_SIZE ?? "1000", 10);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(10_000, parsed)) : 1_000;
}
function feeScanCursor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { v?: unknown; lastId?: unknown };
    return parsed.v === 1 && typeof parsed.lastId === "string" && parsed.lastId.length > 0
      ? parsed.lastId
      : undefined;
  } catch {
    return undefined;
  }
}
export type AgentLaunchFeeWorkerReadiness = {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  publicKey: string | null;
  balanceSol: number | null;
  minBalanceSol: number;
  reason: string | null;
};
function isAgentLaunchFeeWorkerReadiness(value: unknown): value is AgentLaunchFeeWorkerReadiness {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.enabled === "boolean" &&
    typeof row.configured === "boolean" &&
    typeof row.ready === "boolean" &&
    (row.publicKey === null || typeof row.publicKey === "string") &&
    (row.balanceSol === null || (typeof row.balanceSol === "number" && Number.isFinite(row.balanceSol))) &&
    typeof row.minBalanceSol === "number" &&
    Number.isFinite(row.minBalanceSol) &&
    (row.reason === null || typeof row.reason === "string")
  );
}
function assertFeeDistributionRuntimeEnabled(): { network: string } {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) throw new Error(`Agent Launch disabled: ${guard.reason}`);
  return { network: getAgentLaunchNetwork() };
}
function assertFeeDistributionSigningReady(): { network: string } {
  const runtime = assertFeeDistributionRuntimeEnabled();
  const workerConfig = getAgentLaunchWorkerConfig();
  if (!workerConfig.feeBotPrivateKey) {
    throw new Error("AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY is not configured in the worker environment");
  }
  if (!workerConfig.feeBotPublicKey) {
    throw new Error("AGENT_LAUNCH_FEE_BOT_PUBLIC_KEY is not configured");
  }
  const payer = loadFeeBotKeypair();
  if (payer.publicKey.toBase58() !== workerConfig.feeBotPublicKey) {
    throw new Error("fee_bot_public_key_mismatch");
  }
  return runtime;
}
export async function getAgentLaunchFeeWorkerReadiness(): Promise<AgentLaunchFeeWorkerReadiness> {
  const workerConfig = getAgentLaunchWorkerConfig();
  const network = getAgentLaunchNetwork();
  const cacheIdentity = [
    network,
    workerConfig.feeDistributionEnabled ? "enabled" : "disabled",
    workerConfig.feeBotPublicKey ?? "missing-public-key",
    workerConfig.feeBotPrivateKey ? "private-key-present" : "private-key-missing",
  ].join(":");
  return getOrLoadValkeyJson({
    key: `agent-launch-fee-readiness:v1:${cacheIdentity}`,
    leaseKey: `agent-launch-fee-readiness-lock:v1:${cacheIdentity}`,
    ttlSeconds: FEE_WORKER_READINESS_CACHE_SECONDS,
    validate: isAgentLaunchFeeWorkerReadiness,
    maxPayloadBytes: 4_096,
    leaseTtlMs: 15_000,
    waitMs: 10_000,
    load: async () => {
      const base = {
        enabled: workerConfig.feeDistributionEnabled,
        configured: false,
        ready: false,
        publicKey: null,
        balanceSol: null,
        minBalanceSol: FEE_BOT_MIN_BALANCE_LAMPORTS / 1_000_000_000,
        reason: null,
      } satisfies AgentLaunchFeeWorkerReadiness;
      if (!workerConfig.feeBotPrivateKey) {
        return {
          ...base,
          reason: "AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY is not configured in the root environment",
        };
      }
      if (!workerConfig.feeBotPublicKey) {
        return {
          ...base,
          reason: "AGENT_LAUNCH_FEE_BOT_PUBLIC_KEY is not configured",
        };
      }
      try {
        const payer = loadFeeBotKeypair();
        const publicKey = payer.publicKey.toBase58();
        if (workerConfig.feeBotPublicKey !== publicKey) {
          return {
            ...base,
            configured: true,
            publicKey,
            reason: "Configured fee bot public key does not match the worker private key",
          };
        }
        const balance = await getAgentLaunchConnection().getBalance(payer.publicKey, "confirmed");
        const ready = balance >= FEE_BOT_MIN_BALANCE_LAMPORTS;
        return {
          ...base,
          configured: true,
          ready,
          publicKey,
          balanceSol: balance / 1_000_000_000,
          reason: ready ? null : "Fee bot SOL balance is below the readiness threshold",
        };
      } catch (error) {
        return {
          ...base,
          reason: Error.isError(error) ? error.message : String(error),
        };
      }
    },
  });
}
export async function agentLaunchFeeScanJob(payload: LaunchFeeScanPayload) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const workerConfig = getAgentLaunchWorkerConfig();
  if (payload.mode === "scheduled" && !workerConfig.feeDistributionEnabled) {
    return { ok: true, disabled: true, reason: "AGENT_LAUNCH_FEE_DISTRIBUTION_ENABLED is not set" };
  }
  const { network } = assertFeeDistributionSigningReady();
  // Round-robin one bounded page per scan. Re-enqueuing every active launch on
  // every 15-minute tick can itself create a six-figure queue even though most
  // launches have no distributable fees; the persisted cursor keeps coverage
  // fair without retaining the whole launch set in memory.
  const pageSize = feeScanBatchSize();
  const sourceKey = `${FEE_SCAN_CURSOR_PREFIX}:${network}`;
  const storedCursor = await prisma.indexerSourceCursor.findUnique({
    where: { sourceKey },
    select: { opaqueCursor: true },
  });
  const cursor = feeScanCursor(storedCursor?.opaqueCursor);
  const candidates = await prisma.agentLaunch.findMany({
    where: {
      network,
      feeSharingStatus: "active",
      launchStatus: "indexed",
      mint: { not: null },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: {
      id: true,
      mint: true,
      creationTx: true,
      feeSharingConfig: true,
    },
    orderBy: { id: "asc" },
    take: pageSize + 1,
  });
  const complete = candidates.length <= pageSize;
  const launches = candidates.slice(0, pageSize);
  const runnable = launches.filter((launch) => !isMockOnlyLaunch(launch));
  const jobIds = await enqueueApplicationJobs(
    JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE,
    runnable.map((launch) => ({
      data: { v: 1, id: launch.id, mode: "standard" },
      singletonKey: launch.id,
    })),
  );
  const nextId = complete ? null : launches.at(-1)?.id ?? null;
  const now = new Date();
  await prisma.indexerSourceCursor.upsert({
    where: { sourceKey },
    create: {
      sourceKey,
      domain: "agent-launch-fee-scan",
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId }),
      lastAdvancedAt: now,
      reconciliationGeneration: complete ? 1n : 0n,
    },
    update: {
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId }),
      lastAdvancedAt: now,
      ...(complete ? { reconciliationGeneration: { increment: 1n } } : {}),
    },
  });
  return {
    ok: true,
    mode: payload.mode,
    network,
    eligible: launches.length,
    enqueued: jobIds.length,
    skippedMocks: launches.length - runnable.length,
    complete,
    nextId,
  };
}
export async function agentLaunchFeeDistributionJob(
  launchId: string,
  mode: DistributionRunMode,
) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const { network } = assertFeeDistributionSigningReady();
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!launch) return { ok: true, skipped: "launch_missing" };
  if (launch.network !== network) return { ok: true, skipped: "network_mismatch" };
  if (!launch.mint) return { ok: true, skipped: "missing_mint" };
  if (mode === "standard") {
    if (launch.feeSharingStatus !== "active") return { ok: true, skipped: "fee_sharing_inactive" };
    if (launch.launchStatus !== "indexed") return { ok: true, skipped: "launch_not_indexed" };
    if (isMockOnlyLaunch(launch)) return { ok: true, skipped: "mock_launch" };
  }
  const result = await runDistributionForLaunch(launch, { mode });
  if (result.status === "failed" && result.retryable) {
    throw new Error(`Fee distribution failed for launch ${launchId}: ${result.reason}`);
  }
  return { ok: result.status !== "failed", result };
}
export async function agentLaunchFeeReconcileJob(attemptId: string) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  assertFeeDistributionRuntimeEnabled();
  const result = await reconcileDistributionAttempt(attemptId);
  if (result.status === "failed" && result.retryable) {
    throw new Error(`Fee distribution reconciliation failed for attempt ${attemptId}: ${result.reason}`);
  }
  return { ok: result.status !== "failed", result };
}
