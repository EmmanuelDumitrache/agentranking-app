import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { prisma } from "@/lib/db";
import {
  cancelDepositForAccount,
  getDepositById,
} from "@/lib/llm-credits/deposits";
import type { DepositListItem } from "@/lib/llm-credits/types";
import { formatAtomicAmount } from "@/lib/llm-credits/pricing";
export const dynamic = "force-dynamic";
async function getAccount(session: Session | null) {
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return null;
  return prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: { id: true },
  });
}
function serializeDeposit(deposit: {
  id: string;
  status: string;
  asset: string;
  quotedCents: number;
  expectedAmountAtomic: bigint;
  recipientPublicKey: string;
  referencePublicKey: string;
  paymentUrl: string;
  quoteExpiresAt: Date;
  createdAt?: Date;
  settledAt: Date | null;
  signature: string | null;
  creditedCents: number | null;
  failureReason: string | null;
}): DepositListItem {
  return {
    id: deposit.id,
    status: deposit.status,
    asset: deposit.asset as DepositListItem["asset"],
    quotedCents: deposit.quotedCents,
    expectedAmountAtomic: deposit.expectedAmountAtomic.toString(),
    displayAmount: formatAtomicAmount(deposit.expectedAmountAtomic, deposit.asset as DepositListItem["asset"]),
    recipientPublicKey: deposit.recipientPublicKey,
    referencePublicKey: deposit.referencePublicKey,
    paymentUrl: deposit.paymentUrl,
    quoteExpiresAt: deposit.quoteExpiresAt.toISOString(),
    createdAt: deposit.createdAt?.toISOString(),
    settledAt: deposit.settledAt?.toISOString(),
    signature: deposit.signature ?? undefined,
    creditedCents: deposit.creditedCents ?? undefined,
    failureReason: deposit.failureReason ?? undefined,
  };
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ depositId: string }> },
) {
  const session = await getServerSession(authOptions);
  const account = await getAccount(session);
  if (!account) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const { depositId } = await params;
  const deposit = await getDepositById(depositId);
  if (!deposit || deposit.appAccountId !== account.id) {
    return NextResponse.json(
      { error: "Deposit not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ deposit: serializeDeposit(deposit) });
}
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ depositId: string }> },
) {
  const session = await getServerSession(authOptions);
  const account = await getAccount(session);
  if (!account) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const { depositId } = await params;
  const result = await cancelDepositForAccount({
    depositId,
    appAccountId: account.id,
  });
  if (!result.ok && result.reason === "NOT_FOUND") {
    return NextResponse.json(
      { error: "Deposit not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Only pending deposits can be cancelled",
        code: "NOT_CANCELLABLE",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ deposit: serializeDeposit(result.deposit) });
}
