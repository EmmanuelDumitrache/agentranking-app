import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { isKripicardIssuerActive } from "@/lib/agent-payments/providers";
import { fundAgentArCardFromTreasury } from "@/lib/agent-payments/services/agent-kripicard-service";
import {
  getAgentLedgerBalance,
  transferTreasuryToAgentLedger,
} from "@/lib/agent-payments/services/agent-stablecoin-ledger-service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().optional(),
});

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { agentId: agentIdRaw } = await context.params;
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      ownerAccountId: auth.appAccountId,
      isActive: true,
    },
    select: { id: true, name: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (isKripicardIssuerActive()) {
    const card = await prisma.agentKripicardCard.findFirst({
      where: { appAccountId: auth.appAccountId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      agent,
      card: card
        ? { id: card.id, status: card.status, lastFour: card.lastFour }
        : null,
      sharedAccountCard: false,
    });
  }

  const ledger = await getAgentLedgerBalance(agentId);
  return NextResponse.json({ agent, ledger });
}

export async function POST(request: Request, context: RouteContext) {
  const { agentId: agentIdRaw } = await context.params;
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (isKripicardIssuerActive()) {
      const result = await fundAgentArCardFromTreasury({
        appAccountId: auth.appAccountId,
        agentId,
        amountCents: body.amountCents,
        idempotencyKey: body.idempotencyKey,
      });

      return NextResponse.json({
        ok: true,
        card: result.card,
        balanceUsd: result.balanceUsd,
        feeUsd: result.funded.data?.fee ?? null,
        message: `Loaded $${(body.amountCents / 100).toFixed(2)} onto AR card.`,
      });
    }

    const result = await transferTreasuryToAgentLedger({
      appAccountId: auth.appAccountId,
      agentId,
      amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json({
      ok: true,
      ledger: result.ledger,
      treasuryBalanceAfterCents: result.treasuryBalanceAfterCents,
      message: "USDC credited to agent spend balance.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    const status = message.includes("Insufficient") ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
