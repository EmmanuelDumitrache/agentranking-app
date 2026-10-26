import { DashboardMagicLinkSignIn } from "@/app/dashboard/(auth)/auth/sign-in/sign-in-client";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function DashboardAuthSignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const loginToken = first(params.loginToken) || first(params.t);
  const initialError = first(params.error) || (!loginToken ? "invalid" : "");
  return (
    <DashboardMagicLinkSignIn
      loginToken={loginToken}
      initialError={initialError}
    />
  );
}
