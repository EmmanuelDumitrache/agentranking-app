import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { createVerificationSession, VerificationAlreadyCompleteError } from "@/lib/verification/account-verification-service";
import { isVerificationEnabled } from "@/lib/verification/config";
import { appAbsoluteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  if (!isVerificationEnabled()) {
    return NextResponse.json({ error: "Verification is disabled" }, { status: 503 });
  }

  try {
    const returnUrl = `${appAbsoluteUrl("/dashboard/verify")}?status=complete`;
    const sessionInfo = await createVerificationSession({
      appAccountId: auth.appAccountId,
      returnUrl,
    });

    return NextResponse.json({
      sessionId: sessionInfo.sessionId,
      url: sessionInfo.url,
      provider: sessionInfo.provider,
      embedded: sessionInfo.embedded ?? null,
    });
  } catch (err) {
    if (err instanceof VerificationAlreadyCompleteError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start verification" },
      { status: 500 },
    );
  }
}
