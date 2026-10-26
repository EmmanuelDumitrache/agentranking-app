import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AuthResetPasswordForm } from "@/components/auth/auth-password-recovery";
import { authOptions } from "@/lib/auth";
import { resolvePostSignInDestination } from "@/lib/app-auth-post-sign-in";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getPublicSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password — AgentRanking",
  description: "Choose a new password for your Agent Dashboard account.",
};

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([
    getServerSession(authOptions),
    Promise.resolve(searchParams),
  ]);
  if (hasDashboardSessionIdentity(session)) {
    redirect(await resolvePostSignInDestination("/dashboard"));
  }
  const token = first(params.token);
  return <AuthResetPasswordForm token={token} publicSiteUrl={getPublicSiteUrl()} />;
}
