import "next-auth";
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /** Set for wallet (SIWE) sign-in — used to resolve UserProfile when email is absent. */
      walletAddress?: string | null;
      /** False when MFA is required and not yet completed for this session. */
      mfaVerified?: boolean;
      /** UserProfile id when MFA is pending or verified. */
      profileId?: number | null;
      /** Production developer allowlist — unlocks internal dev tooling. */
      isDeveloper?: boolean;
    };
  }

  interface User {
    walletAddress?: string | null;
    mfaVerified?: boolean;
    profileId?: number | null;
    mfaJustVerified?: boolean;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    walletAddress?: string;
    email?: string | null;
    name?: string | null;
    picture?: string | null;
    mfaVerified?: boolean;
    profileId?: number;
    isDeveloper?: boolean;
  }
}
