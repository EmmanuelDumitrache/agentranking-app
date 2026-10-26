import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AuthForgotPasswordForm } from "@/components/auth/auth-password-recovery";
import { authOptions } from "@/lib/auth";
import { resolvePostSignInDestination } from "@/lib/app-auth-post-sign-in";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getPublicSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password — AgentRanking",
  description: "Reset your Agent Dashboard password.",
};

export default async function ForgotPasswordPage() {
  const session = await getServerSession(authOptions);
  if (hasDashboardSessionIdentity(session)) {
    redirect(await resolvePostSignInDestination("/dashboard"));
  }
  return <AuthForgotPasswordForm publicSiteUrl={getPublicSiteUrl()} />;
}
