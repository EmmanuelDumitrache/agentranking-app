import "server-only";

import { mapWithConcurrency } from "@/lib/async-pool";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import { computeStakePerksForWallet } from "@/lib/ar-stake-perk-engine";
import { prisma } from "@/lib/db";
import { readArTokenMetricsPayload } from "@/lib/ar-token-admin-data";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminArTokenMetrics() {
  await requireAdminOperationsSession();
  return readArTokenMetricsPayload({ includeAdminRows: true });
}

export async function readAdminReferralCommissions(statusInput?: string | null) {
  await requireAdminOperationsSession();
  const status = statusInput?.trim() || "all";
  const where = status !== "all" ? { status } : {};
  const commissions = await prisma.arReferralCommission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      referrerWallet: true,
      referredWallet: true,
      referredEmail: true,
      orderNumber: true,
      productType: true,
      productLabel: true,
      orderUsd: true,
      commissionPct: true,
      commissionUsd: true,
      status: true,
      paidAt: true,
      adminNote: true,
      createdAt: true,
      referralCode: { select: { code: true } },
    },
  });
  const sum = (target: string) =>
    commissions
      .filter((commission) => commission.status === target)
      .reduce((total, commission) => total + commission.commissionUsd, 0);
  return {
    commissions: commissions.map((commission) => ({
      id: commission.id,
      code: commission.referralCode.code,
      referrerWallet: commission.referrerWallet,
      referredWallet: commission.referredWallet,
      referredEmail: commission.referredEmail,
      orderNumber: commission.orderNumber,
      productType: commission.productType,
      productLabel: commission.productLabel,
      orderUsd: commission.orderUsd,
      commissionPct: commission.commissionPct,
      commissionUsd: commission.commissionUsd,
      status: commission.status,
      paidAt: commission.paidAt?.toISOString() ?? null,
      adminNote: commission.adminNote,
      createdAt: commission.createdAt.toISOString(),
    })),
    totals: {
      pendingUsd: Math.round(sum("pending") * 100) / 100,
      approvedUsd: Math.round(sum("approved") * 100) / 100,
      paidUsd: Math.round(sum("paid") * 100) / 100,
    },
  };
}

export async function readAdminStakeRules() {
  await requireAdminOperationsSession();
  const rules = await prisma.arStakePerkRule.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return {
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      perkSlug: rule.perkSlug,
      minStakeRaw: rule.minStakeRaw,
      minLockDays: rule.minLockDays,
      priority: rule.priority,
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    })),
  };
}


export function normalizeAdminStakePositionsInput(input: {
  readonly wallet?: string | null;
  readonly page?: number;
  readonly pageSize?: number;
  readonly includePerkSummary?: boolean;
}) {
  return {
    wallet: normalizeStakeWallet(input.wallet ?? ""),
    page: Number.isFinite(input.page) ? Math.max(0, Math.trunc(input.page!)) : 0,
    pageSize: Number.isFinite(input.pageSize)
      ? Math.min(100, Math.max(1, Math.trunc(input.pageSize!)))
      : 50,
    includePerkSummary: input.includePerkSummary === true,
  };
}

export async function readAdminStakePositions(input: {
  readonly wallet?: string | null;
  readonly page?: number;
  readonly pageSize?: number;
  readonly includePerkSummary?: boolean;
}) {
  await requireAdminOperationsSession();
  const normalized = normalizeAdminStakePositionsInput(input);
  const where = normalized.wallet ? { wallet: normalized.wallet } : {};
  const [positions, total] = await Promise.all([
    prisma.arStakePosition.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: normalized.page * normalized.pageSize,
      take: normalized.pageSize,
      select: {
        id: true,
        wallet: true,
        poolAddress: true,
        stakeAccount: true,
        mintAddress: true,
        amountRaw: true,
        amountUi: true,
        nonce: true,
        durationSec: true,
        lockStartAt: true,
        lockEndAt: true,
        txSignature: true,
        status: true,
        source: true,
        adminNote: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.arStakePosition.count({ where }),
  ]);

  let perkSummaryByWallet: Record<string, string[]> = {};
  if (normalized.includePerkSummary && positions.length > 0) {
    const wallets: string[] = [
      ...new Set<string>(
        positions
          .map((position) => position.wallet)
          .filter((wallet): wallet is string => typeof wallet === "string"),
      ),
    ].slice(0, 30);
    const entries = await mapWithConcurrency(wallets, 6, async (wallet) => {
      try {
        const result = await computeStakePerksForWallet(wallet);
        return [wallet, result.unlockedPerks] as const;
      } catch {
        return [wallet, []] as const;
      }
    });
    perkSummaryByWallet = Object.fromEntries(entries);
  }

  return {
    positions: positions.map((position) => ({
      id: position.id,
      wallet: position.wallet,
      poolAddress: position.poolAddress,
      stakeAccount: position.stakeAccount,
      mintAddress: position.mintAddress,
      amountRaw: position.amountRaw,
      amountUi: position.amountUi,
      nonce: position.nonce,
      durationSec: position.durationSec,
      lockStartAt: position.lockStartAt?.toISOString() ?? null,
      lockEndAt: position.lockEndAt?.toISOString() ?? null,
      txSignature: position.txSignature,
      status: position.status,
      source: position.source,
      adminNote: position.adminNote,
      lastSyncedAt: position.lastSyncedAt.toISOString(),
      createdAt: position.createdAt.toISOString(),
      updatedAt: position.updatedAt.toISOString(),
    })),
    total,
    page: normalized.page,
    pageSize: normalized.pageSize,
    ...(normalized.includePerkSummary ? { perkSummaryByWallet } : {}),
  };
}

export async function readAdminStakeOverrides(walletInput?: string | null) {
  await requireAdminOperationsSession();
  const wallet = normalizeStakeWallet(walletInput ?? "");
  const overrides = await prisma.arStakePerkOverride.findMany({
    where: wallet ? { wallet } : {},
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      wallet: true,
      perkSlug: true,
      overrideType: true,
      adminNote: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    overrides: overrides.map((override) => ({
      id: override.id,
      wallet: override.wallet,
      perkSlug: override.perkSlug,
      overrideType: override.overrideType,
      adminNote: override.adminNote,
      expiresAt: override.expiresAt?.toISOString() ?? null,
      createdAt: override.createdAt.toISOString(),
      updatedAt: override.updatedAt.toISOString(),
    })),
  };
}

export async function readAdminHolderAllocations(walletInput?: string | null) {
  await requireAdminOperationsSession();
  const wallet = normalizeStakeWallet(walletInput ?? "");
  const rows = await prisma.arHolderAgentPerk.findMany({
    where: wallet ? { wallet } : {},
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      wallet: true,
      agentId: true,
      perkType: true,
      tierId: true,
      boostUnits: true,
      status: true,
      periodKey: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      agent: { select: { name: true } },
    },
  });
  return {
    allocations: rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      agentId: row.agentId,
      perkType: row.perkType,
      tierId: row.tierId,
      boostUnits: row.boostUnits,
      status: row.status,
      periodKey: row.periodKey,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      agentName: row.agent.name,
    })),
  };
}
