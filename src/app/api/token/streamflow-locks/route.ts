import { NextResponse } from "next/server";
import { fetchPublishedStreamflowLocksLive } from "@/lib/streamflow-vesting-live";
export const dynamic = "force-dynamic";
/** GET /api/token/streamflow-locks — live Streamflow vesting lock snapshots (Solana RPC). */
export async function GET() {
  try {
    const payload = await fetchPublishedStreamflowLocksLive();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[token/streamflow-locks] GET error:", err);
    const message = Error.isError(err) ? err.message : "Could not load Streamflow locks";
    return NextResponse.json({ error: message, locks: [], totals: null, fetchedAt: null }, { status: 502 });
  }
}
