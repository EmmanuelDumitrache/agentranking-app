"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpDigitInput } from "@/components/ui/otp-digit-input";
import { buildSignOutCallbackUrl, normalizeAppCallbackPath } from "@/lib/app-auth-routes";
import { cn } from "@/lib/utils";
import type { MfaStatusDto } from "@/lib/account-security/mfa-types";
type Method = "totp" | "email" | "backup";
function initialMethod(status: MfaStatusDto): Method {
  if (status.totpEnabled) return "totp";
  if (status.emailOtpMfaEnabled) return "email";
  return "backup";
}
export function AuthMfaChallenge({
  callbackUrl,
  initialStatus,
}: {
  readonly callbackUrl?: string | null;
  readonly initialStatus: MfaStatusDto;
}) {
  const nextHref = normalizeAppCallbackPath(callbackUrl);
  const status = initialStatus;
  const [method, setMethod] = useState<Method>(() => initialMethod(initialStatus));
  const [code, setCode] = useState("");
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  async function sendEmailCode() {
    setSendingEmail(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/dashboard/auth/mfa/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "challenge" }),
      });
      const data = (await res.json()) as {
        loginToken?: string;
        error?: string;
        devCode?: string;
        emailDelivered?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not send email code");
        return;
      }
      setLoginToken(data.loginToken ?? null);
      if (data.devCode) {
        setInfo("Local email is not configured — check server logs for the dev code.");
      } else if (data.emailDelivered) {
        setInfo(status?.email ? `Code sent to ${status.email}` : "Code sent to your email");
      } else {
        setInfo("Code sent. Check your inbox.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSendingEmail(false);
    }
  }
  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          code,
          loginToken: method === "email" ? loginToken : undefined,
          rememberMe,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        completionToken?: string;
        error?: string;
        alreadyVerified?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }
      if (data.alreadyVerified) {
        window.location.href = nextHref;
        return;
      }
      if (!data.completionToken) {
        setError("Missing completion token");
        return;
      }
      const result = await signIn("mfa-complete", {
        completionToken: data.completionToken,
        redirect: false,
        callbackUrl: nextHref,
      });
      if (result?.error) {
        setError("Could not complete sign-in");
        return;
      }
      window.location.href = nextHref;
    } catch {
      setError("Verification failed");
    } finally {
      setSubmitting(false);
    }
  }
  const methods: { id: Method; label: string; show: boolean }[] = [
    { id: "totp", label: "Authenticator", show: Boolean(status?.totpEnabled) },
    { id: "email", label: "Email code", show: Boolean(status?.emailOtpMfaEnabled) },
    {
      id: "backup",
      label: "Backup code",
      show: Boolean(status?.totpEnabled && (status?.backupCodesRemaining ?? 0) > 0),
    },
  ];
  return (
    <div className="ui-auth-youtube flex min-h-screen items-center justify-center bg-[#0f0f0f] px-4 text-[#f1f1f1]">
      <div className="ui-auth-youtube__panel w-full max-w-md space-y-6 rounded-xl border border-[#303030] bg-[#181818] p-6 shadow-none">
        <div className="flex items-center gap-3">
          <RuntimeImage
            src="/ar-mark.png"
            alt="AgentRanking"
            className="h-10 w-auto max-w-[2.5rem] object-contain"
          />
          <div>
            <h1 className="text-lg font-semibold text-[#f1f1f1]">Verify it&apos;s you</h1>
            <p className="text-sm text-[#aaa]">
              Enter a security code to finish signing in.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Verification method
          </p>
          <div
            className="flex flex-wrap items-center justify-center gap-1.5"
            role="tablist"
            aria-label="Verification method"
          >
            {methods
              .filter((m) => m.show)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={method === m.id}
                  onClick={() => {
                    setMethod(m.id);
                    setCode("");
                    setError(null);
                    setInfo(null);
                  }}
                  className={cn(
                    "ui-auth-youtube__pill rounded-full border px-3.5 py-2 text-xs font-medium transition-colors",
                    method === m.id
                      ? "border-[#555] bg-[#f1f1f1] text-[#0f0f0f]"
                      : "border-[#303030] bg-[#212121] text-[#aaa] hover:bg-[#303030] hover:text-[#f1f1f1]",
                  )}
                >
                  {m.label}
                </button>
              ))}
          </div>
        </div>
        {method === "email" ? (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="ui-auth-youtube__button ui-auth-youtube__button--secondary w-full rounded-full border-[#303030] bg-[#212121] text-[#f1f1f1] hover:bg-[#303030]"
              disabled={sendingEmail}
              onClick={() => void sendEmailCode()}
            >
              {sendingEmail ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : loginToken ? (
                "Resend email code"
              ) : (
                "Send email code"
              )}
            </Button>
            {status?.email ? (
              <p className="text-xs text-zinc-500">Code will be sent to {status.email}</p>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          {method === "backup" ? (
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              inputMode="text"
              className="h-11 border-[#303030] bg-[#212121] text-center tracking-widest text-[#f1f1f1] placeholder:text-[#777]"
            />
          ) : (
            <OtpDigitInput
              value={code}
              onChange={setCode}
              length={6}
              autoFocus
              aria-label="6-digit security code"
            />
          )}
          {info ? <p className="text-sm text-zinc-400">{info}</p> : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 select-none">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-zinc-100 accent-zinc-100"
          />
          <span className="text-xs leading-relaxed text-zinc-400">
            Remember this browser for 7 days
          </span>
        </label>
        <Button
          type="button"
          className="ui-auth-youtube__button ui-auth-youtube__button--primary w-full rounded-full bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white"
          disabled={submitting || !code.trim() || (method === "email" && !loginToken)}
          onClick={() => void submit()}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            "Continue"
          )}
        </Button>
        <button
          type="button"
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() =>
            void signOut({ callbackUrl: buildSignOutCallbackUrl("/auth/login") })
          }
        >
          Sign out and use a different account
        </button>
      </div>
    </div>
  );
}
