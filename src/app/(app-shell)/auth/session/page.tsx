import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthSessionTransition } from "@/components/auth/auth-session-transition";
import { resolvePostSignInDestination } from "@/lib/app-auth-post-sign-in";
import {
  normalizeAppCallbackPath,
  parseAuthSessionMode,
} from "@/lib/app-auth-routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Session — AgentRanking",
  description: "Confirming your AgentRanking session.",
  robots: { index: false, follow: false },
};

type SearchParams = {
  mode?: string | string[];
  next?: string | string[];
};

type Props = {
  searchParams?: Promise<SearchParams>;
};

function SessionTransitionFromParams({
  searchParams,
  nextHref,
}: {
  readonly searchParams: SearchParams;
  readonly nextHref: string;
}) {
  const mode = parseAuthSessionMode(searchParams.mode);

  return <AuthSessionTransition mode={mode} nextHref={nextHref} />;
}

export default async function AuthSessionPage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const mode = parseAuthSessionMode(params.mode);
  const nextHref =
    mode === "sign-in"
      ? await resolvePostSignInDestination(rawNext)
      : normalizeAppCallbackPath(rawNext);

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#08090a] px-4">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      <SessionTransitionFromParams searchParams={params} nextHref={nextHref} />
    </Suspense>
  );
}
