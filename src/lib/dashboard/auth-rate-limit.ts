import { createHash } from "node:crypto";
import { slidingWindowLimitMany } from "@/lib/valkey";

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

async function allow(rules: Parameters<typeof slidingWindowLimitMany>[0]): Promise<boolean> {
  return (await slidingWindowLimitMany(rules)).success;
}

function identityKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function dashboardAuthRegisterRateLimitOk(ip: string, email: string): Promise<boolean> {
  const ipKey = ip.trim() || "unknown";
  return allow([
    { key: `ratelimit:dashboard-auth:register:ip:${ipKey}`, limit: 10, windowMs: ONE_HOUR },
    { key: `ratelimit:dashboard-auth:register:email:${identityKey(email)}`, limit: 5, windowMs: ONE_HOUR },
  ]);
}

export function dashboardAuthRequestCodeRateLimitOk(ip: string, email: string): Promise<boolean> {
  const ipKey = ip.trim() || "unknown";
  return allow([
    { key: `ratelimit:dashboard-auth:request:ip:${ipKey}`, limit: 3, windowMs: FIFTEEN_MIN },
    { key: `ratelimit:dashboard-auth:request:email:${identityKey(email)}`, limit: 5, windowMs: FIFTEEN_MIN },
  ]);
}

export async function dashboardAuthVerifyCodeRateLimitOk(ip: string): Promise<boolean> {
  return allow([
    {
      key: `ratelimit:dashboard-auth:verify:ip:${ip.trim() || "unknown"}`,
      limit: 10,
      windowMs: FIFTEEN_MIN,
    },
  ]);
}

export function dashboardAuthResendConfirmRateLimitOk(ip: string, email: string): Promise<boolean> {
  const ipKey = ip.trim() || "unknown";
  return allow([
    { key: `ratelimit:dashboard-auth:resend:ip:${ipKey}`, limit: 5, windowMs: ONE_HOUR },
    { key: `ratelimit:dashboard-auth:resend:email:${identityKey(email)}`, limit: 3, windowMs: ONE_HOUR },
  ]);
}

export function dashboardAuthForgotPasswordRateLimitOk(ip: string, email: string): Promise<boolean> {
  const ipKey = ip.trim() || "unknown";
  return allow([
    { key: `ratelimit:dashboard-auth:forgot:ip:${ipKey}`, limit: 10, windowMs: ONE_HOUR },
    { key: `ratelimit:dashboard-auth:forgot:email:${identityKey(email)}`, limit: 5, windowMs: ONE_HOUR },
  ]);
}

export function dashboardMfaVerifyRateLimitOk(ip: string, profileId: number): Promise<boolean> {
  return allow([
    { key: `ratelimit:mfa:verify:ip:${ip.trim() || "unknown"}`, limit: 20, windowMs: FIFTEEN_MIN },
    { key: `ratelimit:mfa:verify:profile:${profileId}`, limit: 15, windowMs: FIFTEEN_MIN },
  ]);
}

export function dashboardMfaEmailSendRateLimitOk(ip: string, profileId: number): Promise<boolean> {
  return allow([
    { key: `ratelimit:mfa:email:ip:${ip.trim() || "unknown"}`, limit: 5, windowMs: FIFTEEN_MIN },
    { key: `ratelimit:mfa:email:profile:${profileId}`, limit: 3, windowMs: FIFTEEN_MIN },
  ]);
}
