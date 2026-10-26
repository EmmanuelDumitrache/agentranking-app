import { NextRequest, NextResponse } from "next/server";
import { getRobinhoodLaunchByAddress } from "@/lib/robinhood-chain/record-launch.server";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ address: string }> };
export async function GET(_request: NextRequest, context: RouteContext) {
  const { address } = await context.params;
  const launch = await getRobinhoodLaunchByAddress(address);
  if (!launch) {
    return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, launch });
}