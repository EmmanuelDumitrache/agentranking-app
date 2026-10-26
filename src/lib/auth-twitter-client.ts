"use client";
import { signIn } from "next-auth/react";
type AuthProvidersResponse = Record<string, { id?: string; name?: string } | undefined>;
/** True when the NextAuth `twitter` provider is registered (TWITTER_CLIENT_* set). */
export async function isTwitterSignInAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/providers");
    if (!res.ok) return false;
    const providers = (await res.json()) as AuthProvidersResponse;
    return Boolean(providers.twitter);
  } catch {
    return false;
  }
}
export async function signInWithTwitter(callbackUrl: string): Promise<void> {
  await signIn("twitter", { callbackUrl });
}