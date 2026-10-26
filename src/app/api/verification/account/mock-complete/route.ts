import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  completeMockVerificationSession,
  getPaymentEligibility,
} from "@/lib/verification/account-verification-service";
import { getKycProviderId } from "@/lib/verification/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production" || getKycProviderId() !== "mock") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await completeMockVerificationSession(auth.appAccountId);
    if (!snapshot) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({
      verification: snapshot.credential,
      isVerified: snapshot.isVerified,
      eligibility: getPaymentEligibility(snapshot),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mock verification failed" },
      { status: 500 },
    );
  }
}
