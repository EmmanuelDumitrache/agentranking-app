import { hash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getDashboardAuthBaseUrl } from "@/lib/dashboard/auth-base-url";
export const DASHBOARD_CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export type DashboardAuthTokenType = "email_confirm" | "password_reset";
function hashToken(raw: string): string {
  return hash("sha256", raw, "hex");
}
export function buildDashboardConfirmUrl(rawToken: string): string {
  const params = new URLSearchParams({ token: rawToken });
  return `${getDashboardAuthBaseUrl()}/dashboard/auth/confirm?${params.toString()}`;
}

export function buildDashboardPasswordResetUrl(rawToken: string): string {
  const params = new URLSearchParams({ token: rawToken });
  return `${getDashboardAuthBaseUrl()}/auth/reset-password?${params.toString()}`;
}

function buildDashboardAuthActionUrl(rawToken: string, type: DashboardAuthTokenType): string {
  if (type === "password_reset") return buildDashboardPasswordResetUrl(rawToken);
  return buildDashboardConfirmUrl(rawToken);
}
export async function issueDashboardAuthToken(
  email: string,
  type: DashboardAuthTokenType,
): Promise<{ rawToken: string; confirmUrl: string; expiresAt: Date }> {
  const normalized = email.trim().toLowerCase();
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + DASHBOARD_CONFIRM_TOKEN_TTL_MS);
  await prisma.dashboardAuthToken.updateMany({
    where: { email: normalized, type, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.dashboardAuthToken.create({
    data: {
      email: normalized,
      type,
      tokenHash,
      expiresAt,
    },
  });
  return { rawToken, confirmUrl: buildDashboardAuthActionUrl(rawToken, type), expiresAt };
}
export type ConsumeDashboardAuthTokenResult =
  | { ok: true; email: string; type: DashboardAuthTokenType }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };
export async function consumeDashboardAuthToken(
  rawToken: string,
  expectedType: DashboardAuthTokenType,
): Promise<ConsumeDashboardAuthTokenResult> {
  const trimmed = rawToken.trim();
  if (!trimmed) return { ok: false, reason: "invalid" };
  const tokenHash = hashToken(trimmed);
  const row = await prisma.dashboardAuthToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.type !== expectedType) return { ok: false, reason: "invalid" };
  if (row.consumedAt) return { ok: false, reason: "consumed" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  await prisma.dashboardAuthToken.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true, email: row.email, type: row.type as DashboardAuthTokenType };
}
