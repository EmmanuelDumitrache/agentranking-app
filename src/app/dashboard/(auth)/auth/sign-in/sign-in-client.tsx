"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpDigitInput } from "@/components/ui/otp-digit-input";

export function DashboardMagicLinkSignIn({
  loginToken,
  initialError,
}: {
  readonly loginToken: string;
  readonly initialError: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const message = initialError
    ? initialError === "expired"
      ? "That link expired. Request a new code."
      : "Invalid sign-in link. Request a new code."
    : signInError;

  async function submitCode() {
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setSignInError("Enter the 6-digit code from your email.");
      return;
    }
    setSubmitting(true);
    setSignInError(null);
    try {
      const result = await signIn("dashboard-email", {
        loginToken,
        code: digits,
        redirect: false,
        callbackUrl: "/dashboard",
      });
      if (result?.error) {
        setSignInError("Invalid or expired code. Check your email and try again.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setSignInError("Sign-in failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (initialError || !loginToken) {
    return (
      <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
        <div className="ui-loading">
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
      <div className="ui-auth-youtube__panel ui-overview-panel mx-auto w-full max-w-md space-y-6 rounded-xl border border-[#303030] bg-[#181818] p-6">
        <div>
          <h1 className="text-lg font-semibold text-[#f1f1f1]">Enter your sign-in code</h1>
          <p className="mt-1 text-sm text-[#aaa]">
            We emailed you a 6-digit code. Enter it here to finish signing in.
          </p>
        </div>
        <OtpDigitInput
          value={code}
          onChange={setCode}
          length={6}
          autoFocus
          aria-label="Email sign-in code"
        />
        {message ? <p className="text-sm text-red-400">{message}</p> : null}
        <Button
          type="button"
          className="ui-auth-youtube__button ui-auth-youtube__button--primary w-full rounded-full bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white"
          disabled={submitting || code.replace(/\D/g, "").length !== 6}
          onClick={() => void submitCode()}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </div>
  );
}
