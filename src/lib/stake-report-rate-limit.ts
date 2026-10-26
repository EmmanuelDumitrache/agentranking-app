import { slidingWindowLimitMany } from "@/lib/valkey";

const WINDOW_MS = 60_000;
const MAX_PER_IP = 30;
const MAX_PER_WALLET = 10;

export async function stakeReportRateLimitOk(ip: string, wallet: string): Promise<boolean> {
  const result = await slidingWindowLimitMany([
    {
      key: `ratelimit:stake-report:ip:${ip.trim() || "unknown"}`,
      limit: MAX_PER_IP,
      windowMs: WINDOW_MS,
    },
    {
      key: `ratelimit:stake-report:wallet:${wallet.trim() || "unknown"}`,
      limit: MAX_PER_WALLET,
      windowMs: WINDOW_MS,
    },
  ]);
  return result.success;
}
