import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isSyntheticWalletEmail,
  markEmailVerified,
  normalizeDashboardEmail,
  upsertDashboardAuthUser,
} from "@/lib/dashboard/auth-users";
export const OAUTH_LINK_COOKIE = "ar-oauth-link";
export const X_OAUTH_EMAIL_DOMAIN = "@x.agentranking.io";
export type OAuthProviderId = "google" | "twitter";

const OAuthLinkPayloadSchema = z.strictObject({
  v: z.literal(1),
  exp: z.number().int(),
  authUserId: z.string().min(1),
  email: z.string().min(1),
  provider: z.enum(["google", "twitter"]),
});

type OAuthLinkPayload = z.infer<typeof OAuthLinkPayloadSchema>;
export type ResolvedOAuthIdentity = {
  authUserId: string;
  email: string;
  name: string | null;
  image: string | null;
  twitterUsername: string | null;
};
function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set and at least 32 characters");
  }
  return secret;
}
function signPayload(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}
function decodePayload(encoded: string): OAuthLinkPayload | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const parsed = OAuthLinkPayloadSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function isTwitterAuthConfigured(): boolean {
  return Boolean(process.env.TWITTER_CLIENT_ID?.trim() && process.env.TWITTER_CLIENT_SECRET?.trim());
}
export function twitterSyntheticEmail(twitterUserId: string): string {
  return `x+${twitterUserId.trim()}${X_OAUTH_EMAIL_DOMAIN}`;
}
export function isSyntheticXEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(X_OAUTH_EMAIL_DOMAIN);
}
/** True for wallet or X placeholder emails that should not be shown as a real inbox. */
export function isDisplaySyntheticEmail(email: string | null | undefined): boolean {
  return isSyntheticWalletEmail(email) || isSyntheticXEmail(email);
}
export function verifyOAuthLinkToken(token: string): OAuthLinkPayload | null {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = signPayload(encoded);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  const payload = decodePayload(encoded);
  if (!payload || payload.exp < Date.now()) return null;
  return payload;
}
export async function readPendingOAuthLink(
  provider: OAuthProviderId,
): Promise<OAuthLinkPayload | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(OAUTH_LINK_COOKIE)?.value;
    if (!raw) return null;
    const payload = verifyOAuthLinkToken(raw);
    if (!payload || payload.provider !== provider) return null;
    return payload;
  } catch {
    return null;
  }
}
export async function clearPendingOAuthLink(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(OAUTH_LINK_COOKIE);
  } catch {
    // Non-blocking — cookie clear is best-effort during OAuth callbacks
  }
}
async function upsertAuthAccount(input: {
  userId: string;
  provider: OAuthProviderId;
  providerAccountId: string;
  type: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
  session_state?: string | null;
}) {
  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
    create: {
      userId: input.userId,
      type: input.type,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      access_token: input.access_token ?? null,
      refresh_token: input.refresh_token ?? null,
      expires_at: input.expires_at ?? null,
      token_type: input.token_type ?? null,
      scope: input.scope ?? null,
      id_token: input.id_token ?? null,
      session_state: input.session_state ?? null,
    },
    update: {
      userId: input.userId,
      access_token: input.access_token ?? null,
      refresh_token: input.refresh_token ?? null,
      expires_at: input.expires_at ?? null,
      token_type: input.token_type ?? null,
      scope: input.scope ?? null,
      id_token: input.id_token ?? null,
      session_state: input.session_state ?? null,
    },
  });
}
async function ensureProfileForOAuth(input: {
  email: string;
  name: string | null;
  image: string | null;
  twitterUsername: string | null;
}) {
  const email = normalizeDashboardEmail(input.email);
  const twitterUrl =
    input.twitterUsername?.trim()
      ? `https://x.com/${input.twitterUsername.trim().replace(/^@/, "")}`
      : "";
  const existing = await prisma.userProfile.findUnique({ where: { email } });
  if (existing) {
    await prisma.userProfile.update({
      where: { email },
      data: {
        displayName: existing.displayName ?? input.name ?? null,
        avatarUrl: existing.avatarUrl || input.image || "",
        ...(twitterUrl && !existing.twitterUrl ? { twitterUrl } : {}),
      },
    });
    return;
  }
  await prisma.userProfile.create({
    data: {
      email,
      displayName: input.name ?? null,
      avatarUrl: input.image ?? "",
      twitterUrl,
    },
  });
}
/**
 * Resolve or create the AuthUser for an OAuth sign-in / account-link, and persist AuthAccount.
 */
