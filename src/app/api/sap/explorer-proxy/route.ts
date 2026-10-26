import { NextResponse } from "next/server";
import {
  getOobeExplorerStatus,
  getOobeNetworkMetrics,
  getOobeVolume,
  getOobeVolumeDaily,
  getOobeEscrowAlerts,
} from "@/lib/oobe-explorer-client";
export const dynamic = "force-dynamic";
/**
 * Server-side aggregated OOBE Explorer snapshot for debugging or internal tools.
 * Not used by the `/sap` page (that uses RSC + same lib directly).
 */
export async function GET() {
  try {
    const [status, metrics, volume, volumeDaily, alerts] = await Promise.all([
      getOobeExplorerStatus().catch((e) => ({ error: Error.isError(e) ? e.message : String(e) })),
      getOobeNetworkMetrics().catch((e) => ({ error: Error.isError(e) ? e.message : String(e) })),
      getOobeVolume().catch((e) => ({ error: Error.isError(e) ? e.message : String(e) })),
      getOobeVolumeDaily({ days: 14 }).catch((e) => ({ error: Error.isError(e) ? e.message : String(e) })),
      getOobeEscrowAlerts().catch((e) => ({ error: Error.isError(e) ? e.message : String(e) })),
    ]);
    return NextResponse.json({ status, networkMetrics: metrics, volume, volumeDaily, escrowsAlerts: alerts });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
