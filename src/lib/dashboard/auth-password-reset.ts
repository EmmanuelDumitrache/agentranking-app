import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { issueDashboardAuthToken, consumeDashboardAuthToken } from "@/lib/dashboard/confirm-token";
import { sendDashboardPasswordResetEmail } from "@/lib/dashboard/email-auth";
import {
  isEmailVerifiedForDashboard,
  isSyntheticWalletEmail,
  normalizeDashboardEmail,
} from "@/lib/dashboard/auth-users";
import { isStrongEnoughPassword, passwordsMatch } from "@/lib/dashboard/auth-validate";

const GENERIC_OK = { ok: true as const };

export async function requestDashboardPasswordReset(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeDashboardEmail(email);
  if (isSyntheticWalletEmail(normalized)) {
    return GENERIC_OK;
  }

  const profile = await prisma.userProfile.findUnique({ where: { email: normalized } });
  if (!profile?.passwordHash) {
    return GENERIC_OK;
  }
  if (!(await isEmailVerifiedForDashboard(normalized))) {
    return GENERIC_OK;
  }

  const { confirmUrl: resetUrl } = await issueDashboardAuthToken(normalized, "password_reset");
  const sent = await sendDashboardPasswordResetEmail({ email: normalized, resetUrl });
  if (!sent.sent && process.env.NODE_ENV === "production") {
    return { ok: false, error: sent.error ?? "Could not send reset email." };
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[dashboard-auth] dev password reset link:", resetUrl);
  }

  return GENERIC_OK;
}

export async function completeDashboardPasswordReset(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (!isStrongEnoughPassword(input.password) || !passwordsMatch(input.password, input.confirmPassword)) {
    return { ok: false, error: "Password must be at least 8 characters and match confirmation." };
  }

  const consumed = await consumeDashboardAuthToken(input.token.trim(), "password_reset");
  if (!consumed.ok) {
    return {
      ok: false,
      error:
        consumed.reason === "expired"
          ? "This reset link expired. Request a new one."
          : consumed.reason === "consumed"
            ? "This reset link was already used. Request a new one."
            : "Invalid reset link. Request a new one.",
    };
  }

  const passwordHash = await hash(input.password, 12);
  await prisma.userProfile.updateMany({
    where: { email: consumed.email },
    data: { passwordHash },
  });

  return { ok: true, email: consumed.email };
}
