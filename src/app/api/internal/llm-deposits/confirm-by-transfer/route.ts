import { PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findMatchingPendingDeposits } from "@/lib/llm-credits/deposits";
import { settleDeposit } from "@/lib/llm-credits/settlement";
import {
  isInternalBearerSecretConfigured,
  verifyInternalBearer,
} from "@/lib/internal-bearer-auth";
export const dynamic = "force-dynamic";
type ConfirmTransferBody = {
  signature?: unknown;
  from?: unknown;
  to?: unknown;
  amountAtomic?: unknown;
  asset?: unknown;
  slot?: unknown;
};
function requiredString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximumLength ? trimmed : null;
}
function canonicalPublicKey(value: string, label: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`Invalid ${label} public key`);
  }
}
export async function POST(request: NextRequest) {
  const watcherSecret = process.env.PAYMENT_WATCHER_SECRET?.trim() ?? "";
  if (!isInternalBearerSecretConfigured(watcherSecret)) {
    console.error("[confirm-by-transfer] PAYMENT_WATCHER_SECRET is missing or too short");
    return NextResponse.json({ error: "Payment watcher is not configured" }, { status: 503 });
  }
  if (!verifyInternalBearer(request.headers.get("authorization"), watcherSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let body: ConfirmTransferBody;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
      }
      body = parsed as ConfirmTransferBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const signature = requiredString(body.signature, 128);
    const fromRaw = requiredString(body.from, 64);
    const toRaw = requiredString(body.to, 64);
    const amountAtomicRaw = requiredString(body.amountAtomic, 80);
    const asset = requiredString(body.asset, 16)?.toUpperCase();
    const slotRaw = typeof body.slot === "number" && Number.isSafeInteger(body.slot)
      ? String(body.slot)
      : requiredString(body.slot, 32);
    if (!signature || !fromRaw || !toRaw || !amountAtomicRaw || !asset || !slotRaw) {
      return NextResponse.json(
        { error: "Missing or invalid required fields: signature, from, to, amountAtomic, asset, slot" },
        { status: 400 },
      );
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      return NextResponse.json({ error: "Invalid Solana transaction signature" }, { status: 400 });
    }
    if (asset !== "SOL" && asset !== "USDC") {
      return NextResponse.json({ error: "Unsupported deposit asset" }, { status: 400 });
    }
    const from = canonicalPublicKey(fromRaw, "sender");
    const to = canonicalPublicKey(toRaw, "recipient");
    let amountAtomic: bigint;
    let slot: bigint;
    try {
      amountAtomic = BigInt(amountAtomicRaw);
      slot = BigInt(slotRaw);
    } catch {
      return NextResponse.json({ error: "amountAtomic and slot must be integers" }, { status: 400 });
    }
    if (amountAtomic <= 0n || slot < 0n) {
      return NextResponse.json({ error: "amountAtomic must be positive and slot non-negative" }, { status: 400 });
    }
    const existingDeposit = await prisma.llmCreditDeposit.findUnique({ where: { signature } });
    if (existingDeposit) {
      return NextResponse.json({
        matched: false,
        reason: "already_processed",
        depositId: existingDeposit.id,
      });
    }
    const candidates = await prisma.$transaction((tx) =>
      findMatchingPendingDeposits(tx, {
        recipientPublicKey: to,
        asset,
        receivedAmountAtomic: amountAtomic,
      }),
    );
    if (candidates.length === 0) {
      return NextResponse.json({ matched: false, reason: "no_matching_deposit" });
    }
    let lastReason = "no_reference_match";
    for (const deposit of candidates) {
      const settlementResult = await settleDeposit(
        deposit.id,
        undefined,
        { providedSignature: signature, providedSlot: slot },
      );
      if (settlementResult.ok) {
        return NextResponse.json({
          matched: true,
          depositId: deposit.id,
          creditedCents: settlementResult.creditedCents,
          sender: from,
        });
      }
      lastReason = settlementResult.reason;
      if (!["no_reference", "wrong_recipient", "validation_failed"].includes(lastReason)) {
        break;
      }
    }
    return NextResponse.json({ matched: false, reason: lastReason });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("[internal/llm-deposits/confirm-by-transfer] Error:", error);
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development"
          ? `Deposit confirmation failed: ${message}`
          : "Unable to confirm deposit. Try again or contact support with the transaction signature.",
      },
      { status: 500 },
    );
  }
}
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
export const PUT = GET;
export const DELETE = GET;
export const PATCH = GET;
