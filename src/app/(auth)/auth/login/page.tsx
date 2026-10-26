import { Suspense } from "react";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PremiumLoginForm } from "@/components/auth/premium-login-form";
import { DemoLoginForm } from "@/components/auth/demo-login-form";
import { isDemoMode } from "@/lib/demo-mode";
import { authOptions } from "@/lib/auth";
import { resolveAuthenticatedAppLoginRedirectPath } from "@/lib/app-auth-routes";
import { resolvePostSignInDestination } from "@/lib/app-auth-post-sign-in";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { readAppAuthProviderAvailability } from "@/lib/app-auth-provider-config.server";
import { appSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";
import { getPublicSiteUrl } from "@/lib/site-url";
export const dynamic = "force-dynamic";
const loginOgImage = appSocialOgImageUrl("agentDashboard");
export const metadata: Metadata = {
  title: "Sign in — AgentRanking",
  description: "Sign in to AgentRanking with Google or X.",
  openGraph: {
    title: "Agent Dashboard | AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [socialOgImageMetadata(loginOgImage, "Agent Dashboard | AgentRanking")],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Dashboard | AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [loginOgImage],
  },
};
type AppLoginPageSearchParams = {
  callbackUrl?: string | string[];
};
type AppLoginPageProps = {
  searchParams?: Promise<AppLoginPageSearchParams>;
};
export default async function AppLoginPage({
  searchParams,
}: AppLoginPageProps) {
  const [session, params] = await Promise.all([
    getServerSession(authOptions),
    Promise.resolve(searchParams),
  ]);
  if (hasDashboardSessionIdentity(session)) {
    const destination = await resolvePostSignInDestination(
      resolveAuthenticatedAppLoginRedirectPath(params?.callbackUrl),
    );
    redirect(destination);
  }
  const providers = readAppAuthProviderAvailability();
  const publicSiteUrl = getPublicSiteUrl();
  return (
    <Suspense
      fallback={
        <div className="ui-auth-youtube flex min-h-screen items-center justify-center bg-[#0f0f0f] px-4">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      {isDemoMode() ? (
        <DemoLoginForm publicSiteUrl={publicSiteUrl} />
      ) : (
        <PremiumLoginForm
          twitterAvailable={providers.twitter}
          publicSiteUrl={publicSiteUrl}
        />
      )}
    </Suspense>
  );
}