/**
 * POST /api/dashboard/agents/[agentDbId]/evm-wallet/setup
 * Provisions a custodial EVM wallet (default) or associates a Privy wallet.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import {
  associateAgentEvmWallet,
  getAgentEvmWallet,
  markEvmWalletCreating,
  markEvmWalletFailed,
  provisionAgentCustodialEvmWallet,
} from "@/lib/agent-evm-wallet.server";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
export async function POST(request: Request, context: RouteContext) {
  try {
    const { agentDbId } = await context.params;
    const id = Number.parseInt(agentDbId, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "Invalid agent id" }, { status: 400 });
    }
    let session;
    try {
      session = await getServerSession(authOptions);
    } catch (authErr) {
      console.error("[evm-wallet/setup] getServerSession failed:", authErr);
      return NextResponse.json({ ok: false, error: "Session lookup failed" }, { status: 500 });
    }
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    let profile;
    try {
      profile = await ensureMinimalUserProfile(session);
    } catch (profileErr) {
      console.error("[evm-wallet/setup] ensureMinimalUserProfile failed:", profileErr);
      return NextResponse.json({ ok: false, error: "User profile lookup failed" }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 401 });
    }
    let agent;
    try {
      agent = await prisma.agent.findFirst({
        where: {
          AND: [
            { id },
            { isActive: true },
            buildOwnedAgentsWhere({
              id: profile.id,
              walletAddress: profile.walletAddress,
              solanaWallet: profile.solanaWallet,
            }),
          ],
        },
        select: { id: true, evmWalletAddress: true, evmWalletStatus: true },
      });
    } catch (dbErr) {
      console.error("[evm-wallet/setup] Agent lookup failed:", dbErr);
      return NextResponse.json({ ok: false, error: "Database error during agent lookup" }, { status: 500 });
    }
    if (!agent) {
      return NextResponse.json(
        { ok: false, error: "Agent not found or not owned by you" },
        { status: 404 },
      );
    }
    if (agent.evmWalletAddress && agent.evmWalletStatus === "active") {
      const existing = await getAgentEvmWallet(id);
      return NextResponse.json({
        ok: true,
        alreadyConfigured: true,
        configured: true,
        address: existing.address,
        provider: existing.provider,
        isCustodial: existing.isCustodial,
        status: "active",
      });
    }
    let body: { mode?: string; address?: string; privyWalletId?: string } = {};
    try {
      const raw = await request.text();
      if (raw) {
        body = JSON.parse(raw) as typeof body;
      }
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
    const wantsPrivy =
      body.mode === "privy" ||
      (typeof body.address === "string" && typeof body.privyWalletId === "string");
    if (wantsPrivy) {
      const { address, privyWalletId } = body;
      if (!address || typeof address !== "string" || !address.startsWith("0x")) {
        return NextResponse.json({ ok: false, error: "Invalid EVM address" }, { status: 400 });
      }
      if (!privyWalletId || typeof privyWalletId !== "string") {
        return NextResponse.json({ ok: false, error: "Missing privyWalletId" }, { status: 400 });
      }
      let wallet;
      try {
        await markEvmWalletCreating(id);
        wallet = await associateAgentEvmWallet(id, address, privyWalletId);
      } catch (persistErr) {
        try {
          await markEvmWalletFailed(id);
        } catch (stateError) {
          throw new AggregateError(
            [persistErr, stateError],
            "Privy wallet persistence failed and its failure state could not be recorded",
          );
        }
        const message = Error.isError(persistErr) ? persistErr.message : "Failed to persist";
        console.error("[evm-wallet/setup] Privy persist failed:", persistErr);
        return NextResponse.json({ ok: false, error: message }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        configured: true,
        address: wallet.address,
        privyWalletId: wallet.privyWalletId,
        provider: wallet.provider,
        isCustodial: false,
        status: wallet.status,
      });
    }
    // Default: custodial (one-click, no Privy)
    let wallet;
    try {
      await markEvmWalletCreating(id);
      wallet = await provisionAgentCustodialEvmWallet(id, profile.id);
    } catch (persistErr) {
      try {
        await markEvmWalletFailed(id);
      } catch (stateError) {
        throw new AggregateError(
          [persistErr, stateError],
          "Custodial wallet provisioning failed and its failure state could not be recorded",
        );
      }
      const message = Error.isError(persistErr) ? persistErr.message : "Failed to provision";
      console.error("[evm-wallet/setup] Custodial provision failed:", persistErr);
      return NextResponse.json({ ok: false, error: message }, { status: 503 });
    }
    if (!wallet.configured || !wallet.address) {
      return NextResponse.json({ ok: false, error: "Could not provision EVM wallet" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      configured: true,
      address: wallet.address,
      provider: wallet.provider,
      isCustodial: true,
      status: wallet.status,
    });
  } catch (err) {
    console.error("[evm-wallet/setup] Unhandled error:", err);
    return NextResponse.json(
      { ok: false, error: Error.isError(err) ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
