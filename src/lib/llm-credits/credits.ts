import type { Prisma } from "@/generated/prisma/client";
type PrismaTx = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
type GrantResult = {
  ok: boolean;
  reason?: string;
  ledgerId?: string;
};
export async function grantLlmBalanceInTx(
  tx: PrismaTx,
  params: {
    appAccountId: string;
    amount: number;
    reason: string;
    referenceId: string;
    idempotencyKey: string;
  },
): Promise<GrantResult> {
  const existing = await tx.accountCreditLedger.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) {
    return { ok: true, ledgerId: existing.id };
  }
  const account = await tx.appAccount.findUnique({
    where: { id: params.appAccountId },
  });
  if (!account) {
    return { ok: false, reason: "account_not_found" };
  }
  // Atomic increment to prevent lost updates under concurrent grants
  const updated = await tx.appAccount.update({
    where: { id: params.appAccountId },
    data: { llmBalanceCents: { increment: params.amount } },
    select: { llmBalanceCents: true },
  });
  const ledger = await tx.accountCreditLedger.create({
    data: {
      appAccountId: params.appAccountId,
      creditType: "LLM",
      delta: params.amount,
      balanceAfter: updated.llmBalanceCents,
      reason: params.reason,
      referenceId: params.referenceId,
      idempotencyKey: params.idempotencyKey,
    },
  });
  return { ok: true, ledgerId: ledger.id };
}
export function makeLlmCryptoDepositIdempotencyKey(depositId: string): string {
  return `llm-deposit:${depositId}`;
}