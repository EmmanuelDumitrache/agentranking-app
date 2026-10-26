import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/**
 * Legacy endpoint retained for compatibility.
 *
 * Caller-supplied wallet/pool/nonce data is not authoritative enough to mark a
 * stake as closed. The stake synchronisation worker reconciles closed
 * Streamflow positions from chain state instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Client unstake reporting is disabled; on-chain reconciliation is authoritative.",
      code: "ONCHAIN_RECONCILIATION_REQUIRED",
    },
    { status: 410 },
  );
}
