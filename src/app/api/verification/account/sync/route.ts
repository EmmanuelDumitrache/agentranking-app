import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { syncAccountVerificationFromProvider } from "@/lib/verification/account-verification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await syncAccountVerificationFromProvider(auth.appAccountId);
    if (!snapshot) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({
      verification: snapshot.credential,
      isVerified: snapshot.isVerified,
      status: snapshot.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to sync verification" },
      { status: 500 },
    );
  }
}
