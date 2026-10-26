import { NextResponse } from "next/server";
import { destroyLaunchWalletSession } from "@/lib/launch-wallet-session/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await destroyLaunchWalletSession();
  return NextResponse.json({ ok: true });
}
