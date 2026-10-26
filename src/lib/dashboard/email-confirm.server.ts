import "server-only";
import { consumeDashboardAuthToken } from "@/lib/dashboard/confirm-token";
import {
  markEmailVerified,
  upsertDashboardAuthUser,
} from "@/lib/dashboard/auth-users";

export type DashboardEmailConfirmationResult =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly reason: "missing" | "invalid" | "expired" | "used" };

export async function confirmDashboardEmailToken(
  token: string,
): Promise<DashboardEmailConfirmationResult> {
  const normalized = token.trim();
  if (!normalized) return { ok: false, reason: "missing" };

  const consumed = await consumeDashboardAuthToken(normalized, "email_confirm");
  if (!consumed.ok) {
    return {
      ok: false,
      reason:
        consumed.reason === "expired"
          ? "expired"
          : consumed.reason === "consumed"
            ? "used"
            : "invalid",
    };
  }
  await upsertDashboardAuthUser(consumed.email);
  await markEmailVerified(consumed.email);
  return { ok: true, email: consumed.email };
}
