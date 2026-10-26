import { prisma } from "@/lib/db";
export type AccountBalanceSummary = {
  appAccountId: string;
  totalCreditsIssued: number;
  totalCreditsDebited: number;
  currentBalanceCents: number;
  ledgerEntryCount: number;
};
export type ProviderUsageSummary = {
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalChargeCents: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
};
export type DepositSummary = {
  totalDeposits: number;
  totalSettled: number;
  totalCentsGranted: number;
  totalSolDeposits: number;
  totalUsdcDeposits: number;
  underpaidCount: number;
  expiredCount: number;
};
export type ReconciliationReport = {
  generatedAt: string;
  accounts: AccountBalanceSummary[];
  providerUsage: ProviderUsageSummary;
  deposits: DepositSummary;
};
export async function computeAccountBalances(): Promise<
  AccountBalanceSummary[]
> {
  const accounts = await prisma.appAccount.findMany({
    include: {
      creditLedger: {
        where: { creditType: "LLM" },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return accounts.map((account) => ({
    appAccountId: account.id,
    totalCreditsIssued: account.creditLedger.reduce(
      (sum, entry) => sum + Math.max(0, entry.delta),
      0,
    ),
    totalCreditsDebited: account.creditLedger.reduce(
      (sum, entry) => sum + Math.max(0, -entry.delta),
      0,
    ),
    currentBalanceCents: account.llmBalanceCents,
    ledgerEntryCount: account.creditLedger.length,
  }));
}
export async function computeProviderUsage(params?: {
  days?: number;
}): Promise<ProviderUsageSummary> {
  const since = new Date(
    Date.now() - (params?.days ?? 30) * 24 * 60 * 60 * 1000,
  );
  const groups = await prisma.llmRunUsage.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, chargeCents: true },
  });
  const summary: ProviderUsageSummary = {
    totalRuns: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalChargeCents: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  };
  for (const group of groups) {
    const count = group._count._all;
    summary.totalRuns += count;
    summary.totalInputTokens += group._sum.inputTokens ?? 0;
    summary.totalOutputTokens += group._sum.outputTokens ?? 0;
    summary.totalChargeCents += group._sum.chargeCents ?? 0;
    if (group.status === "COMPLETE") summary.completedCount += count;
    else if (group.status === "FAILED") summary.failedCount += count;
    else if (group.status === "CANCELLED") summary.cancelledCount += count;
  }
  return summary;
}
export async function computeDepositSummary(): Promise<DepositSummary> {
  const deposits = await prisma.llmCreditDeposit.findMany({
    select: { status: true, asset: true, creditedCents: true },
  });
  const summary: DepositSummary = {
    totalDeposits: deposits.length,
    totalSettled: 0,
    totalCentsGranted: 0,
    totalSolDeposits: 0,
    totalUsdcDeposits: 0,
    underpaidCount: 0,
    expiredCount: 0,
  };
  for (const deposit of deposits) {
    if (deposit.status === "SETTLED" || deposit.status === "OVERPAID") {
      summary.totalSettled += 1;
      summary.totalCentsGranted += deposit.creditedCents ?? 0;
    } else if (deposit.status === "UNDERPAID") summary.underpaidCount += 1;
    else if (deposit.status === "EXPIRED") summary.expiredCount += 1;
    if (deposit.asset === "SOL") summary.totalSolDeposits += 1;
    else summary.totalUsdcDeposits += 1;
  }
  return summary;
}
export async function buildReconciliationReport(): Promise<ReconciliationReport> {
  const [accounts, providerUsage, deposits] = await Promise.all([
    computeAccountBalances(),
    computeProviderUsage(),
    computeDepositSummary(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    accounts,
    providerUsage,
    deposits,
  };
}