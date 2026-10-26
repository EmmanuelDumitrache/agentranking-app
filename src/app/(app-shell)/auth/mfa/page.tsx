import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthMfaChallenge } from "@/components/auth/auth-mfa-challenge";
import { appLoginUrl, normalizeAppCallbackPath } from "@/lib/app-auth-routes";
import { readMfaStatus } from "@/lib/account-security/mfa-challenge.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Security check — AgentRanking",
  description: "Verify your AgentRanking sign-in with a security code.",
  robots: { index: false, follow: false },
};

type SearchParams = {
  callbackUrl?: string | string[];
};
type Props = {
  searchParams?: Promise<SearchParams>;
};

export default async function AuthMfaPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const callbackUrl = Array.isArray(params.callbackUrl)
    ? params.callbackUrl[0]
    : params.callbackUrl;
  const nextHref = normalizeAppCallbackPath(callbackUrl);
  const result = await readMfaStatus();
  if (!result.ok) {
    redirect(appLoginUrl(nextHref));
  }
  if (result.status.mfaVerified || !result.status.mfaRequired) {
    redirect(nextHref);
  }
  return <AuthMfaChallenge callbackUrl={nextHref} initialStatus={result.status} />;
}
