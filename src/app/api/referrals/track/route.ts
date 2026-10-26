import { hash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeReferralBuyerWallet } from "@/lib/referral-commission";
import { extractReferralCodeFromInput } from "@/lib/referral-code-utils";
import { findActiveArReferralCodeForOwner } from "@/lib/referral-db";
import { getStakeSiteUrl } from "@/lib/site-url";
import { requireLaunchWalletSessionForAddress } from "@/lib/launch-wallet-session/request-auth.server";
export const dynamic = "force-dynamic";
function clean(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalizeWallet(value: unknown): string {
  const s = clean(value, 140);
  return s ? normalizeReferralBuyerWallet(s) : "";
}
function shortHash(value: string): string {
  if (!value) return "";
  return hash("sha256", value, "hex").slice(0, 32);
}
async function generateCode(ownerWallet: string): Promise<string> {
  const stem = ownerWallet.replaceAll(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase() || "ar";
  for (let i = 0; i < 5; i++) {
    const code = `${stem}-${randomBytes(3).toString("hex")}`;
    const exists = await prisma.arReferralCode.findUnique({ where: { code } });
    if (!exists) return code;
  }
  return `${stem}-${Date.now().toString(36)}`;
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = clean(body.action, 40);
    if (action === "ensure_code") {
      const ownerWallet = normalizeWallet(body.ownerWallet);
      const ownerRaw = clean(body.ownerWallet, 140);
      if (!ownerWallet) return NextResponse.json({ error: "ownerWallet is required" }, { status: 400 });
      const access = await requireLaunchWalletSessionForAddress(request, "solana", ownerWallet);
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error, code: "WALLET_SESSION_REQUIRED" },
          { status: access.status },
        );
      }
      const existing = await findActiveArReferralCodeForOwner(prisma, access.wallet, ownerRaw);
      if (existing) return NextResponse.json({ code: existing.code, url: `/r/${existing.code}` });
      const code = await generateCode(access.wallet);
      await prisma.arReferralCode.create({
        data: {
          code,
          ownerWallet: access.wallet,
          destination: clean(body.destination, 240) || getStakeSiteUrl(),
        },
      });
      return NextResponse.json({ code, url: `/r/${code}` });
    }
    // Store a subscription intent so the Helio webhook can pick up the referral code
    // when the subscription activates (no Order record exists for subscription flow).
    if (action === "subscription_intent") {
      const codeRaw = typeof body.code === "string" ? body.code.trim() : "";
      const code = extractReferralCodeFromInput(codeRaw).slice(0, 80);
      const referredWallet = normalizeWallet(body.referredWallet);
      const referredEmail = clean(body.referredEmail, 200).toLowerCase();
      if (!code) return NextResponse.json({ ok: true });
      const referral = await prisma.arReferralCode.findUnique({ where: { code } });
      if (!referral?.isActive) return NextResponse.json({ ok: true });
      const isSelf = Boolean(referredWallet) && referredWallet === normalizeReferralBuyerWallet(referral.ownerWallet);
      if (isSelf) return NextResponse.json({ ok: true });
      const key = referredWallet || referredEmail || `anon-${shortHash(code)}`;
      await prisma.arReferralEvent.upsert({
        where: {
          referralCodeId_referredWallet_eventType: {
            referralCodeId: referral.id,
            referredWallet: key,
            eventType: "subscription_intent",
          },
        },
        create: {
          referralCodeId: referral.id,
          referrerWallet: referral.ownerWallet,
          referredWallet: key,
          eventType: "subscription_intent",
          conversionStatus: "pending",
        },
        update: { conversionStatus: "pending" },
      });
      return NextResponse.json({ ok: true });
    }
    const bodyCode = typeof body.code === "string" ? body.code.trim() : "";
    const cookieCode = request.cookies.get("ar_ref")?.value?.trim() ?? "";
    const code = extractReferralCodeFromInput(bodyCode || cookieCode).slice(0, 80);
    if (!code) return NextResponse.json({ ok: true, counted: false });
    const referral = await prisma.arReferralCode.findUnique({ where: { code } });
    if (referral?.isActive !== true) return NextResponse.json({ ok: true, counted: false });
    const referredWallet = normalizeWallet(body.referredWallet);
    const eventType = clean(body.eventType, 40) || "visit";
    const selfReferral = Boolean(referredWallet) && referredWallet === normalizeReferralBuyerWallet(referral.ownerWallet);
    const ipHash = shortHash(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "");
    const userAgentHash = shortHash(request.headers.get("user-agent") ?? "");
    const syntheticWallet = referredWallet || `anon:${ipHash}:${userAgentHash}`;
    const conversionStatus = eventType === "visit" ? "pending" : "qualified";
    await prisma.arReferralEvent.upsert({
      where: {
        referralCodeId_referredWallet_eventType: {
          referralCodeId: referral.id,
          referredWallet: syntheticWallet,
          eventType,
        },
      },
      create: {
        referralCodeId: referral.id,
        referrerWallet: referral.ownerWallet,
        referredWallet: syntheticWallet,
        eventType,
        conversionStatus: selfReferral ? "disqualified" : conversionStatus,
        ipHash,
        userAgentHash,
        spamReason: selfReferral ? "Self referral" : "",
      },
      update: {
        conversionStatus: selfReferral ? "disqualified" : conversionStatus,
        spamReason: selfReferral ? "Self referral" : "",
      },
    });
    return NextResponse.json({ ok: true, counted: !selfReferral });
  } catch (err) {
    console.error("[referrals/track] error:", err);
    return NextResponse.json({ error: "Failed to track referral" }, { status: 500 });
  }
}
