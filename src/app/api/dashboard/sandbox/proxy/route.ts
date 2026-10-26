import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { executeDashboardProxyRequest, type DashboardProxyInput } from "@/lib/dashboard/outbound-proxy";
import {
  HttpBodyTooLargeError,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
export const dynamic = "force-dynamic";
const TIMEOUT_MS = 15_000;
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  let body: DashboardProxyInput;
  try {
    const parsed = await readBoundedJsonBody(request, 128 * 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid JSON object");
    }
    body = parsed as DashboardProxyInput;
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await executeDashboardProxyRequest(body, TIMEOUT_MS, request.signal));
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    const inputError = /URL|required|allowed|unsupported|exceeds|private|local|reserved|credentials/i.test(message);
    return NextResponse.json(
      { error: `Request failed: ${message}` },
      { status: inputError ? 400 : 502 },
    );
  }
}
