"use client";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthWaveBackground } from "@/components/auth/auth-wave-background";
import { DEFAULT_APP_POST_LOGIN_PATH, normalizeAppCallbackPath, buildSignInCallbackUrl } from "@/lib/app-auth-routes";

/**
 * DEMO_MODE sign-in: one shared demo account instead of OAuth, email or wallet login.
 * Signs in on arrival so every route into the app skips this step; the button retries.
 */
export function DemoLoginForm({ publicSiteUrl }: { readonly publicSiteUrl: string }) {
  const searchParams = useSearchParams();
  const callbackUrl = normalizeAppCallbackPath(
    searchParams.get("callbackUrl") ?? DEFAULT_APP_POST_LOGIN_PATH,
  );
  const [loading, setLoading] = useState(true);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signIn("demo", { callbackUrl: buildSignInCallbackUrl(callbackUrl) }).finally(() => setLoading(false));
  }, [callbackUrl]);
  return (
    <div className="ui-auth-youtube fixed inset-0 z-40 flex overflow-hidden text-[#f1f1f1]">
      <AuthWaveBackground />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col items-center justify-center overflow-y-auto px-6 py-8">
        <a
          href={publicSiteUrl}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-[#aaa] transition-colors hover:text-[#f1f1f1]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AgentRanking
        </a>
        <AuthForm
          logoSrc="/ar-mark.png"
          logoAlt="AgentRanking"
          title="Agent Ranking Dashboard"
          description="Explore the creator workspace with a shared demo account."
          primaryAction={{
            label: loading ? "Opening the demo workspace…" : "Continue as demo user",
            onClick: () => {
              setLoading(true);
              void signIn("demo", { callbackUrl: buildSignInCallbackUrl(callbackUrl) });
            },
            loading,
          }}
        />
        <div className="ui-auth-youtube__inset mt-5 flex w-full items-start gap-2.5 rounded-lg border border-[#303030] bg-[#181818] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#aaa]" />
          <p className="text-xs text-[#aaa]">
            Demo version. Google, X, email and wallet sign-in are turned off, and nothing you do here
            reaches a chain, a payment provider or a real account.
          </p>
        </div>
      </div>
    </div>
  );
}
