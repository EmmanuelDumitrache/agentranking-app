import { NextResponse } from "next/server";
import {
  DashboardAccountReadError,
  loadDashboardAccountSettings,
} from "@/lib/dashboard/account-settings.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await loadDashboardAccountSettings());
  } catch (error) {
    const status = error instanceof DashboardAccountReadError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load account summary";
    return NextResponse.json({ error: message }, { status });
  }
}
