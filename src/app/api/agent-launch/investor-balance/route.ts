import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { loadAgentLaunchOrThrow } from "@/lib/agent-launch/launch-access";
import { fetchInvestorTokenBalanceRaw } from "@/lib/agent-launch/pump-buy-sell";
import { parseSolanaPubkey, validateSolanaPubkey } from "@/lib/agent-launch/validation";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const launchId = request.nextUrl.searchParams.get("launchId")?.trim();
    const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const walletError = validateSolanaPubkey(wallet, "Wallet");
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 });
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    if (!launch.mint) {
      return NextResponse.json({ error: "Launch has no mint" }, { status: 400 });
    }
    const mint = parseSolanaPubkey(launch.mint, "Mint");
    const owner = parseSolanaPubkey(wallet!, "Wallet");
    const balanceRaw = await fetchInvestorTokenBalanceRaw(mint, owner);
    return NextResponse.json({
      balanceRaw: balanceRaw.toString(),
      mint: mint.toBase58(),
      wallet: new PublicKey(owner).toBase58(),
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to fetch balance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
