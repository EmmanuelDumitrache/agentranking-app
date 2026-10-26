import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import {
  fetchWalletStreamflowStakePositions,
  resolveStreamflowPoolAddress,
  syncStreamflowPositionsToDatabase,
  type WalletStakePositionView,
} from "@/lib/streamflow-wallet-stakes";
export const dynamic = "force-dynamic";
function mapDbPosition(
  p: {
    id: string;
    poolAddress: string;
    mintAddress: string;
    stakeAccount: string;
    amountUi: string;
    amountRaw: string | null;
    nonce: number;
    durationSec: number;
    lockStartAt: Date | null;
    lockEndAt: Date | null;
    txSignature: string;
    createdAt: Date;
  },
): WalletStakePositionView {
  return {
    id: p.id,
    poolAddress: p.poolAddress,
    mintAddress: p.mintAddress,
    stakeAccount: p.stakeAccount,
    amountUi: p.amountUi,
    amountRaw: p.amountRaw ?? "0",
    nonce: p.nonce,
    durationSec: p.durationSec,
    lockStartAt: p.lockStartAt?.toISOString() ?? null,
    lockEndAt: p.lockEndAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    txSignature: p.txSignature,
    source: "database",
  };
}
/** GET /api/token/staking/positions?wallet= — active stakes (Streamflow on-chain + DB fallback) */
export async function GET(req: NextRequest) {
  const wallet = normalizeStakeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json({ error: "wallet query parameter is required" }, { status: 400 });
  }
  const poolAddress = resolveStreamflowPoolAddress();
  let onChain: WalletStakePositionView[] = [];
  let onChainError: string | null = null;
  try {
    onChain = await fetchWalletStreamflowStakePositions(
      wallet,
      req.nextUrl.searchParams.get("refresh") === "1" ? { skipCache: true } : undefined,
    );
    if (onChain.length > 0) {
      await syncStreamflowPositionsToDatabase(wallet, onChain);
    }
  } catch (e) {
    onChainError = Error.isError(e) ? e.message : "Could not read stakes from Streamflow";
  }
  const byNonce = new Map<number, WalletStakePositionView>();
  for (const row of onChain) {
    byNonce.set(row.nonce, row);
  }
  if (onChain.length === 0) {
    const dbRows = await prisma.arStakePosition.findMany({
      where: { wallet, status: "active", poolAddress },
      orderBy: [{ lockEndAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        poolAddress: true,
        mintAddress: true,
        stakeAccount: true,
        amountUi: true,
        amountRaw: true,
        nonce: true,
        durationSec: true,
        lockStartAt: true,
        lockEndAt: true,
        txSignature: true,
        createdAt: true,
      },
    });
    for (const row of dbRows) {
      byNonce.set(row.nonce, mapDbPosition(row));
    }
  }
  const positions = [...byNonce.values()].sort((a, b) => {
    const aEnd = a.lockEndAt ? new Date(a.lockEndAt).getTime() : 0;
    const bEnd = b.lockEndAt ? new Date(b.lockEndAt).getTime() : 0;
    return aEnd - bEnd;
  });
  return NextResponse.json({
    wallet,
    poolAddress,
    positions,
    onChainCount: onChain.length,
    onChainError,
    generatedAt: new Date().toISOString(),
  });
}
