import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { prisma } from "@/lib/db";
import { getDepositConfig } from "@/lib/llm-credits/config";
import { resolveDepositRecipient } from "@/lib/llm-credits/recipient";
import { isSupportedAsset } from "@/lib/llm-credits/assets";
import { createDepositIntent, listDepositsForAccount } from "@/lib/llm-credits/deposits";
import { getSolUsdPrice } from "@/lib/solana-price";
import type { DepositListItem } from "@/lib/llm-credits/types";
import { formatAtomicAmount } from "@/lib/llm-credits/pricing";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export const dynamic = "force-dynamic";
async function getAccountWithWallet(session: Session | null) {
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return null;
  const account = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    include: { accountWallet: true },
  });
  if (!account) return null;
  return account;
}
function serializeDeposit(deposit: {
  id: string;
  status: string;
  asset: string;
  quotedCents: number;
  expectedAmountAtomic: bigint;
  recipientPublicKey: string;
  referencePublicKey: string;
  paymentUrl: string;
  quoteExpiresAt: Date;
  createdAt: Date;
  settledAt: Date | null;
  signature: string | null;
  creditedCents: number | null;
  failureReason: string | null;
}): DepositListItem {
  return {
    id: deposit.id,
    status: deposit.status,
    asset: deposit.asset as DepositListItem["asset"],
    quotedCents: deposit.quotedCents,
    expectedAmountAtomic: deposit.expectedAmountAtomic.toString(),
    displayAmount: formatAtomicAmount(deposit.expectedAmountAtomic, deposit.asset as DepositListItem["asset"]),
    recipientPublicKey: deposit.recipientPublicKey,
    referencePublicKey: deposit.referencePublicKey,
    paymentUrl: deposit.paymentUrl,
    quoteExpiresAt: deposit.quoteExpiresAt.toISOString(),
    createdAt: deposit.createdAt.toISOString(),
    settledAt: deposit.settledAt?.toISOString(),
    signature: deposit.signature ?? undefined,
    creditedCents: deposit.creditedCents ?? undefined,
    failureReason: deposit.failureReason ?? undefined,
  };
}
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const account = await getAccountWithWallet(session);
  if (!account) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const config = getDepositConfig();
  const resolved = resolveDepositRecipient({
    config,
    accountWallet: account.accountWallet
      ? { id: account.accountWallet.id, publicKey: account.accountWallet.publicKey }
      : null,
  });
  if (resolved.recipientType === "ACCOUNT_WALLET" && !account.accountWallet) {
    return NextResponse.json(
      { error: "Account wallet not provisioned", code: "NO_WALLET" },
      { status: 400 },
    );
  }
  let body: { asset?: unknown; cents?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_BODY" },
      { status: 400 },
    );
  }
  const asset = typeof body.asset === "string" ? body.asset : "";
  if (!isSupportedAsset(asset)) {
    return NextResponse.json(
      { error: "Unsupported asset", code: "UNSUPPORTED_ASSET" },
      { status: 400 },
    );
  }
  const cents = typeof body.cents === "number" && Number.isFinite(body.cents) ? Math.floor(body.cents) : 0;
  if (cents <= 0) {
    return NextResponse.json(
      { error: "Invalid amount", code: "INVALID_AMOUNT" },
      { status: 400 },
    );
  }
  const network =
    process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() ||
    process.env.SOLANA_NETWORK?.trim() ||
    "mainnet-beta";
  // Fetch SOL price OUTSIDE the transaction (no RPC inside Prisma tx)
  let solUsdPriceMicros: bigint | undefined;
  if (asset === "SOL") {
    const price = await getSolUsdPrice();
    if (price == null) {
      return NextResponse.json(
        { error: "SOL price unavailable", code: "PRICE_UNAVAILABLE" },
        { status: 503 },
      );
    }
    solUsdPriceMicros = BigInt(Math.round(price * 1_000_000));
  }
  try {
    await getJobProducer();
    const deposit = await prisma.$transaction(async (tx) => {
      const created = await createDepositIntent(tx, {
        appAccountId: account.id,
        asset,
        requestedUsdCents: cents,
        recipientPublicKey: resolved.publicKey,
        network,
        solUsdPriceMicros,
      });
      await enqueueApplicationJobInTx(tx, JOB_QUEUES.LLM_DEPOSIT_EXPIRE, { v: 1, id: created.id }, {
        startAfter: created.quoteExpiresAt,
        singletonKey: created.id,
      });
      await enqueueApplicationJobInTx(tx, JOB_QUEUES.LLM_DEPOSIT_RECONCILE, { v: 1, id: created.id }, {
        startAfter: 15,
        singletonKey: created.id,
      });
      return created;
    });
    return NextResponse.json({
      deposit: serializeDeposit(deposit),
    });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Failed to create deposit";
    return NextResponse.json(
      { error: message, code: "CREATE_FAILED" },
      { status: 400 },
    );
  }
}
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const account = await getAccountWithWallet(session);
  if (!account) {
    return NextResponse.json(
      { error: "Authentication required", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Number.parseInt(searchParams.get("limit") || "20", 10),
    100,
  );
  try {
    const deposits = await listDepositsForAccount(account.id, limit);
    return NextResponse.json({
      deposits: deposits.map(serializeDeposit),
    });
  } catch (err) {
    console.error("[deposits/list] error:", err);
    return NextResponse.json(
      { error: "Failed to list deposits", code: "LIST_FAILED" },
      { status: 500 },
    );
  }
}
