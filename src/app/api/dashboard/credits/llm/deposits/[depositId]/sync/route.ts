import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { prisma } from "@/lib/db";
import { getDepositById } from "@/lib/llm-credits/deposits";
import { settleDeposit } from "@/lib/llm-credits/settlement";
export const dynamic = "force-dynamic";
async function getAccount(session: Session | null) {
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return null;
  return prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: { id: true },
  });
}
export async function POST(
  request: Request,
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
  let body: { signature?: string } = {};
  try {
    body = await request.json();
  } catch {
    // The endpoint does not require a request body.
  }
  const result = await settleDeposit(depositId, undefined, {
    providedSignature: body.signature,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, code: "SETTLE_FAILED" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    deposit: {
      id: depositId,
      status: "SETTLED",
      signature: result.signature,
      creditedCents: result.creditedCents,
      ledgerId: result.ledgerId,
    },
  });
}
