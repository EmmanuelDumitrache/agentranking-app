import { NextRequest, NextResponse } from "next/server";
import { getDashboardAuthBaseUrl } from "@/lib/dashboard/auth-base-url";
import { confirmDashboardEmailToken } from "@/lib/dashboard/email-confirm.server";

export const dynamic = "force-dynamic";

function requestAuthBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  if (!host) return getDashboardAuthBaseUrl();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "https";
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  const base = requestAuthBaseUrl(request);
  if (!token) {
    return NextResponse.redirect(`${base}/dashboard/auth/confirm?error=missing`);
  }
  try {
    const result = await confirmDashboardEmailToken(token);
    if (!result.ok) {
      return NextResponse.redirect(`${base}/dashboard/auth/confirm?error=${result.reason}`);
    }
    const params = new URLSearchParams({ email: result.email, confirmed: "1" });
    return NextResponse.redirect(`${base}/dashboard/auth/confirm?${params.toString()}`);
  } catch (err) {
    console.error("[dashboard/auth/confirm]", err);
    return NextResponse.redirect(`${base}/dashboard/auth/confirm?error=invalid`);
  }
}
