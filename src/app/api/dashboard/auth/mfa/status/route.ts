import { NextRequest } from "next/server";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { readMfaStatus } from "@/lib/account-security/mfa-challenge.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readMfaStatus();
  if (!result.ok) {
    return securityJsonResponse({ error: result.error }, { status: result.statusCode });
  }
  return securityJsonResponse(result.status, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** Used by challenge page when session is MFA-pending (same data, no full dashboard auth). */
export async function POST(request: NextRequest) {
  void request;
  return securityJsonResponse({ error: "Method not allowed" }, { status: 405 });
}
