/**
 * GET /api/dashboard/evm-wallets/assigned
 * Returns EVM wallets already linked to the current user's agents.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { listAssignedEvmWalletsForProfile } from "@/lib/agent-evm-wallet.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    const profile = await ensureMinimalUserProfile(session);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 401 });
    }
    const assigned = await listAssignedEvmWalletsForProfile({
      id: profile.id,
      walletAddress: profile.walletAddress,
      solanaWallet: profile.solanaWallet,
    });
    return NextResponse.json({
      ok: true,
      assigned,
      addresses: assigned.map((row) => row.address),
    });
  } catch (err) {
    console.error("[evm-wallets/assigned] Failed:", err);
    return NextResponse.json(
      { ok: false, error: Error.isError(err) ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
