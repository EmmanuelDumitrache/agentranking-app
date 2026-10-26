import { NextResponse } from "next/server";
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development" && Error.isError(err)) {
    const msg = err.message;
    if (msg.includes("dashboard_auth_tokens") || msg.includes("email_verified_at")) {
      return `${msg} — run: pnpm exec prisma migrate deploy`;
    }
    return msg;
  }
  return fallback;
}
export function apiErrorResponse(
  err: unknown,
  logLabel: string,
  fallback: string,
  status = 500,
) {
  console.error(logLabel, err);
  return NextResponse.json({ error: apiErrorMessage(err, fallback) }, { status });
}
