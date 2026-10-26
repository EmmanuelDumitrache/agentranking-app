import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import { stakeReportRateLimitOk } from "@/lib/stake-report-rate-limit";
import { verifyStreamflowStakeReport } from "@/lib/streamflow-stake-verify";
export const dynamic = "force-dynamic";
function trim(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function parseIntSafe(value: unknown, fallback = 0): number {
  let raw: number;
  if (typeof value === "number") {
    raw = value;
  } else if (typeof value === "string") {
    raw = Number.parseInt(value, 10);
  } else {
    raw = Number.NaN;
  }
  return Number.isFinite(raw) ? raw : fallback;
}
function parsePositiveRaw(value: unknown): string {
  const s = trim(value, 80).replaceAll(",", "");
  return /^\d+$/.test(s) ? s : "0";
}
function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    ""
  );
}
/**
 * POST /api/token/staking/report-stake
 *
 * Called by the client after a successful Streamflow stake tx.
 * Verifies tx on-chain and allowlisted pool before recording active position.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wallet = normalizeStakeWallet(trim(body.wallet, 200));
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  const txSignature = trim(body.txSignature, 200);
  if (!txSignature) return NextResponse.json({ error: "txSignature is required" }, { status: 400 });
  if (!(await stakeReportRateLimitOk(clientIp(req), wallet))) {
    return NextResponse.json({ error: "Too many stake reports. Try again shortly." }, { status: 429 });
  }
  const existingByTx = await prisma.arStakePosition.findFirst({
    where: { txSignature },
    select: { id: true, wallet: true },
  });
  if (existingByTx) {
    if (existingByTx.wallet !== wallet) {
      return NextResponse.json({ error: "Transaction already recorded for another wallet." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, positionId: existingByTx.id, duplicate: true });
  }
  const nonce = parseIntSafe(body.nonce, 0);
  const durationSec = parseIntSafe(body.durationSec, 0);
  const poolAddress = trim(body.poolAddress, 200);
  const mintAddress = trim(body.mintAddress, 200);
  const amountRaw = parsePositiveRaw(body.amountRaw);
  const amountUi = trim(body.amountUi, 80);
  const verified = await verifyStreamflowStakeReport({
    wallet,
    txSignature,
    poolAddress,
    mintAddress,
    amountRaw,
    durationSec,
  });
  if (!verified.ok) {
    console.warn("[report-stake] verification failed:", verified.error, { wallet, txSignature });
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const now = new Date();
  const lockStartAt = now;
  const lockEndAt = verified.lockEndAt;
  try {
    const position = await prisma.arStakePosition.upsert({
      where: { wallet_nonce_poolAddress: { wallet, nonce, poolAddress } },
      create: {
        wallet,
        poolAddress,
        mintAddress,
        amountRaw,
        amountUi,
        nonce,
        durationSec,
        lockStartAt,
        lockEndAt,
        txSignature,
        status: "active",
        source: "verified",
        lastSyncedAt: now,
      },
      update: {
        mintAddress,
        amountRaw,
        amountUi,
        durationSec,
        lockStartAt,
        lockEndAt,
        txSignature,
        status: "active",
        source: "verified",
        lastSyncedAt: now,
      },
    });
    return NextResponse.json({ ok: true, positionId: position.id });
  } catch (err) {
    console.error("[report-stake] error:", err);
    return NextResponse.json({ error: "Failed to record stake position" }, { status: 500 });
  }
}