export async function resolveOAuthIdentity(input: {
  provider: OAuthProviderId;
  providerAccountId: string;
  type: string;
  email: string | null | undefined;
  name: string | null | undefined;
  image: string | null | undefined;
  twitterUsername?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
  session_state?: string | null;
  pendingLink: OAuthLinkPayload | null;
}): Promise<{ ok: true; identity: ResolvedOAuthIdentity } | { ok: false; error: string }> {
  const providerAccountId = input.providerAccountId.trim();
  if (!providerAccountId) {
    return { ok: false, error: "missing_provider_account" };
  }
  const existingLink = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId,
      },
    },
    include: { authUser: true },
  });
  if (input.pendingLink) {
    // Cross-linking is disabled — never merge providers onto another AuthUser.
    return { ok: false, error: "account_linking_disabled" };
  }
  if (existingLink?.authUser?.email) {
    await upsertAuthAccount({
      userId: existingLink.userId,
      provider: input.provider,
      providerAccountId,
      type: input.type,
      access_token: input.access_token,
      refresh_token: input.refresh_token,
      expires_at: input.expires_at,
      token_type: input.token_type,
      scope: input.scope,
      id_token: input.id_token,
      session_state: input.session_state,
    });
    return {
      ok: true,
      identity: {
        authUserId: existingLink.authUser.id,
        email: normalizeDashboardEmail(existingLink.authUser.email),
        name: existingLink.authUser.name ?? input.name ?? null,
        image: existingLink.authUser.image ?? input.image ?? null,
        twitterUsername: input.twitterUsername ?? null,
      },
    };
  }
  const realEmail =
    input.email && !isSyntheticWalletEmail(input.email) && !isSyntheticXEmail(input.email)
      ? normalizeDashboardEmail(input.email)
      : null;
  const email =
    realEmail ??
    (input.provider === "twitter"
      ? twitterSyntheticEmail(providerAccountId)
      : null);
  if (!email) {
    return { ok: false, error: "email_required" };
  }
  const { authUser } = await upsertDashboardAuthUser(email, input.name ?? null);
  if (input.name || input.image) {
    await prisma.authUser.update({
      where: { id: authUser.id },
      data: {
        name: authUser.name ?? input.name ?? null,
        image: authUser.image ?? input.image ?? null,
        ...(realEmail ? { emailVerified: new Date() } : {}),
      },
    });
  } else if (realEmail) {
    await markEmailVerified(email);
  }
  await upsertAuthAccount({
    userId: authUser.id,
    provider: input.provider,
    providerAccountId,
    type: input.type,
    access_token: input.access_token,
    refresh_token: input.refresh_token,
    expires_at: input.expires_at,
    token_type: input.token_type,
    scope: input.scope,
    id_token: input.id_token,
    session_state: input.session_state,
  });
  await ensureProfileForOAuth({
    email,
    name: input.name ?? null,
    image: input.image ?? null,
    twitterUsername: input.twitterUsername ?? null,
  });
  if (realEmail) {
    try {
      await markEmailVerified(email);
    } catch {
      // Non-blocking
    }
  }
  return {
    ok: true,
    identity: {
      authUserId: authUser.id,
      email,
      name: input.name ?? authUser.name ?? null,
      image: input.image ?? authUser.image ?? null,
      twitterUsername: input.twitterUsername ?? null,
    },
  };
}
export async function listLinkedOAuthProviders(authUserId: string | null, email: string | null) {
  const providers = {
    google: false,
    twitter: false,
    twitterUsername: null as string | null,
  };
  const normalizedEmail = email ? normalizeDashboardEmail(email) : null;
  if (!authUserId && !normalizedEmail) return providers;
  const orFilters: Array<{ userId: string } | { authUser: { email: string } }> = [];
  if (authUserId) orFilters.push({ userId: authUserId });
  if (normalizedEmail) orFilters.push({ authUser: { email: normalizedEmail } });
  const accounts = await prisma.authAccount.findMany({
    where: { OR: orFilters },
    select: { provider: true },
  });
  for (const row of accounts) {
    if (row.provider === "google") providers.google = true;
    if (row.provider === "twitter") providers.twitter = true;
  }
  if (providers.twitter && normalizedEmail) {
    const profile = await prisma.userProfile.findUnique({
      where: { email: normalizedEmail },
      select: { twitterUrl: true },
    });
    const match = profile?.twitterUrl?.match(/(?:x\.com|twitter\.com)\/([^/?#]+)/i);
    if (match?.[1]) providers.twitterUsername = match[1].replace(/^@/, "");
  }
  return providers;
}
