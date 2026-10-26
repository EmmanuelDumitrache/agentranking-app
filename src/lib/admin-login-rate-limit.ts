import { slidingWindowLimit } from "@/lib/valkey";

const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX_PER_IP = 3;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_PER_IP = 10;

export async function adminLoginRequestRateLimitOk(ip: string): Promise<boolean> {
  const result = await slidingWindowLimit({
    key: `ratelimit:admin-login:request:${ip.trim() || "unknown"}`,
    limit: REQUEST_MAX_PER_IP,
    windowMs: REQUEST_WINDOW_MS,
  });
  return result.success;
}

export async function adminLoginVerifyRateLimitOk(ip: string): Promise<boolean> {
  const result = await slidingWindowLimit({
    key: `ratelimit:admin-login:verify:${ip.trim() || "unknown"}`,
    limit: VERIFY_MAX_PER_IP,
    windowMs: VERIFY_WINDOW_MS,
  });
  return result.success;
}
