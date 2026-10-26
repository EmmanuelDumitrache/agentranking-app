import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { SolanaStakingClient } from "@streamflow/staking";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeStakeWallet, parseAmountUiToTierRaw } from "@/lib/ar-holder-tier-resolve";
import {
  allowedStreamflowStakePools,
  streamflowICluster,
  streamflowRpcEndpoint,
} from "@/lib/streamflow-stake-config";
import { resolveArTokenDecimals } from "@/lib/ar-token-public";
export type StakeSyncSummary = {
  ok: boolean;
  poolAddress: string;
  scanned: number;
  upserted: number;
  expired: number;
  unstaked: number;
  errors: string[];
};
type StakeEntryAccount = {
  nonce: number;
  payer: PublicKey;
  amount: { toString(): string };
  duration: { toString(): string };
  createdTs: { toString(): string };
  closedTs: { toString(): string };
};
function stakingClient(): SolanaStakingClient {
  return new SolanaStakingClient({
    clusterUrl: streamflowRpcEndpoint(),
    cluster: streamflowICluster(),
  });
}
function formatAmountUiFromRaw(amountRaw: string, decimals = 9): string {
  if (!/^\d+$/.test(amountRaw)) return "0";
  const raw = BigInt(amountRaw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
export async function runStakePositionSync(): Promise<StakeSyncSummary> {
  const allowed = allowedStreamflowStakePools();
  const errors: string[] = [];
  if (!allowed) {
    return {
      ok: false,
      poolAddress: "",
      scanned: 0,
      upserted: 0,
      expired: 0,
      unstaked: 0,
      errors: ["NEXT_PUBLIC_STREAMFLOW_STAKE_POOL and MINT are not configured."],
    };
  }
  const poolPk = new PublicKey(allowed.poolAddress);
  const client = stakingClient();
  const now = new Date();
  let entries: Awaited<ReturnType<SolanaStakingClient["searchStakeEntries"]>> = [];
  try {
    entries = await client.searchStakeEntries({ stakePool: poolPk });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : "searchStakeEntries failed";
    return {
      ok: false,
      poolAddress: allowed.poolAddress,
      scanned: 0,
      upserted: 0,
      expired: 0,
      unstaked: 0,
      errors: [msg],
    };
  }
  const decimals = resolveArTokenDecimals();
  const activeRows = new Map<string, {
    id: string;
    wallet: string;
    nonce: number;
    stakeAccount: string;
    amountRaw: string;
    amountUi: string;
    durationSec: number;
    lockStartAt: Date;
    lockEndAt: Date | null;
  }>();
  for (const row of entries) {
    const acct = row.account as StakeEntryAccount;
    const closedTs = Number(acct.closedTs?.toString() ?? "0");
    if (closedTs > 0) continue;
    const wallet = normalizeStakeWallet(acct.payer.toBase58());
    const nonce = Number(acct.nonce);
    const amountRaw = acct.amount.toString();
    const durationSec = Number(acct.duration.toString());
    const createdTs = Number(acct.createdTs.toString());
    const lockStartAt = createdTs > 0 ? new Date(createdTs * 1000) : now;
    const lockEndAt =
      durationSec > 0 && createdTs > 0
        ? new Date((createdTs + durationSec) * 1000)
        : null;
    const key = `${wallet}:${nonce}:${allowed.poolAddress}`;
    const amountUi = formatAmountUiFromRaw(amountRaw, decimals);
    if (parseAmountUiToTierRaw(amountUi) === BigInt(0) && amountRaw !== "0") {
      // SPL stake amounts are typically 9 decimals; tier math uses 18-decimal raw in rules.
      // Store UI as formatted 9-dec string; tier resolver also reads amountRaw when set.
    }
    activeRows.set(key, {
      id: randomUUID(),
      wallet,
      nonce,
      stakeAccount: row.publicKey.toBase58(),
      amountRaw,
      amountUi,
      durationSec,
      lockStartAt,
      lockEndAt,
    });
  }
  const normalizedRows = [...activeRows.values()];
  for (let offset = 0; offset < normalizedRows.length; offset += 500) {
    const batch = normalizedRows.slice(offset, offset + 500);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ArStakePosition" (
        id, wallet, "poolAddress", "stakeAccount", "mintAddress",
        "amountRaw", "amountUi", nonce, "durationSec", "lockStartAt",
        "lockEndAt", "txSignature", status, source, "lastSyncedAt",
        "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(batch.map((row) => Prisma.sql`(
        ${row.id}, ${row.wallet}, ${allowed.poolAddress}, ${row.stakeAccount},
        ${allowed.mintAddress}, ${row.amountRaw}, ${row.amountUi}, ${row.nonce},
        ${row.durationSec}, ${row.lockStartAt}, ${row.lockEndAt}, '', 'active',
        'indexer', ${now}, ${now}, ${now}
      )`))}
      ON CONFLICT (wallet, nonce, "poolAddress") DO UPDATE SET
        "stakeAccount" = EXCLUDED."stakeAccount",
        "mintAddress" = EXCLUDED."mintAddress",
        "amountRaw" = EXCLUDED."amountRaw",
        "amountUi" = EXCLUDED."amountUi",
        "durationSec" = EXCLUDED."durationSec",
        "lockStartAt" = EXCLUDED."lockStartAt",
        "lockEndAt" = EXCLUDED."lockEndAt",
        status = 'active',
        source = 'indexer',
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }
  const canReconcileMissing = entries.length > 0;
  const unstaked = canReconcileMissing
    ? await prisma.$executeRaw`
        UPDATE "ArStakePosition"
        SET status = 'unstaked', "lastSyncedAt" = ${now}, "updatedAt" = ${now}
        WHERE "poolAddress" = ${allowed.poolAddress}
          AND status = 'active'
          AND "lastSyncedAt" IS DISTINCT FROM ${now}
      `
    : 0;
  const expired = await prisma.$executeRaw`
    UPDATE "ArStakePosition"
    SET status = 'expired', "updatedAt" = ${now}
    WHERE "poolAddress" = ${allowed.poolAddress}
      AND status = 'active'
      AND "lastSyncedAt" IS NOT DISTINCT FROM ${now}
      AND "lockEndAt" IS NOT NULL
      AND "lockEndAt" <= ${now}
  `;
  const remainingActive = canReconcileMissing
    ? null
    : await prisma.arStakePosition.findFirst({
        where: { poolAddress: allowed.poolAddress, status: "active" },
        select: { id: true },
      });
  if (remainingActive) {
    errors.push("Indexer returned 0 entries; skipped marking DB positions unstaked.");
  }
  return {
    ok: errors.length === 0,
    poolAddress: allowed.poolAddress,
    scanned: entries.length,
    upserted: normalizedRows.length,
    expired,
    unstaked,
    errors,
  };
}
