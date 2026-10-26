import { NextResponse } from "next/server";
import { loadDashboardSupportUnreadCount } from "@/lib/dashboard/account-support.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({ unread: await loadDashboardSupportUnreadCount() });
  } catch {
    return NextResponse.json({ unread: 0 });
  }
}
