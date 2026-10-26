import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  allowedStreamflowStakePools,
  stakingPageSolanaClusterLabel,
} from "@/lib/streamflow-stake-config";
import { isArStakingSetupToolsEnabled } from "@/lib/ar-token-staking-public";
export const dynamic = "force-dynamic";
/** GET /api/token/staking/config — runtime server env check (for ops banners; client still needs rebuild for NEXT_PUBLIC). */
export async function GET() {
  const host = (await headers()).get("host");
  const allowed = allowedStreamflowStakePools();
  return NextResponse.json({
    stakingOpen: true,
    poolConfigured: Boolean(allowed),
    poolAddress: allowed?.poolAddress ?? "",
    mintAddress: allowed?.mintAddress ?? "",
    clusterLabel: stakingPageSolanaClusterLabel(),
    setupToolsEnabled: isArStakingSetupToolsEnabled(host),
    /** NEXT_PUBLIC_* are baked into the browser bundle at `pnpm run build` — changing .env alone is not enough for the stake form UI. */
    clientBundleNeedsRebuild: true,
  });
}
