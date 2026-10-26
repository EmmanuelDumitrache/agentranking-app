import { prisma } from "@/lib/db";
export const WALLET_AUTH_EMAIL_DOMAIN = "@wallet.agentranking.io";
export function normalizeDashboardEmail(email: string): string {
  return email.trim().toLowerCase();
}
export function isSyntheticWalletEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e.endsWith(WALLET_AUTH_EMAIL_DOMAIN);
}
export async function isEmailVerifiedForDashboard(email: string): Promise<boolean> {
  const normalized = normalizeDashboardEmail(email);
  if (isSyntheticWalletEmail(normalized)) return true;
  const [authUser, profile] = await Promise.all([
    prisma.authUser.findUnique({
      where: { email: normalized },
      select: { emailVerified: true },
    }),
    prisma.userProfile.findUnique({
      where: { email: normalized },
      select: { emailVerifiedAt: true },
    }),
  ]);
  if (authUser?.emailVerified) return true;
  if (profile?.emailVerifiedAt) return true;
  return false;
}
export async function markEmailVerified(email: string): Promise<void> {
  const normalized = normalizeDashboardEmail(email);
  const now = new Date();
  await prisma.authUser.upsert({
    where: { email: normalized },
    create: { email: normalized, emailVerified: now },
    update: { emailVerified: now },
  });
  const profile = await prisma.userProfile.findUnique({ where: { email: normalized } });
  if (profile) {
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { emailVerifiedAt: now },
    });
  }
}
export async function upsertDashboardAuthUser(email: string, displayName?: string | null) {
  const normalized = normalizeDashboardEmail(email);
  let authUser = await prisma.authUser.findUnique({ where: { email: normalized } });
  if (!authUser) {
    authUser = await prisma.authUser.create({
      data: { email: normalized, name: displayName ?? null },
    });
  }
  const existingProfile = await prisma.userProfile.findUnique({ where: { email: normalized } });
  if (existingProfile) {
    return { authUser, profile: existingProfile };
  }
  const profile = await prisma.userProfile.create({
    data: {
      email: normalized,
      displayName: displayName ?? authUser.name ?? null,
    },
  });
  return { authUser, profile };
}
export async function touchLastLogin(email: string): Promise<void> {
  const normalized = normalizeDashboardEmail(email);
  const profile = await prisma.userProfile.findUnique({ where: { email: normalized } });
  if (!profile) return;
  await prisma.userProfile.update({
    where: { id: profile.id },
    data: { lastLoginAt: new Date() },
  });
}
