import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeReferralCode, validateReferralCode } from "@/lib/referral-code-utils";
import { findActiveArReferralCodeForOwner } from "@/lib/referral-db";
import { normalizeReferralOwnerWallet } from "@/lib/referral-owner-wallet";
import { getStakeSiteUrl } from "@/lib/site-url";
import { requireLaunchWalletSessionForAddress } from "@/lib/launch-wallet-session/request-auth.server";
export const dynamic = "force-dynamic";
function cleanWallet(value: unknown): string {
  return typeof value === "string" ? normalizeReferralOwnerWallet(value) : "";
}
/** POST — set or change your referral short code (wallet must own the row). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { ownerWallet?: string; code?: string };
    const ownerWallet = cleanWallet(body.ownerWallet);
    const ownerRaw = typeof body.ownerWallet === "string" ? body.ownerWallet.trim() : "";
    if (!ownerWallet) {
      return NextResponse.json({ error: "ownerWallet is required" }, { status: 400 });
    }
    const access = await requireLaunchWalletSessionForAddress(request, "solana", ownerWallet);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, code: "WALLET_SESSION_REQUIRED" },
        { status: access.status },
      );
    }
    const normalized = normalizeReferralCode(body.code ?? "");
    const validated = validateReferralCode(normalized);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const ownerRow = await findActiveArReferralCodeForOwner(prisma, access.wallet, ownerRaw);
    const mine = ownerRow ? { id: ownerRow.id } : null;
    const taken = await prisma.arReferralCode.findUnique({
      where: { code: validated.code },
      select: { id: true },
    });
    if (taken && taken.id !== mine?.id) {
      return NextResponse.json(
        { error: "That code is already taken. Try another." },
        { status: 409 },
      );
    }
    if (mine) {
      await prisma.arReferralCode.update({
        where: { id: mine.id },
        data: { code: validated.code },
      });
    } else {
      await prisma.arReferralCode.create({
        data: {
          code: validated.code,
          ownerWallet: access.wallet,
          destination: getStakeSiteUrl(),
        },
      });
    }
    return NextResponse.json({ ok: true, code: validated.code, url: `/r/${validated.code}` });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "P2002") {
      return NextResponse.json(
        { error: "That code is already taken. Try another." },
        { status: 409 },
      );
    }
    console.error("[referrals/set-code] error:", err);
    return NextResponse.json({ error: "Could not save code" }, { status: 500 });
  }
}
