import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getAccountVerification,
  getPaymentEligibility,
} from "@/lib/verification/account-verification-service";
import { isVerificationDevToolsActive, isVerificationEnabled } from "@/lib/verification/config";
import { getRegistryAnchorStatus } from "@/lib/verification/registry-anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const snapshot = await getAccountVerification(auth.appAccountId);
  if (!snapshot) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const eligibility = getPaymentEligibility(snapshot);
  const registryAnchor = await getRegistryAnchorStatus(auth.appAccountId);

  return NextResponse.json({
    enabled: isVerificationEnabled(),
    devBypassAvailable: isVerificationDevToolsActive(session?.user?.email),
    verification: snapshot.credential,
    isVerified: snapshot.isVerified,
    eligibility,
    registryAnchor,
  });
}
