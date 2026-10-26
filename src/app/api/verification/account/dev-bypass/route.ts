import type { AccountVerificationLevel } from "@/generated/prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { devSetAccountVerificationState } from "@/lib/verification/account-verification-service";
import { isVerificationDevToolsActive } from "@/lib/verification/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LEVELS = new Set<AccountVerificationLevel>(["NONE", "INDIVIDUAL", "BUSINESS"]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isVerificationDevToolsActive(session.user?.email)) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let level: AccountVerificationLevel = "INDIVIDUAL";
  let kycComplete = true;
  try {
    const body = (await request.json()) as { level?: string; kycComplete?: boolean };
    if (body.level && ALLOWED_LEVELS.has(body.level as AccountVerificationLevel)) {
      level = body.level as AccountVerificationLevel;
    }
    if (typeof body.kycComplete === "boolean") {
      kycComplete = body.kycComplete;
    } else {
      kycComplete = level !== "NONE";
    }
  } catch {
    // Empty body — default to verified individual.
  }

  try {
    const snapshot = await devSetAccountVerificationState(auth.appAccountId, {
      level,
      kycComplete,
    });
    return NextResponse.json({
      ok: true,
      level: snapshot?.level ?? level,
      isVerified: snapshot?.isVerified ?? false,
      status: snapshot?.status ?? "UNVERIFIED",
      verification: snapshot?.credential ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dev bypass failed" },
      { status: 500 },
    );
  }
}
