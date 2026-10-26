import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { enqueueAgentLaunchFeeDistribution } from "@/lib/agent-launch/fee-distribution-jobs";
export const dynamic = "force-dynamic";
async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
/**
 * Admin-only recovery producer. Signing remains isolated in agentranking-worker.
 * The recovery mode bypasses normal indexed/lifecycle eligibility checks but
 * retains network, mint, fee-bot, and on-chain idempotency guards.
 */
export async function POST(request: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  try {
    const body = (await request.json()) as {
      mint?: string;
      network?: string;
      confirm?: boolean;
    };
    const mint = body.mint?.trim();
    const network = body.network?.trim();
    if (!mint) {
      return NextResponse.json({ error: "mint is required" }, { status: 400 });
    }
    if (!network) {
      return NextResponse.json({ error: "network is required" }, { status: 400 });
    }
    try {
      new PublicKey(mint);
    } catch {
      return NextResponse.json({ error: "Invalid Solana mint address" }, { status: 400 });
    }
    if (network !== "mainnet-beta" && network !== "devnet") {
      return NextResponse.json(
        { error: "network must be mainnet-beta or devnet" },
        { status: 400 },
      );
    }
    if (network === "mainnet-beta" && body.confirm !== true) {
      return NextResponse.json(
        {
          error:
            'mainnet distribution requires explicit confirmation — include "confirm": true in request body',
          mint,
          network,
        },
        { status: 400 },
      );
    }
    const launch = await prisma.agentLaunch.findFirst({
      where: { mint, network },
      orderBy: { createdAt: "desc" },
    });
    if (!launch) {
      return NextResponse.json(
        { error: "No launch record found for this mint/network" },
        { status: 404 },
      );
    }
    const queued = await enqueueAgentLaunchFeeDistribution(launch.id, "recovery");
    return NextResponse.json(
      {
        status: "queued",
        launchId: launch.id,
        mint,
        network,
        jobId: queued.jobId,
        accepted: queued.accepted,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Recovery distribution enqueue failed";
    console.error("[admin-recover-distribute-fees]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
