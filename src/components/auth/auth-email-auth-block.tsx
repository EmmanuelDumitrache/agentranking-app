"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpDigitInput } from "@/components/ui/otp-digit-input";
import { cn } from "@/lib/utils";
import { buildSignInCallbackUrl } from "@/lib/app-auth-routes";

type Mode = "sign-in" | "sign-up";
type SignInMethod = "code" | "password";

type Props = {
  readonly callbackUrl: string;
  readonly disabled?: boolean;
};

const mutedButtonClass =
  "ui-auth-youtube__button ui-auth-youtube__button--secondary flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-[#303030] bg-[#212121] text-sm font-medium text-[#f1f1f1] hover:bg-[#303030]";

const RESEND_COOLDOWN_SEC = 120;

export function AuthEmailAuthBlock({ callbackUrl, disabled = false }: Props) {
  const router = useRouter();
  const signInCallbackUrl = buildSignInCallbackUrl(callbackUrl);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const autoSubmitRef = useRef<string | null>(null);

  const resetErrors = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const requestSignInCode = useCallback(async () => {
    resetErrors();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        loginToken?: string;
        message?: string;
        devCode?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Could not send sign-in code.");
        return;
      }
      if (!body.loginToken) {
        setError("Could not start email sign-in.");
        return;
      }
      setLoginToken(body.loginToken);
      setCode("");
      autoSubmitRef.current = null;
      setResendIn(RESEND_COOLDOWN_SEC);
      setMessage(
        body.devCode
          ? `Dev code: ${body.devCode} (also check your inbox if Resend is configured).`
          : (body.message ??
              "If an account exists for this email, we sent a 6-digit code. It expires in 20 minutes."),
      );
    } catch {
      setError("Could not send sign-in code.");
    } finally {
      setLoading(false);
    }
  }, [email, resetErrors]);

  const submitSignInCode = useCallback(async (rawCode?: string) => {
    if (!loginToken) return;
    resetErrors();
    const digits = (rawCode ?? code).replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("dashboard-email", {
        loginToken,
        code: digits,
        redirect: false,
        callbackUrl: signInCallbackUrl,
      });
      if (result?.error) {
        setError("Invalid or expired code. Try again or request a new one.");
        autoSubmitRef.current = null;
        return;
      }
      router.replace(signInCallbackUrl);
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
      autoSubmitRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [code, loginToken, resetErrors, router, signInCallbackUrl]);

  const submitPasswordSignIn = useCallback(async () => {
    resetErrors();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: trimmed,
        password,
        redirect: false,
        callbackUrl: signInCallbackUrl,
      });
      if (result?.error) {
        setError("Invalid email or password. Confirm your email first if you just signed up.");
        return;
      }
      router.replace(signInCallbackUrl);
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [email, password, resetErrors, router, signInCallbackUrl]);

  const submitSignUp = useCallback(async () => {
    resetErrors();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          password,
          confirmPassword,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not create account.");
        return;
      }
      setMessage(
        body.message ??
          "Check your inbox to confirm your email, then return here to sign in.",
      );
      setMode("sign-in");
      setSignInMethod("password");
      setPassword("");
      setConfirmPassword("");
      setLoginToken(null);
      setCode("");
    } catch {
      setError("Could not create account.");
    } finally {
      setLoading(false);
    }
  }, [confirmPassword, email, password, resetErrors]);

  useEffect(() => {
    if (!loginToken || loading) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) return;
    if (autoSubmitRef.current === digits) return;
    autoSubmitRef.current = digits;
    void submitSignInCode(digits);
  }, [code, loading, loginToken, submitSignInCode]);

  if (loginToken) {
    const canResend = resendIn <= 0 && !loading && !disabled;
    return (
      <div className="grid gap-3">
        <p className="text-center text-sm text-[#aaa]">
          Enter the 6-digit code we sent to <span className="text-[#f1f1f1]">{email}</span>
        </p>
        <OtpDigitInput
          value={code}
          onChange={setCode}
          length={6}
          autoFocus
          disabled={disabled || loading}
          aria-label="Email sign-in code"
        />
        {error ? <p className="text-center text-sm text-red-300">{error}</p> : null}
        {message ? <p className="text-center text-xs text-[#aaa]">{message}</p> : null}
        <Button
          type="button"
          disabled={disabled || loading || code.replace(/\D/g, "").length !== 6}
          onClick={() => void submitSignInCode()}
          className={mutedButtonClass}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
        </Button>
        <div className="flex items-center justify-center gap-3 text-xs text-[#aaa]">
          <button
            type="button"
            className="underline-offset-2 hover:text-[#f1f1f1] hover:underline disabled:opacity-50"
            disabled={!canResend}
            onClick={() => void requestSignInCode()}
            title={canResend ? "Resend code" : `Resend available in ${resendIn}s`}
          >
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              {canResend ? "Resend code" : `Resend in ${resendIn}s`}
            </span>
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="underline-offset-2 hover:text-[#f1f1f1] hover:underline"
            onClick={() => {
              setLoginToken(null);
              setCode("");
              setSignInMethod("password");
              resetErrors();
            }}
          >
            Use password instead
          </button>
        </div>
        <button
          type="button"
          className="text-xs text-[#aaa] underline-offset-2 hover:text-[#f1f1f1] hover:underline"
          onClick={() => {
            setLoginToken(null);
            setCode("");
            resetErrors();
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex rounded-full border border-[#303030] bg-[#212121] p-0.5 text-xs">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-full px-3 py-1.5 font-medium transition-colors",
            mode === "sign-in" ? "bg-[#303030] text-[#f1f1f1]" : "text-[#aaa]",
          )}
          onClick={() => {
            setMode("sign-in");
            resetErrors();
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-full px-3 py-1.5 font-medium transition-colors",
            mode === "sign-up" ? "bg-[#303030] text-[#f1f1f1]" : "text-[#aaa]",
          )}
          onClick={() => {
            setMode("sign-up");
            resetErrors();
          }}
        >
          Sign up
        </button>
      </div>

      {mode === "sign-in" ? (
        <div className="flex rounded-full border border-[#303030] bg-[#181818] p-0.5 text-[11px]">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 font-medium transition-colors",
              signInMethod === "code" ? "bg-[#303030] text-[#f1f1f1]" : "text-[#aaa]",
            )}
            onClick={() => {
              setSignInMethod("code");
              resetErrors();
            }}
          >
            Email code
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 font-medium transition-colors",
              signInMethod === "password" ? "bg-[#303030] text-[#f1f1f1]" : "text-[#aaa]",
            )}
            onClick={() => {
              setSignInMethod("password");
              resetErrors();
            }}
          >
            Password
          </button>
        </div>
      ) : null}

      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="Email address"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={disabled || loading}
        className="h-11 rounded-full border-[#303030] bg-[#212121] text-[#f1f1f1] placeholder:text-[#777]"
      />

      {mode === "sign-up" || (mode === "sign-in" && signInMethod === "password") ? (
        <Input
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder={mode === "sign-up" ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={disabled || loading}
          className="h-11 rounded-full border-[#303030] bg-[#212121] text-[#f1f1f1] placeholder:text-[#777]"
        />
      ) : null}

      {mode === "sign-up" ? (
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={disabled || loading}
          className="h-11 rounded-full border-[#303030] bg-[#212121] text-[#f1f1f1] placeholder:text-[#777]"
        />
      ) : null}

      {mode === "sign-in" ? (
        <div className="text-right">
          <a
            href="/auth/forgot-password"
            className="text-xs text-[#aaa] underline-offset-2 hover:text-[#f1f1f1] hover:underline"
          >
            Forgot password?
          </a>
        </div>
      ) : null}

      {error ? <p className="text-center text-sm text-red-300">{error}</p> : null}
      {message ? <p className="text-center text-xs text-[#aaa]">{message}</p> : null}

      <Button
        type="button"
        disabled={disabled || loading}
        onClick={() => {
          if (mode === "sign-up") {
            void submitSignUp();
            return;
          }
          if (signInMethod === "password") {
            void submitPasswordSignIn();
            return;
          }
          void requestSignInCode();
        }}
        className={mutedButtonClass}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        {mode === "sign-up"
          ? "Create account"
          : signInMethod === "password"
            ? "Sign in with password"
            : "Continue with email"}
      </Button>
    </div>
  );
}
