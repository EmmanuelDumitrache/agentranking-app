import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { sendSolFromAgentWallet } from "@/lib/custodial-wallet/send-sol";
import { parseSolAmountToLamports } from "@/lib/custodial-wallet/sol-transfer-policy";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
function solscanTxUrl(sig: string, isDevnet: boolean): string {
  const base = `https://solscan.io/tx/${sig}`;
  return isDevnet ? `${base}?cluster=devnet` : base;
}
export async function POST(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json()) as {
    recipient?: string;
    amountSol?: number;
    token?: string;
  };
  const recipient = body.recipient?.trim();
  const amountSol = body.amountSol;
  const token = (body.token?.trim()?.toUpperCase() || "SOL");
  if (!recipient) {
    return NextResponse.json({ error: "Recipient address is required" }, { status: 400 });
  }
  if (token !== "SOL") {
    return NextResponse.json(
      { error: token === "USDC" ? "USDC transfers coming soon" : `Unsupported token: ${token}` },
      { status: 400 },
    );
  }
  if (typeof amountSol !== "number" || !Number.isFinite(amountSol) || amountSol <= 0) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }
  const amountLamports = parseSolAmountToLamports(amountSol);
  if (!amountLamports) {
    return NextResponse.json({ error: "Amount must use at most 9 decimal places" }, { status: 400 });
  }
  const result = await sendSolFromAgentWallet({
    agentDbId: id,
    recipient,
    amountLamports,
  });
  if (result.status === "sent") {
    const isDevnet = process.env.AGENT_LAUNCH_NETWORK === "devnet";
    return NextResponse.json({
      ok: true,
      signature: result.signature,
      solscanUrl: solscanTxUrl(result.signature, isDevnet),
    });
  }
  const statusMap: Record<string, number> = {
    invalid_address: 400,
    invalid_amount: 400,
    insufficient_balance: 400,
    wallet_unavailable: 400,
    error: 500,
  };
  return NextResponse.json(
    { error: result.message, status: result.status },
    { status: statusMap[result.status] ?? 500 },
  );
}
