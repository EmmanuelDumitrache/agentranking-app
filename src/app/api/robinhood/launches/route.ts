import { NextRequest, NextResponse } from "next/server";
import { listRobinhoodLaunches } from "@/lib/robinhood-chain/record-launch.server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const launches = await listRobinhoodLaunches(limit);
  return NextResponse.json({ ok: true, launches });
}