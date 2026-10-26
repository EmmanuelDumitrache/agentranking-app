import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIp } from "@/lib/public-api-rate-limit";
import { slidingWindowLimit } from "@/lib/valkey";

async function limitOrNull(
  request: NextRequest,
  input: { readonly prefix: string; readonly limit: number },
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const result = await slidingWindowLimit({
    key: `${input.prefix}:${ip}`,
    limit: input.limit,
    windowMs: 10 * 60_000,
  });
  if (result.success) return null;
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export function rateLimitLaunchWalletNonce(
  request: NextRequest,
): Promise<NextResponse | null> {
  return limitOrNull(request, {
    prefix: "ratelimit:launch-wallet-nonce",
    limit: 20,
  });
}

export function rateLimitLaunchWalletVerify(
  request: NextRequest,
): Promise<NextResponse | null> {
  return limitOrNull(request, {
    prefix: "ratelimit:launch-wallet-verify",
    limit: 30,
  });
}
