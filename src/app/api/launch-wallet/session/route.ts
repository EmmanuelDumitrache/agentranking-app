import { NextResponse } from "next/server";
import { readLaunchWalletSessionSnapshot } from "@/lib/launch-wallet-session/snapshot.server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, ...(await readLaunchWalletSessionSnapshot()) });
}
