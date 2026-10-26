import type { Session } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
const SYNTH_EMAIL_SUFFIX = "@wallet.agentranking.io";
function normalizeSessionWallet(raw: string | null | undefined): string {
  const wallet = raw?.trim() ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : wallet;
}
function profileWalletWhere(wallet: string) {
  return wallet.startsWith("0x")
    ? { walletAddress: { equals: wallet, mode: "insensitive" as const } }
    : { OR: [{ walletAddress: wallet }, { solanaWallet: wallet }] };
}
function parseWalletFromSyntheticEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const eoa = email.match(/^eoa\+([a-f0-9]{40})@wallet\.agentranking\.io$/i);
  if (eoa?.[1]) return `0x${eoa[1].toLowerCase()}`;
  const sol = email.match(/^sol\+([^@]+)@wallet\.agentranking\.io$/i);
  if (sol?.[1]) return sol[1].trim();
  return null;
}
/**
 * Creates or loads a minimal UserProfile for this session so dashboard APIs
 * do not return 404 for signed-in users without a row (e.g. race with OAuth).
 */
export const ensureMinimalUserProfile = cache(async (session: Session | null) => {
  const resolved = await getDashboardUserProfile(session);
  if (resolved) return resolved;
  if (!hasDashboardSessionIdentity(session)) return null;
  const u = session!.user!;
  const emailRaw = u.email?.trim().toLowerCase() ?? "";
  const walletSession = normalizeSessionWallet(u.walletAddress);
  const synthetic = emailRaw.endsWith(SYNTH_EMAIL_SUFFIX);
  if (emailRaw && !synthetic) {
    return prisma.userProfile.upsert({
      where: { email: emailRaw },
      create: {
        email: emailRaw,
        displayName: u.name ?? null,
        avatarUrl: u.image ?? "",
      },
      update: {},
    });
  }
  const walletFromSynthetic = parseWalletFromSyntheticEmail(emailRaw);
  const walletKey = walletSession || walletFromSynthetic;
  if (!walletKey) return null;

  // Preserve legacy Solana rows that may have the wallet in walletAddress but
  // predate the dedicated solanaWallet column. The subsequent upsert makes
  // first-profile creation safe when two sessions arrive concurrently.
  const existingWalletProfile = await prisma.userProfile.findFirst({
    where: profileWalletWhere(walletKey),
  });
  if (existingWalletProfile) return existingWalletProfile;

  const isSolana = !walletKey.startsWith("0x");
  try {
    return isSolana
      ? await prisma.userProfile.upsert({
          where: { solanaWallet: walletKey },
          create: { solanaWallet: walletKey, walletAddress: walletKey, displayName: u.name ?? null },
          update: {},
        })
      : await prisma.userProfile.upsert({
          where: { walletAddress: walletKey },
          create: { walletAddress: walletKey, displayName: u.name ?? null },
          update: {},
        });
  } catch (error) {
    // A legacy Solana profile may win a concurrent insert through the
    // walletAddress unique key rather than solanaWallet. Resolve that race by
    // re-reading through the same compatibility predicate.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return prisma.userProfile.findFirst({ where: profileWalletWhere(walletKey) });
  }
});
/**
 * Resolves the dashboard UserProfile for the current session.
 * Order: JWT-linked wallet → synthetic eoa+… email → real email lookup.
 */
export async function getDashboardUserProfile(session: Session | null) {
  if (!session?.user) return null;
  const profileId = session.user.profileId;
  if (typeof profileId === "number" && Number.isInteger(profileId) && profileId > 0) {
    const byProfileId = await prisma.userProfile.findUnique({ where: { id: profileId } });
    if (byProfileId) return byProfileId;
  }
  const jwtWallet = session.user.walletAddress?.trim();
  if (jwtWallet) {
    const normalizedJwtWallet = normalizeSessionWallet(jwtWallet);
    const byJwt = await prisma.userProfile.findFirst({
      where: profileWalletWhere(normalizedJwtWallet),
    });
    if (byJwt) return byJwt;
  }
  const email = session.user.email?.trim().toLowerCase();
  const parsedWallet = parseWalletFromSyntheticEmail(email);
  if (parsedWallet) {
    const byParsed = await prisma.userProfile.findFirst({
      where: profileWalletWhere(normalizeSessionWallet(parsedWallet)),
    });
    if (byParsed) return byParsed;
  }
  if (email && !email.endsWith(SYNTH_EMAIL_SUFFIX)) {
    return prisma.userProfile.findUnique({ where: { email } });
  }
  return null;
}
export { hasDashboardSessionIdentity as hasDashboardIdentity } from "@/lib/dashboard/session-identity";
