import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "./audit-service";
import { ensureTreasuryWallet } from "./wallet-service";

const DEFAULT_POLICY = {
  dailyLimitCents: 10_000,
  weeklyLimitCents: 50_000,
  monthlyLimitCents: 200_000,
  allowedCategories: [] as string[],
  blockedCategories: [] as string[],
  allowManualUsage: true,
  allowAgentUsage: true,
};
const MAX_POLICY_LIMIT_CENTS = 2_147_483_647;
const MAX_POLICY_CATEGORIES = 64;
const MAX_CATEGORY_LENGTH = 80;

type SpendingPolicyDb = Pick<
  Prisma.TransactionClient,
  "spendingPolicy" | "treasuryWallet" | "treasuryTransaction"
>;

function normalizeLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POLICY_LIMIT_CENTS) {
    throw new Error(`${field} must be a non-negative safe integer no greater than ${MAX_POLICY_LIMIT_CENTS}`);
  }
  return value;
}

export function normalizeSpendingCategories(values: readonly string[], field = "categories"): string[] {
  if (values.length > MAX_POLICY_CATEGORIES) {
    throw new Error(`${field} may contain at most ${MAX_POLICY_CATEGORIES} categories`);
  }
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  for (const category of normalized) {
    if (category.length > MAX_CATEGORY_LENGTH) {
      throw new Error(`${field} entries may not exceed ${MAX_CATEGORY_LENGTH} characters`);
    }
  }
  return normalized;
}

export function assertNoSpendingCategoryOverlap(
  allowedCategories: readonly string[],
  blockedCategories: readonly string[],
): void {
  const blockedSet = new Set(blockedCategories);
  const overlap = allowedCategories.find((category) => blockedSet.has(category));
  if (overlap) {
    throw new Error(`Category "${overlap}" cannot be both allowed and blocked`);
  }
}

export async function ensureSpendingPolicy(
  appAccountId: string,
  db: SpendingPolicyDb = prisma,
) {
  return db.spendingPolicy.upsert({
    where: { appAccountId },
    create: { appAccountId, ...DEFAULT_POLICY },
    update: {},
  });
}

export async function getSpendingPolicy(appAccountId: string) {
  return ensureSpendingPolicy(appAccountId);
}

export async function updateSpendingPolicy(
  appAccountId: string,
  patch: Partial<{
    dailyLimitCents: number;
    weeklyLimitCents: number;
    monthlyLimitCents: number;
    allowedCategories: string[];
    blockedCategories: string[];
    allowManualUsage: boolean;
    allowAgentUsage: boolean;
  }>,
) {
  const wallet = await ensureTreasuryWallet(appAccountId);
  const normalizedPatch = {
    ...(patch.dailyLimitCents !== undefined
      ? { dailyLimitCents: normalizeLimit(patch.dailyLimitCents, "dailyLimitCents") }
      : {}),
    ...(patch.weeklyLimitCents !== undefined
      ? { weeklyLimitCents: normalizeLimit(patch.weeklyLimitCents, "weeklyLimitCents") }
      : {}),
    ...(patch.monthlyLimitCents !== undefined
      ? { monthlyLimitCents: normalizeLimit(patch.monthlyLimitCents, "monthlyLimitCents") }
      : {}),
    ...(patch.allowedCategories !== undefined
      ? { allowedCategories: normalizeSpendingCategories(patch.allowedCategories, "allowedCategories") }
      : {}),
    ...(patch.blockedCategories !== undefined
      ? { blockedCategories: normalizeSpendingCategories(patch.blockedCategories, "blockedCategories") }
      : {}),
    ...(patch.allowManualUsage !== undefined ? { allowManualUsage: patch.allowManualUsage } : {}),
    ...(patch.allowAgentUsage !== undefined ? { allowAgentUsage: patch.allowAgentUsage } : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const current = await ensureSpendingPolicy(appAccountId, tx);
    const allowed = normalizedPatch.allowedCategories ?? current.allowedCategories;
    const blocked = normalizedPatch.blockedCategories ?? current.blockedCategories;
    assertNoSpendingCategoryOverlap(allowed, blocked);

    const policy = await tx.spendingPolicy.update({
      where: { appAccountId },
      data: normalizedPatch,
    });
    await tx.treasuryTransaction.create({
      data: {
        appAccountId,
        walletId: wallet.id,
        type: "POLICY_UPDATE",
        amountCents: 0,
        status: "SETTLED",
        reason: "spending_policy_updated",
        metadata: normalizedPatch as Prisma.InputJsonValue,
      },
    });
    return policy;
  });

  await writeAuditLog({
    appAccountId,
    action: "policy.updated",
    entityType: "spending_policy",
    entityId: updated.id,
    metadata: normalizedPatch,
  });

  return updated;
}

export type SpendValidationInput = {
  appAccountId: string;
  amountCents: number;
  category?: string | null;
  actor: "agent" | "manual";
  cardStatus?: string | null;
};

export type SpendValidationResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

export async function validateSpendRequest(
  input: SpendValidationInput,
  db: SpendingPolicyDb = prisma,
): Promise<SpendValidationResult> {
  const reasons: string[] = [];
  const policy = await ensureSpendingPolicy(input.appAccountId, db);
  const wallet = await db.treasuryWallet.findUnique({ where: { appAccountId: input.appAccountId } });

  if (!wallet || wallet.status !== "ACTIVE") {
    reasons.push("Wallet is not active");
  } else if (wallet.balanceUsdcCents - wallet.reservedUsdcCents < input.amountCents) {
    reasons.push("Insufficient available balance");
  }

  if (input.cardStatus && input.cardStatus !== "ACTIVE") reasons.push(`Card status is ${input.cardStatus}`);
  if (input.actor === "agent" && !policy.allowAgentUsage) reasons.push("Agent spending is disabled");
  if (input.actor === "manual" && !policy.allowManualUsage) reasons.push("Manual card usage is disabled");

  const category = (input.category ?? "").trim().toLowerCase();
  if (category && policy.blockedCategories.includes(category)) reasons.push(`Category "${category}" is blocked`);
  if (category && policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(category)) {
    reasons.push(`Category "${category}" is not in the allowlist`);
  }

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [daily, weekly, monthly] = await Promise.all([
    sumSpendSince(db, input.appAccountId, dayStart),
    sumSpendSince(db, input.appAccountId, weekStart),
    sumSpendSince(db, input.appAccountId, monthStart),
  ]);

  if (daily + input.amountCents > policy.dailyLimitCents) reasons.push("Would exceed daily spending limit");
  if (weekly + input.amountCents > policy.weeklyLimitCents) reasons.push("Would exceed weekly spending limit");
  if (monthly + input.amountCents > policy.monthlyLimitCents) reasons.push("Would exceed monthly spending limit");

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

async function sumSpendSince(db: SpendingPolicyDb, appAccountId: string, since: Date): Promise<number> {
  const agg = await db.treasuryTransaction.aggregate({
    where: {
      appAccountId,
      type: "SPEND",
      status: "SETTLED",
      createdAt: { gte: since },
    },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}
