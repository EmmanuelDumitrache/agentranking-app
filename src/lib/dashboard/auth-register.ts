import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { issueDashboardAuthToken } from "@/lib/dashboard/confirm-token";
import { sendDashboardConfirmEmail } from "@/lib/dashboard/email-auth";
import { normalizeDashboardEmail, upsertDashboardAuthUser } from "@/lib/dashboard/auth-users";
import { isEmailVerifiedForDashboard } from "@/lib/dashboard/auth-users";
export async function registerDashboardAccount(input: {
  email: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeDashboardEmail(input.email);
  const passwordHash = await hash(input.password, 12);
  const existing = await prisma.userProfile.findUnique({ where: { email } });
  if (existing && (await isEmailVerifiedForDashboard(email))) {
    return { ok: false, error: "An account with this email already exists." };
  }
  const { profile } = await upsertDashboardAuthUser(email, existing?.displayName ?? null);
  await prisma.userProfile.update({
    where: { id: profile.id },
    data: { passwordHash },
  });
  const { rawToken, confirmUrl } = await issueDashboardAuthToken(email, "email_confirm");
  await sendDashboardConfirmEmail({ email, confirmUrl });
  if (process.env.NODE_ENV === "development") {
    console.warn("[dashboard-auth] dev confirm token:", rawToken, confirmUrl);
  }
  return { ok: true };
}
export async function resendDashboardConfirmEmail(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeDashboardEmail(email);
  const profile = await prisma.userProfile.findUnique({ where: { email: normalized } });
  if (!profile) {
    return { ok: true };
  }
  if (await isEmailVerifiedForDashboard(normalized)) {
    return { ok: false, error: "Email is already confirmed." };
  }
  const { confirmUrl } = await issueDashboardAuthToken(normalized, "email_confirm");
  await sendDashboardConfirmEmail({ email: normalized, confirmUrl });
  return { ok: true };
}
