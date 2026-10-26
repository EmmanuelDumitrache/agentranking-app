/**
 * POST /api/dashboard/agents/[agentDbId]/evm-wallet/send-tx
 * Server-signs and broadcasts an EVM tx with the agent's custodial key
 * (Robinhood Chain or Ethereum mainnet).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { isHex } from "viem";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { getAgentEvmWallet } from "@/lib/agent-evm-wallet.server";
import { signAndSendAgentCustodialEvmTransaction } from "@/lib/custodial-wallet/sign-evm";
import { ETHEREUM_MAINNET_CHAIN_ID } from "@/lib/evm-wallet-utils";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
const SUPPORTED_CHAIN_IDS = new Set([ROBINHOOD_CHAIN_ID, ETHEREUM_MAINNET_CHAIN_ID]);
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.status === 404 ? "Agent not found" : "Forbidden" },
      { status: access.status },
    );
  }
  const evm = await getAgentEvmWallet(id);
  if (!evm.configured || !evm.isCustodial || !evm.address) {
    return NextResponse.json(
      { ok: false, error: "This agent does not have a custodial EVM wallet." },
      { status: 400 },
    );
  }
  let body: {
    to?: string;
    data?: string;
    value?: string;
    gas?: string;
    expectedAddress?: string;
    chainId?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chainId = body.chainId ?? ROBINHOOD_CHAIN_ID;
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    return NextResponse.json(
      { ok: false, error: "Only Robinhood Chain and Ethereum mainnet are supported." },
      { status: 400 },
    );
  }
  if (!body.to || !isHex(body.to)) {
    return NextResponse.json({ ok: false, error: "Invalid to address" }, { status: 400 });
  }
  if (body.data != null && !isHex(body.data)) {
    return NextResponse.json({ ok: false, error: "Invalid data" }, { status: 400 });
  }
  try {
    const hash = await signAndSendAgentCustodialEvmTransaction({
      agentDbId: id,
      to: body.to,
      data: body.data,
      value: body.value ? BigInt(body.value) : BigInt(0),
      gas: body.gas ? BigInt(body.gas) : undefined,
      expectedAddress: body.expectedAddress ?? evm.address,
      chainId,
    });
    return NextResponse.json({ ok: true, hash, chainId });
  } catch (error) {
    console.error("[evm-wallet/send-tx]", error);
    return NextResponse.json(
      { ok: false, error: Error.isError(error) ? error.message : "Send failed" },
      { status: 500 },
    );
  }
}
