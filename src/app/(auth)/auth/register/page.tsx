import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { authOptions } from "@/lib/auth";
import { readAppAuthProviderAvailability } from "@/lib/app-auth-provider-config.server";
import { resolvePostSignInDestination } from "@/lib/app-auth-post-sign-in";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";

type SearchParams = {
  error?: string | string[];
};
type Props = {
  searchParams?: Promise<SearchParams>;
};

export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([
    getServerSession(authOptions),
    Promise.resolve(searchParams),
  ]);
  if (hasDashboardSessionIdentity(session)) {
    redirect(await resolvePostSignInDestination("/dashboard"));
  }
  const errorValue = params?.error;
  const error = Array.isArray(errorValue) ? errorValue[0] ?? null : errorValue ?? null;
  const providers = readAppAuthProviderAvailability();
  return <RegisterForm error={error} twitterAvailable={providers.twitter} />;
}
