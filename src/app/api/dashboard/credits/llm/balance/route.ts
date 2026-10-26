import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AgentChatAccessError } from "@/features/agent-chat/server/access-error";
export const dynamic = "force-dynamic";
function assertSession(session: unknown): asserts session is {
  user: { id: string; email?: string | null; walletAddress?: string | null };
} {
  if (!session || typeof session !== "object") {
    throw new AgentChatAccessError(401, "UNAUTHORIZED", "No session provided", false, "SIGN_IN");
  }
  const s = session as Record<string, unknown>;
  const user = s.user;
  if (!user || typeof user !== "object") {
    throw new AgentChatAccessError(401, "UNAUTHORIZED", "Not authenticated", false, "SIGN_IN");
  }
  const u = user as Record<string, unknown>;
  if (typeof u.id !== "string" || !u.id) {
    throw new AgentChatAccessError(401, "UNAUTHORIZED", "Session has no user id", false, "SIGN_IN");
  }
}
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    assertSession(session);
    const email = session.user.email?.trim().toLowerCase();
    if (!email) {
      throw new AgentChatAccessError(
        401,
        "UNAUTHORIZED",
        "Not authenticated",
        false,
        "SIGN_IN",
      );
    }
    const profile = await prisma.userProfile.findUnique({
      where: { email },
      select: {
        appAccount: {
          select: { id: true, llmBalanceCents: true },
        },
      },
    });
    if (!profile?.appAccount) {
      throw new AgentChatAccessError(
        403,
        "FORBIDDEN",
        "User profile not found",
        false,
        "SIGN_IN",
      );
    }
    const { id: appAccountId, llmBalanceCents } = profile.appAccount;
    // Sum reserved cents from active runs (RESERVED + STREAMING)
    const reservedAgg = await prisma.agentChatRun.aggregate({
      _sum: { reservedCents: true },
      where: {
        appAccountId,
        status: { in: ["RESERVED", "STREAMING"] },
      },
    });
    const reservedCents = reservedAgg._sum.reservedCents ?? 0;
    // Latest ledger timestamp for display
    const lastLedger = await prisma.accountCreditLedger.findFirst({
      where: { appAccountId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return NextResponse.json({
      availableCents: llmBalanceCents,
      reservedCents,
      lastLedgerAt: lastLedger?.createdAt.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof AgentChatAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("GET /credits/llm/balance failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
