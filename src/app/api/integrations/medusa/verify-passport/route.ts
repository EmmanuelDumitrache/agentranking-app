import { NextRequest, NextResponse } from "next/server";
import { parseMedusaPassportTier } from "@/lib/medusa/metadata";
import { verifyMedusaPassportInput } from "@/lib/medusa/verify-server";
import type { MedusaPassportTier } from "@/lib/medusa/types";
export const dynamic = "force-dynamic";
type VerifyBody = {
  passport?: unknown;
  passportJson?: string;
  minTier?: string | null;
};
export async function POST(request: NextRequest) {
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const passportInput = body.passport ?? body.passportJson;
  if (passportInput == null) {
    return NextResponse.json({ error: "passport or passportJson is required" }, { status: 400 });
  }
  const minTierRaw = body.minTier?.trim();
  const minTier = minTierRaw ? parseMedusaPassportTier(minTierRaw) : undefined;
  if (minTierRaw && !minTier) {
    return NextResponse.json({ error: "Invalid minTier" }, { status: 400 });
  }
  try {
    const result = await verifyMedusaPassportInput(passportInput, {
      ...(minTier ? { minTier } : {}),
    });
    return NextResponse.json({
      valid: result.valid,
      tier: result.tier ?? null,
      tierLabel: result.tierLabel ?? null,
      nullifier: result.nullifier ?? null,
      expiresAt: result.expiresAt ?? null,
      errors: result.errors,
      meetsDeclaredMinTier: result.meetsDeclaredMinTier,
      declaredMinTier: (minTier as MedusaPassportTier | undefined) ?? null,
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Verification failed";
    return NextResponse.json({ error: message, valid: false, errors: [message] }, { status: 400 });
  }
}
