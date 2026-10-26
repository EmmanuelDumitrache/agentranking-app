"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthWaveBackground } from "@/components/auth/auth-wave-background";
import { APP_LOGIN_PATH } from "@/lib/app-auth-routes";

const mutedButtonClass =
  "ui-auth-youtube__button ui-auth-youtube__button--secondary flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-[#303030] bg-[#212121] text-sm font-medium text-[#f1f1f1] hover:bg-[#303030]";

const inputClass =
  "h-11 rounded-full border-[#303030] bg-[#212121] text-[#f1f1f1] placeholder:text-[#777]";

export function AuthForgotPasswordForm({ publicSiteUrl }: { readonly publicSiteUrl: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    setMessage(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not send reset email.");
        return;
      }
      setMessage(
        body.message ??
          "If an account exists for this email, we sent a password reset link.",
      );
    } catch {
      setError("Could not send reset email.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <AuthRecoveryShell publicSiteUrl={publicSiteUrl} title="Forgot password">
      <p className="text-center text-sm text-[#aaa]">
        Enter your email and we&apos;ll send a link to reset your password.
      </p>
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="Email address"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={loading}
        className={inputClass}
      />
      {error ? <p className="text-center text-sm text-red-300">{error}</p> : null}
      {message ? <p className="text-center text-xs text-[#aaa]">{message}</p> : null}
      <Button type="button" disabled={loading} onClick={() => void submit()} className={mutedButtonClass}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Send reset link
      </Button>
      <ReturnToLoginLink />
    </AuthRecoveryShell>
  );
}

export function AuthResetPasswordForm({
  token,
  publicSiteUrl,
}: {
  readonly token: string;
  readonly publicSiteUrl: string;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    setError(null);
    setMessage(null);
    if (!token) {
      setError("Reset link is invalid. Request a new one.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not reset password.");
        return;
      }
      setDone(true);
      setMessage(body.message ?? "Password updated. You can sign in now.");
    } catch {
      setError("Could not reset password.");
    } finally {
      setLoading(false);
    }
  }, [confirmPassword, password, token]);

  if (!token) {
    return (
      <AuthRecoveryShell publicSiteUrl={publicSiteUrl} title="Reset password">
        <p className="text-center text-sm text-red-300">This reset link is invalid or missing.</p>
        <Button asChild className={mutedButtonClass}>
          <Link href="/auth/forgot-password">Request a new link</Link>
        </Button>
        <ReturnToLoginLink />
      </AuthRecoveryShell>
    );
  }

  return (
    <AuthRecoveryShell publicSiteUrl={publicSiteUrl} title="Reset password">
      {done ? (
        <p className="text-center text-sm text-[#aaa]">{message}</p>
      ) : (
        <>
          <p className="text-center text-sm text-[#aaa]">Choose a new password for your account.</p>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            className={inputClass}
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={loading}
            className={inputClass}
          />
          {error ? <p className="text-center text-sm text-red-300">{error}</p> : null}
          <Button type="button" disabled={loading} onClick={() => void submit()} className={mutedButtonClass}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Update password
          </Button>
        </>
      )}
      <ReturnToLoginLink />
    </AuthRecoveryShell>
  );
}

function ReturnToLoginLink() {
  return (
    <Link
      href={APP_LOGIN_PATH}
      className="flex items-center justify-center gap-1.5 text-sm text-[#aaa] transition-colors hover:text-[#f1f1f1]"
    >
      <ArrowLeft className="h-4 w-4" />
      Return to sign in
    </Link>
  );
}

function AuthRecoveryShell({
  publicSiteUrl,
  title,
  children,
}: {
  readonly publicSiteUrl: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
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
        <div className="ui-auth-youtube__panel w-full rounded-xl border border-[#303030] bg-[#181818] p-6 shadow-none">
          <h1 className="mb-2 text-center text-xl font-semibold tracking-tight text-[#f1f1f1]">{title}</h1>
          <div className="grid gap-3 pt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
