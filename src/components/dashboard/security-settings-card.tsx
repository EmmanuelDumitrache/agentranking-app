"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Mail, MonitorSmartphone, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast-simple";
import { useTransientState } from "@/hooks/use-transient-state";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";
import type {
  DashboardSecurityStatusDto as SecurityStatus,
  DashboardTrustedDeviceDto as TrustedDevice,
} from "@/lib/dashboard/account-settings.server";
type EnrollState = {
  secret: string;
  qrDataUrl: string;
  uri: string;
} | null;
type StepUpKind = "disable-totp" | "disable-email" | "regen";
function formatTrustRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) {
    return hours <= 1 ? "Less than an hour left" : `${hours} hours left`;
  }
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "1 day left" : `${days} days left`;
}
export function SecuritySettingsCard({
  initialStatus,
}: {
  readonly initialStatus: SecurityStatus;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: dashboardKeys.accountSecurity(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/dashboard/settings/security", { signal });
      const data = (await res.json()) as SecurityStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      return data;
    },
    initialData: initialStatus,
    staleTime: 30_000,
    refetchOnMount: false,
  });
  const status = query.data ?? initialStatus;
  const loading = query.isFetching;
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: dashboardKeys.accountSecurity(),
    });
  const [enroll, setEnroll] = useState<EnrollState>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState<StepUpKind | null>(null);
  const [stepCode, setStepCode] = useState("");
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState(initialStatus.email ?? "");
  const [emailEnrollToken, setEmailEnrollToken] = useState<string | null>(null);
  const [emailEnrollCode, setEmailEnrollCode] = useState("");
  const [emailEnrollHint, setEmailEnrollHint] = useState<string | null>(null);
  const [copied, setCopied] = useTransientState(false, 1500);
  async function forgetTrustedDevice() {
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/settings/security/trusted-device", {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        trustedDevice?: TrustedDevice;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not forget this browser");
      queryClient.setQueryData<SecurityStatus>(
        dashboardKeys.accountSecurity(),
        (prev) =>
          prev
            ? {
                ...prev,
                trustedDevice:
                  data.trustedDevice ?? { active: false, expiresAt: null },
              }
            : prev,
      );
      showToast("This browser will ask for 2FA again next sign-in", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not forget browser", "error");
    } finally {
      setBusy(false);
    }
  }
  async function beginTotp() {
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/settings/security/totp/begin", { method: "POST" });
      const data = (await res.json()) as EnrollState & { error?: string };
      if (!res.ok || !data?.secret) throw new Error(data?.error ?? "Could not start setup");
      setEnroll({ secret: data.secret, qrDataUrl: data.qrDataUrl!, uri: data.uri! });
      setEnrollCode("");
      setBackupCodes(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Setup failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function confirmTotp() {
    if (!enroll) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/settings/security/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: enroll.secret, code: enrollCode }),
      });
      const data = (await res.json()) as { backupCodes?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not enable authenticator");
      setBackupCodes(data.backupCodes ?? []);
      setEnroll(null);
      showToast("Authenticator enabled", "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Confirm failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function sendEmailEnrollCode() {
    const email = emailDraft.trim();
    if (!email.includes("@")) {
      showToast("Enter a valid email address", "error");
      return;
    }
    setBusy(true);
    setEmailEnrollHint(null);
    try {
      const res = await fetch("/api/dashboard/auth/mfa/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "enroll", email }),
      });
      const data = (await res.json()) as {
        loginToken?: string;
        error?: string;
        devCode?: string;
        emailDelivered?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not send code");
      setEmailEnrollToken(data.loginToken ?? null);
      if (data.devCode) {
        setEmailEnrollHint("Local email not configured — check server logs for the dev code.");
      } else {
        setEmailEnrollHint(`Code sent to ${email}`);
      }
      showToast("Check your email for the code", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Send failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function confirmEmailEnroll() {
    if (!emailEnrollToken) {
      showToast("Send a code to your email first", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/settings/security/email-otp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailDraft.trim(),
          code: emailEnrollCode,
          loginToken: emailEnrollToken,
        }),
      });
      const data = (await res.json()) as { error?: string; email?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not enable");
      setEmailEnrollToken(null);
      setEmailEnrollCode("");
      setEmailEnrollHint(null);
      showToast("Email login codes are set up", "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function sendDisableEmailCode() {
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/auth/mfa/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "step_up" }),
      });
      const data = (await res.json()) as {
        loginToken?: string;
        error?: string;
        devCode?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not send code");
      setLoginToken(data.loginToken ?? null);
      if (data.devCode) {
        showToast("Local email not configured — check server logs for the dev code.", "success");
      } else {
        showToast("Code sent to your email", "success");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Send failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function runStepUp() {
    if (!stepUpOpen) return;
    setBusy(true);
    try {
      const path =
        stepUpOpen === "disable-totp"
          ? "/api/dashboard/settings/security/totp/disable"
          : stepUpOpen === "disable-email"
            ? "/api/dashboard/settings/security/email-otp/disable"
            : "/api/dashboard/settings/security/backup/regenerate";
      const method =
        stepUpOpen === "disable-email"
          ? "email"
          : stepUpOpen === "disable-totp"
            ? "totp"
            : "totp";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          code: stepCode,
          loginToken: method === "email" ? loginToken : undefined,
        }),
      });
      const data = (await res.json()) as { backupCodes?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      if (data.backupCodes) setBackupCodes(data.backupCodes);
      setStepUpOpen(null);
      setStepCode("");
      setLoginToken(null);
      showToast(
        stepUpOpen === "regen"
          ? "Backup codes regenerated"
          : stepUpOpen === "disable-totp"
            ? "Authenticator disabled"
            : "Email login codes disabled",
        "success",
      );
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }
  if (loading && !status) {
    return (
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0 px-5 py-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading security…
        </div>
      </div>
    );
  }
  return (
    <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Two-factor authentication</p>
      </div>
      <div className="ui-settings-panel-body space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        After Google / X / wallet sign-in, you&apos;ll need one enabled method to finish
        logging in. Each method can only be turned off with its own proof (app code or
        email code) so one channel can&apos;t disable the other.
      </p>
      {/* TOTP */}
      <div className="space-y-3 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              Authenticator app
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Google Authenticator, 1Password, Authy, etc.
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              status?.totpEnabled ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {status?.totpEnabled ? "On" : "Off"}
          </span>
        </div>
        {!status?.totpEnabled && !enroll ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void beginTotp()}>
            Set up authenticator
          </Button>
        ) : null}
        {enroll ? (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enroll.qrDataUrl}
              alt="Authenticator QR code"
              className="mx-auto rounded-md bg-white p-2"
              width={180}
              height={180}
            />
            <p className="break-all text-center font-mono text-[11px] text-muted-foreground">
              {enroll.secret}
            </p>
            <Input
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              placeholder="6-digit code from the app"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void confirmTotp()}>
                Confirm & enable
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEnroll(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {status?.totpEnabled ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setStepUpOpen("regen");
                setStepCode("");
                setLoginToken(null);
              }}
            >
              Regenerate backup codes
              {status.backupCodesRemaining > 0 ? ` (${status.backupCodesRemaining} left)` : ""}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                setStepUpOpen("disable-totp");
                setStepCode("");
                setLoginToken(null);
              }}
            >
              Disable authenticator
            </Button>
          </div>
        ) : null}
      </div>
      {/* Email OTP MFA */}
      <div className="space-y-3 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              Email login codes
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Prove the inbox is yours with a one-time code, then use email codes at sign-in.
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              status?.emailOtpMfaEnabled ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {status?.emailOtpMfaEnabled ? "On" : "Off"}
          </span>
        </div>
        {status?.emailOtpMfaEnabled ? (
          <>
            <p className="text-xs text-muted-foreground">
              Codes go to{" "}
              <span className="text-foreground font-medium">{status.email ?? "your email"}</span>.
              To turn this off you must confirm a code sent there.
            </p>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                setStepUpOpen("disable-email");
                setStepCode("");
                setLoginToken(null);
              }}
            >
              Disable email codes
            </Button>
          </>
        ) : (
          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">Email address</span>
              <Input
                type="email"
                value={emailDraft}
                onChange={(e) => {
                  setEmailDraft(e.target.value);
                  setEmailEnrollToken(null);
                  setEmailEnrollHint(null);
                }}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || !emailDraft.trim()}
                onClick={() => void sendEmailEnrollCode()}
              >
                {emailEnrollToken ? "Resend code" : "Send confirmation code"}
              </Button>
            </div>
            {emailEnrollToken ? (
              <div className="space-y-2 pt-1">
                <Input
                  value={emailEnrollCode}
                  onChange={(e) => setEmailEnrollCode(e.target.value)}
                  placeholder="6-digit code from email"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                {emailEnrollHint ? (
                  <p className="text-xs text-muted-foreground">{emailEnrollHint}</p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || !emailEnrollCode.trim()}
                  onClick={() => void confirmEmailEnroll()}
                >
                  Confirm & enable
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {/* Remembered browser */}
      <div className="space-y-3 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MonitorSmartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
              Remembered browser
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {status?.trustedDevice?.active
                ? "This browser skips the 2FA prompt until the timer runs out."
                : "When you check “Remember this browser” at sign-in, trust lasts 7 days here."}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              status?.trustedDevice?.active ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {status?.trustedDevice?.active ? "On" : "Off"}
          </span>
        </div>
        {status?.trustedDevice?.active ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {formatTrustRemaining(status.trustedDevice.expiresAt) ?? "Active"}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void forgetTrustedDevice()}
            >
              Forget this browser
            </Button>
          </div>
        ) : null}
      </div>
      {backupCodes && backupCodes.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-sm font-medium">Save your backup codes</p>
          <p className="text-xs text-muted-foreground">
            Each code works once. Store them offline — they won&apos;t be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(backupCodes.join("\n"));
                setCopied(true);
              }}
            >
              {copied ? (
                <Check className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1 h-3.5 w-3.5" />
              )}
              Copy codes
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setBackupCodes(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
      {stepUpOpen ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {stepUpOpen === "disable-totp"
              ? "Disable authenticator"
              : stepUpOpen === "disable-email"
                ? "Disable email codes"
                : "Regenerate backup codes"}
          </p>
          <p className="text-xs text-muted-foreground">
            {stepUpOpen === "disable-totp"
              ? "Enter a code from your authenticator app. Email codes cannot disable this."
              : stepUpOpen === "disable-email"
                ? "We’ll email a code to your inbox. Authenticator codes cannot disable this."
                : "Enter a code from your authenticator app to rotate backup codes."}
          </p>
          {stepUpOpen === "disable-email" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void sendDisableEmailCode()}
            >
              {loginToken ? "Resend email code" : "Send email code"}
            </Button>
          ) : null}
          <Input
            value={stepCode}
            onChange={(e) => setStepCode(e.target.value)}
            placeholder={
              stepUpOpen === "disable-email" ? "6-digit email code" : "6-digit authenticator code"
            }
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={
                busy ||
                !stepCode.trim() ||
                (stepUpOpen === "disable-email" && !loginToken)
              }
              onClick={() => void runStepUp()}
            >
              Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStepUpOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}