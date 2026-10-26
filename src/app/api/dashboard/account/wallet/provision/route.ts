import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  describeCustodialProvisionError,
  ensureAppAccountWallet,
  getCustodialProvisionBlocker,
} from "@/lib/custodial-wallet/bootstrap";
import { serializeCustodialWalletPublic } from "@/lib/custodial-wallet/serialize";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { loadAppAccountWalletRow } from "@/lib/custodial-wallet/read";
export const dynamic = "force-dynamic";
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Profile required" }, { status: 403 });
  }
  const blocker = getCustodialProvisionBlocker();
  if (!blocker.ok) {
    return NextResponse.json(
      { error: describeCustodialProvisionError(blocker.code) },
      { status: 503 },
    );
  }
  const row = await loadAppAccountWalletRow(profile.id);
  if (!row) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (row.public_key) {
    return NextResponse.json({
      wallet: serializeCustodialWalletPublic({
        publicKey: row.public_key,
        scope: "ACCOUNT",
        balanceLamports: row.cached_sol_balance_lamports,
      }),
      alreadyProvisioned: true,
    });
  }
  const publicKey = await ensureAppAccountWallet(row.account_id, profile.id);
  if (!publicKey) {
    return NextResponse.json(
      { error: "Could not provision account wallet" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    wallet: serializeCustodialWalletPublic({
      publicKey,
      scope: "ACCOUNT",
    }),
    alreadyProvisioned: false,
  });
}
