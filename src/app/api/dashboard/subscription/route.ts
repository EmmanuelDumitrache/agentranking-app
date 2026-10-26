import { NextResponse } from "next/server";
import { loadDashboardSubscription } from "@/lib/dashboard/account-subscription.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await loadDashboardSubscription());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load subscription";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
