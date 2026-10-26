import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { loadAppAccountWalletRow } from "@/lib/custodial-wallet/read";
import { serializeCustodialWalletPublic } from "@/lib/custodial-wallet/serialize";
import {
  describeCustodialProvisionError,
  getCustodialProvisionBlocker,
} from "@/lib/custodial-wallet/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await getDashboardUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Profile required" }, { status: 403 });
  }
  const row = await loadAppAccountWalletRow(profile.id);
  if (!row) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!row.public_key) {
    const blocker = getCustodialProvisionBlocker();
    return NextResponse.json({
      wallet: null,
      provisionBlocked: blocker.ok
        ? "Account wallet is not provisioned yet."
        : describeCustodialProvisionError(blocker.code),
      credits: {
        platform: row.platform_credits,
        llm: row.llm_credits,
      },
      maxAgents: row.max_agents,
    });
  }
  return NextResponse.json({
    wallet: serializeCustodialWalletPublic({
      publicKey: row.public_key,
      scope: "ACCOUNT",
      balanceLamports: row.cached_sol_balance_lamports,
    }),
    credits: {
      platform: row.platform_credits,
      llm: row.llm_credits,
    },
    maxAgents: row.max_agents,
  });
}
