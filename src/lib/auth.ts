import type { NextAuthOptions } from "next-auth";
import type { User } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import TwitterProvider from "next-auth/providers/twitter";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { getAddress, isAddress, verifyMessage } from "viem";
import { prisma } from "@/lib/db";
import {
  resolveUserProfileForSolanaCredentials,
  resolveUserProfileForWalletCredentials,
} from "@/lib/wallet-auth-profile";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import {
  isFreshSolanaSignInTimestamp,
  parseSolanaSignInIssuedAt,
  SOLANA_SIGN_IN_PREFIX,
} from "@/lib/solana-auth-sign-in-server";
import { ensureDevNextAuthUrl } from "@/lib/nextauth-url";
import { verifyDashboardLoginCode } from "@/lib/dashboard/login-token";
import {
  isEmailVerifiedForDashboard,
  isSyntheticWalletEmail,
  markEmailVerified,
  normalizeDashboardEmail,
  touchLastLogin,
  upsertDashboardAuthUser,
  WALLET_AUTH_EMAIL_DOMAIN,
} from "@/lib/dashboard/auth-users";
import { isFastLocal, isBetaDevLoginEnabled } from "@/lib/fast-local";
import { DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_NAME, isDemoMode } from "@/lib/demo-mode";
import { ensureDemoWorkspace } from "@/lib/demo-account.server";
import { APP_LOGIN_PATH } from "@/lib/app-auth-routes";
import { isDeveloperAccountEmail } from "@/lib/dashboard/developer-access";
import { bootstrapAppAccountAfterSignIn } from "@/lib/custodial-wallet/sign-in-bootstrap";
import {
  clearPendingOAuthLink,
  isSyntheticXEmail,
  isTwitterAuthConfigured,
  readPendingOAuthLink,
  resolveOAuthIdentity,
  type OAuthProviderId,
} from "@/lib/oauth-account-link";
import { resolveProfileMfaForAuthUser } from "@/lib/account-security/resolve-profile-mfa";
import { verifyMfaCompletionToken } from "@/lib/account-security/mfa-completion-token";
import { isMfaDeviceTrusted } from "@/lib/account-security/mfa-trust";
export { WALLET_AUTH_EMAIL_DOMAIN };
async function withMfaSessionFields(
  user: User,
  opts?: { walletAddress?: string | null; forceVerified?: boolean },
): Promise<User> {
  if (opts?.forceVerified || user.mfaJustVerified) {
    user.mfaVerified = true;
    return user;
  }
  const resolved = await resolveProfileMfaForAuthUser({
    email: user.email,
    walletAddress: opts?.walletAddress ?? user.walletAddress,
  });
  if (!resolved) {
    user.mfaVerified = true;
    return user;
  }
  user.profileId = resolved.profileId;
  if (!resolved.flags.mfaRequired) {
    user.mfaVerified = true;
    return user;
  }
  // Valid httpOnly trust cookie (issued only after a real MFA challenge) skips re-challenge.
  user.mfaVerified = await isMfaDeviceTrusted(resolved.profileId, resolved.trustVersion);
  return user;
}
ensureDevNextAuthUrl();
if (process.env.NODE_ENV === "development") {
  if (!(globalThis as { __authLogged?: boolean }).__authLogged) {
    (globalThis as { __authLogged?: boolean }).__authLogged = true;
    console.log("[auth] NEXTAUTH_URL     =", process.env.NEXTAUTH_URL);
    console.log(
      "[auth] GOOGLE_CLIENT_ID =",
      process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.slice(0, 12)}…` : "(unset)",
    );
    console.log(
      "[auth] TWITTER_CLIENT_ID =",
      process.env.TWITTER_CLIENT_ID ? `${process.env.TWITTER_CLIENT_ID.slice(0, 12)}…` : "(unset)",
    );
    console.log("[auth] callback URL    =", `${process.env.NEXTAUTH_URL}/api/auth/callback/google`);
    if (isTwitterAuthConfigured()) {
      console.log("[auth] X callback URL  =", `${process.env.NEXTAUTH_URL}/api/auth/callback/twitter`);
    }
  }
}
type TwitterOAuthProfile = {
  data?: {
    id?: string;
    name?: string;
    username?: string;
    profile_image_url?: string;
    confirmed_email?: string | null;
  };
};
function buildTwitterAuthProvider() {
  if (!isTwitterAuthConfigured()) return null;
  return TwitterProvider({
    clientId: process.env.TWITTER_CLIENT_ID!,
    clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    version: "2.0",
    // Keep scopes to what Free/Basic X apps can grant. `users.email` often
    // breaks authorize unless the X app has email permission enabled.
    authorization: {
      url: "https://twitter.com/i/oauth2/authorize",
      params: {
        scope: "users.read tweet.read offline.access",
      },
    },
    userinfo: {
      url: "https://api.twitter.com/2/users/me",
      params: {
        "user.fields": "profile_image_url,username",
      },
    },
    profile(profile: TwitterOAuthProfile) {
      const data = profile.data ?? {};
      return {
        id: data.id ?? "",
        name: data.name ?? data.username ?? null,
        // X OAuth 2.0 rarely returns email; we create a stable synthetic inbox.
        email: data.confirmed_email ?? null,
        image: data.profile_image_url ?? null,
      };
    },
    checks: ["pkce", "state"],
  });
}
const twitterAuthProvider = buildTwitterAuthProvider();
/** Sign in a fixed, passwordless local identity (dev-skip and demo deployments). */
async function authorizeFixedIdentity(email: string, displayName: string) {
  await prisma.userProfile.upsert({
    where: { email },
    create: { email, displayName },
    update: {},
  });
  await markEmailVerified(email);
  const { authUser } = await upsertDashboardAuthUser(email, displayName);
  await touchLastLogin(email);
  return withMfaSessionFields(
    { id: authUser.id, email, name: displayName },
    { forceVerified: true },
  );
}
function buildDevSkipAuthProvider() {
  if (!isFastLocal() && !isBetaDevLoginEnabled()) return null;
  return CredentialsProvider({
    id: "dev-skip",
    name: "Dev Skip",
    credentials: {},
    async authorize() {
      const email = (
        process.env.DEV_SKIP_LOGIN_EMAIL?.trim() || "dev-skip@agentranking.local"
      ).toLowerCase();
      try {
        return await authorizeFixedIdentity(email, "Dev Skip User");
      } catch (err) {
        throw new Error("Dev-skip authorisation failed", { cause: err });
      }
    },
  });
}
const devSkipAuthProvider = buildDevSkipAuthProvider();
/** DEMO_MODE's only provider: one shared demo account, no OAuth or wallet signing. */
function buildDemoAuthProvider() {
  return CredentialsProvider({
    id: "demo",
    name: "Demo",
    credentials: {},
    async authorize() {
      try {
        const user = await authorizeFixedIdentity(DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_NAME);
        await ensureDemoWorkspace();
        return user;
      } catch (err) {
        throw new Error("Demo authorisation failed", { cause: err });
      }
    },
  });
}
export const authOptions: NextAuthOptions = {
  providers: isDemoMode() ? [buildDemoAuthProvider()] : [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    ...(twitterAuthProvider ? [twitterAuthProvider] : []),
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();
        try {
          const profile = await prisma.userProfile.findUnique({ where: { email } });
          if (!profile?.passwordHash) return null;
          const valid = await compare(credentials.password, profile.passwordHash);
          if (!valid) return null;
          if (!isSyntheticWalletEmail(email) && !(await isEmailVerifiedForDashboard(email))) {
            return null;
          }
          const { authUser } = await upsertDashboardAuthUser(email, profile.displayName);
          await touchLastLogin(email);
          return withMfaSessionFields({
            id: authUser.id,
            email: authUser.email ?? email,
            name: authUser.name,
          });
        } catch (err) {
          throw new Error("Password authorisation failed", { cause: err });
        }
      },
    }),
    CredentialsProvider({
      id: "mfa-complete",
      name: "MFA Complete",
      credentials: {
        completionToken: { label: "Completion Token", type: "text" },
      },
      async authorize(credentials) {
        const completionToken = credentials?.completionToken?.trim() ?? "";
        if (!completionToken) return null;
        try {
          const verified = await verifyMfaCompletionToken(completionToken);
          if (!verified.ok) return null;
          const authUser = await prisma.authUser.findUnique({
            where: { id: verified.authUserId },
          });
          if (!authUser) return null;
          return withMfaSessionFields(
            {
              id: authUser.id,
              email: authUser.email ?? verified.email,
              name: authUser.name,
              profileId: verified.profileId,
              mfaJustVerified: true,
            },
            { forceVerified: true },
          );
        } catch (err) {
          throw new Error("MFA completion authorisation failed", { cause: err });
        }
      },
    }),
    CredentialsProvider({
      id: "wallet",
      name: "Wallet",
      credentials: {
        address: { label: "Address", type: "text" },
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        const address = credentials?.address?.trim() ?? "";
        const message = credentials?.message ?? "";
        const signature = credentials?.signature ?? "";
        if (!address || !message || !signature) return null;
        try {
          if (!isAddress(address)) return null;
          const checksummed = getAddress(address as `0x${string}`);
          const ok = await verifyMessage({
            address: checksummed,
            message,
            signature: signature as `0x${string}`,
          });
          if (!ok) return null;
          const issued = message.match(/Issued At:\s*(.+)/i)?.[1]?.trim();
          if (issued) {
            const t = Date.parse(issued);
            if (!Number.isFinite(t) || Date.now() - t > 20 * 60 * 1000) return null;
          }
          const norm = checksummed.toLowerCase();
          const profile = await resolveUserProfileForWalletCredentials(norm);
          if (!profile) return null;
          const authEmail = `eoa+${norm.replace(/^0x/i, "")}${WALLET_AUTH_EMAIL_DOMAIN}`;
          let authUser = await prisma.authUser.findUnique({ where: { email: authEmail } });
          if (!authUser) {
            authUser = await prisma.authUser.create({
              data: { email: authEmail, name: profile.displayName ?? null },
            });
          }
          return withMfaSessionFields(
            {
              id: authUser.id,
              email: authEmail,
              name: profile.displayName ?? null,
              walletAddress: norm,
            },
            { walletAddress: norm },
          );
        } catch (err) {
          throw new Error("EVM wallet authorisation failed", { cause: err });
        }
      },
    }),
    CredentialsProvider({
      id: "dashboard-email",
      name: "Dashboard Email Code",
      credentials: {
        loginToken: { label: "Login Token", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const loginToken = credentials?.loginToken?.trim() ?? "";
        const code = credentials?.code?.trim() ?? "";
        if (!loginToken || !code) return null;
        try {
          const result = await verifyDashboardLoginCode(loginToken, code, { purpose: "sign_in", consume: true });
          if (!result.ok) return null;
          if (!(await isEmailVerifiedForDashboard(result.email))) return null;
          const { authUser } = await upsertDashboardAuthUser(result.email);
          await touchLastLogin(result.email);
          // Email OTP as primary login already proved possession of the inbox —
          // if email MFA is the only factor, treat as verified; if TOTP is also on, still challenge.
          const user = await withMfaSessionFields({
            id: authUser.id,
            email: authUser.email ?? result.email,
            name: authUser.name,
          });
          const resolved = await resolveProfileMfaForAuthUser({ email: result.email });
          if (resolved && resolved.flags.emailOtpMfaEnabled && !resolved.flags.totpEnabled) {
            user.mfaVerified = true;
            user.profileId = resolved.profileId;
          }
          return user;
        } catch (err) {
          throw new Error("Dashboard email authorisation failed", { cause: err });
        }
      },
    }),
    CredentialsProvider({
      id: "solana",
      name: "Solana",
      credentials: {
        publicKey: { label: "Public Key", type: "text" },
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        const publicKey = normalizeSolanaAddress(credentials?.publicKey?.trim() ?? "");
        const message = credentials?.message ?? "";
        const signature = credentials?.signature ?? "";
        if (!publicKey || !message || !signature) return null;
        if (!message.startsWith(SOLANA_SIGN_IN_PREFIX)) return null;
        try {
          const walletInMessage = message
            .slice(SOLANA_SIGN_IN_PREFIX.length, message.indexOf("\nIssued At:"))
            .trim();
          if (walletInMessage !== publicKey) return null;
          if (!verifySolanaSignMessage(message, signature, publicKey)) return null;
          const issuedMs = parseSolanaSignInIssuedAt(message);
          if (issuedMs == null || !isFreshSolanaSignInTimestamp(issuedMs)) return null;
          const profile = await resolveUserProfileForSolanaCredentials(publicKey);
          if (!profile) return null;
          const authEmail = `sol+${publicKey}${WALLET_AUTH_EMAIL_DOMAIN}`;
          let authUser = await prisma.authUser.findUnique({ where: { email: authEmail } });
          if (!authUser) {
            authUser = await prisma.authUser.create({
              data: { email: authEmail, name: profile.displayName ?? null },
            });
          }
          return withMfaSessionFields(
            {
              id: authUser.id,
              email: authEmail,
              name: profile.displayName ?? null,
              walletAddress: publicKey,
            },
            { walletAddress: publicKey },
          );
        } catch (err) {
          throw new Error("Solana wallet authorisation failed", { cause: err });
        }
      },
    }),
    ...(devSkipAuthProvider ? [devSkipAuthProvider] : []),
  ],
  session: {
    strategy: "jwt",
  },
  // HTTPS localhost needs Secure cookies; Lax survives the X→app top-level redirect.
  useSecureCookies: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
  cookies: {
    state: {
      name:
        (process.env.NEXTAUTH_URL?.startsWith("https://") ? "__Secure-" : "") +
        "next-auth.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
        maxAge: 900,
      },
    },
    pkceCodeVerifier: {
      name:
        (process.env.NEXTAUTH_URL?.startsWith("https://") ? "__Secure-" : "") +
        "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
        maxAge: 900,
      },
    },
  },
  debug: process.env.NODE_ENV === "development",
  pages: {
    signIn: APP_LOGIN_PATH,
    error: APP_LOGIN_PATH,
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        if (token.sub) {
          (session.user as typeof session.user & { id: string }).id = String(token.sub);
        }
        // Custom jwt callback must round-trip identity fields explicitly.
        if (token.email) session.user.email = String(token.email);
        if (token.name) session.user.name = String(token.name);
        if (token.picture) session.user.image = String(token.picture);
        if (token.walletAddress) {
          const w = String(token.walletAddress);
          session.user.walletAddress = w.startsWith("0x") ? w.toLowerCase() : w;
        } else {
          session.user.walletAddress = undefined;
        }
        session.user.mfaVerified = token.mfaVerified !== false;
        session.user.profileId =
          typeof token.profileId === "number" ? token.profileId : null;
        session.user.isDeveloper = token.isDeveloper === true;
      }
      return session;
    },
    async jwt({ token, user, account }) {
      const oauthProvider =
        account?.provider === "google" || account?.provider === "twitter"
          ? (account.provider as OAuthProviderId)
          : null;
      if (oauthProvider && user?.email) {
        // signIn already resolved AuthUser / AuthAccount and mutated `user`.
        token.sub = user.id;
        token.email = user.email;
        if (user.name) token.name = user.name;
        if (user.image) token.picture = user.image;
        delete token.walletAddress;
        const mfaUser = await withMfaSessionFields(user);
        token.mfaVerified = mfaUser.mfaVerified !== false;
        if (typeof mfaUser.profileId === "number") token.profileId = mfaUser.profileId;
        token.isDeveloper = isDeveloperAccountEmail(user.email);
        await clearPendingOAuthLink();
        return token;
      }
      if (user) {
        token.sub = user.id;
        if (user.email) token.email = user.email;
        if (user.name) token.name = user.name;
        if (user.image) token.picture = user.image;
        const u = user as User & { walletAddress?: string };
        if (u.walletAddress) {
          const w = u.walletAddress;
          token.walletAddress = w.startsWith("0x") ? w.toLowerCase() : w;
        } else {
          delete token.walletAddress;
        }
        token.mfaVerified = user.mfaVerified !== false;
        if (typeof user.profileId === "number") token.profileId = user.profileId;
        token.isDeveloper = isDeveloperAccountEmail(user.email);
      } else if (token.email) {
        token.isDeveloper = isDeveloperAccountEmail(String(token.email));
      }
      return token;
    },
    async signIn({ user, account, profile }) {
      const oauthProvider =
        account?.provider === "google" || account?.provider === "twitter"
          ? (account.provider as OAuthProviderId)
          : null;
      if (oauthProvider && account?.providerAccountId) {
        const pendingLink = await readPendingOAuthLink(oauthProvider);
        const twitterProfile = profile as TwitterOAuthProfile | undefined;
        const resolved = await resolveOAuthIdentity({
          provider: oauthProvider,
          providerAccountId: account.providerAccountId,
          type: account.type,
          email: user.email || twitterProfile?.data?.confirmed_email || null,
          name: user.name ?? twitterProfile?.data?.name ?? null,
          image: user.image ?? twitterProfile?.data?.profile_image_url ?? null,
          twitterUsername: twitterProfile?.data?.username ?? null,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
          token_type: account.token_type,
          scope: account.scope,
          id_token: account.id_token,
          session_state: account.session_state,
          pendingLink,
        });
        if (!resolved.ok) {
          await clearPendingOAuthLink();
          if (pendingLink) {
            return `/dashboard/settings?error=${encodeURIComponent(resolved.error)}`;
          }
          return `${APP_LOGIN_PATH}?error=${encodeURIComponent(resolved.error)}`;
        }
        // Ensure JWT / bootstrap see the resolved dashboard identity.
        user.id = resolved.identity.authUserId;
        user.email = resolved.identity.email;
        if (resolved.identity.name) user.name = resolved.identity.name;
        if (resolved.identity.image) user.image = resolved.identity.image;
        await bootstrapAppAccountAfterSignIn(user);
        return true;
      }
      const email = user.email ? normalizeDashboardEmail(user.email) : "";
      const synthetic =
        email ? isSyntheticWalletEmail(email) || isSyntheticXEmail(email) : false;
      if (email && !synthetic) {
        if (account?.provider === "google") {
          const verified = await isEmailVerifiedForDashboard(email);
          if (!verified) {
            await upsertDashboardAuthUser(email, user.name);
            await markEmailVerified(email);
          }
        }
        const existing = await prisma.userProfile.findUnique({ where: { email } });
        if (existing) {
          await prisma.userProfile.update({
            where: { email },
            data: {
              displayName: existing.displayName ?? user.name ?? null,
              avatarUrl: existing.avatarUrl || user.image || "",
            },
          });
        } else {
          await prisma.userProfile.create({
            data: {
              email,
              displayName: user.name ?? null,
              avatarUrl: user.image ?? "",
            },
          });
        }
      }
      await bootstrapAppAccountAfterSignIn(user);
      return true;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};