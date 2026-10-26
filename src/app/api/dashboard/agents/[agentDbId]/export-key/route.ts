/**
 * GET /api/dashboard/agents/[agentDbId]/export-key?chain=solana|evm
 * Exports the agent's custodial wallet private key.
 * Solana → base58 secret key. EVM → 0x-prefixed hex.
 * Requires authentication and agent ownership.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { bytesToHex } from "viem";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { prisma } from "@/lib/db";
import { decryptSecretBytes } from "@/lib/custodial-wallet/crypto";
import { logCustodialWalletAudit } from "@/lib/custodial-wallet/audit";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
type ExportChain = "solana" | "evm";
function parseChain(request: Request): ExportChain {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("chain") ?? "solana").trim().toLowerCase();
  return raw === "evm" ? "evm" : "solana";
}
export async function GET(request: Request, context: RouteContext) {
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
  const chain = parseChain(request);
  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        agentWalletId: true,
        agentEvmWalletId: true,
        evmWalletProvider: true,
      },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const walletId =
      chain === "evm" ? agent.agentEvmWalletId : agent.agentWalletId;
    if (chain === "evm" && agent.evmWalletProvider && agent.evmWalletProvider !== "custodial") {
      return NextResponse.json(
        {
          error:
            "This EVM wallet is managed by an external provider and cannot be exported here.",
        },
        { status: 400 },
      );
    }
    if (!walletId) {
      return NextResponse.json(
        { error: `No custodial ${chain === "evm" ? "EVM" : "Solana"} wallet found for this agent` },
        { status: 404 },
      );
    }
    const wallet = await prisma.custodialWallet.findFirst({
      where: {
        id: walletId,
        scope: "AGENT",
        chain: chain === "evm" ? "evm" : "solana",
      },
      select: {
        id: true,
        publicKey: true,
        encryptedSecret: true,
        chain: true,
      },
    });
    if (!wallet || !wallet.encryptedSecret) {
      return NextResponse.json(
        { error: `No custodial ${chain === "evm" ? "EVM" : "Solana"} wallet found for this agent` },
        { status: 404 },
      );
    }
    const secret = decryptSecretBytes(wallet.encryptedSecret);
    let key: string;
    if (chain === "evm") {
      key = bytesToHex(secret);
    } else {
      const keypair = Keypair.fromSecretKey(secret);
      key = bs58.encode(keypair.secretKey);
    }
    await logCustodialWalletAudit(wallet.id, "export_key_api", {
      actorProfileId: access.profileId ?? undefined,
      metadata: { agentDbId: id, chain },
    });
    return NextResponse.json({ key, chain });
  } catch (err) {
    console.error("[export-key]", err);
    return NextResponse.json(
      { error: "Failed to export key" },
      { status: 500 },
    );
  }
}
