"use client";
import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCountdownUntil } from "@/hooks/use-countdown-until";
import { useHydrated } from "@/hooks/use-hydrated";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { isAbortLike, timeoutSignal } from "@/lib/timing/abort";
import { ChevronLeft, Grid2x2Plus, Mail, KeyRound } from "lucide-react";
const REMEMBER_STORAGE_KEY = "agentranking_admin_remember_device";
const LOGIN_TOKEN_STORAGE_KEY = "agentranking_admin_login_token";
const RESEND_COOLDOWN_SEC = 60;
type LoginStep = "email" | "code";
function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
}
function loginTimeoutMs(): number {
  if (isLocalDevHost()) return 120_000;
  return 45_000;
}
function errorFromQueryParam(raw: string | null): string {
  switch (raw) {
    case "expired":
      return "That sign-in link expired. Request a new email and try again.";
    case "invalid":
      return "That sign-in link is invalid or was already used (email apps sometimes open links automatically). Request a new email.";
    case "failed":
      return "Sign-in failed. Check server configuration and try again.";
    default:
      return "";
  }
}
function rememberedDevice(): boolean {
  try {
    return globalThis.localStorage?.getItem(REMEMBER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function AdminAuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const queryStep: LoginStep = searchParams.get("step") === "code" ? "code" : "email";
  const [step, setStep] = useSourceDraft<LoginStep>(queryKey, queryStep);
  const [code, setCode] = useState("");
  const hydrated = useHydrated();
  const [rememberMe, setRememberMe] = useSourceDraft(
    hydrated ? "remembered" : "server",
    hydrated ? rememberedDevice() : false,
  );
  const [error, setError] = useSourceDraft(queryKey, errorFromQueryParam(searchParams.get("error")));
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendDeadline, setResendDeadline] = useState<number | null>(null);
  const resendCooldown = useCountdownUntil(resendDeadline);
  const startResendCooldown = useCallback(() => {
    setResendDeadline(Date.now() + RESEND_COOLDOWN_SEC * 1_000);
  }, []);
  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rememberMe }),
        credentials: "include",
        signal: timeoutSignal(loginTimeoutMs()),
      });
      let data: {
        message?: string;
        error?: string;
        devHint?: string;
        ok?: boolean;
        configured?: boolean;
        emailSent?: boolean;
        devCodeLogged?: boolean;
        loginToken?: string;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setError(res.ok ? "Invalid response from server" : `Server error (${res.status})`);
        return;
      }
      if (!res.ok || data.ok === false) {
        const parts = [
          data.error,
          data.devHint,
          data.configured === false
            ? "Set ADMIN_LOGIN_EMAIL in server env and restart the app."
            : undefined,
        ].filter(Boolean);
        setError(parts.length ? parts.join(" ") : "Could not send sign-in email");
        return;
      }
      if (data.emailSent === false) {
        const parts = [
          "Sign-in email was not sent.",
          data.devHint,
          data.devCodeLogged
            ? "In local dev, the 6-digit code is printed in the terminal running the dev server."
            : undefined,
        ].filter(Boolean);
        setError(parts.join(" "));
        return;
      }
      if (data.loginToken) {
        try {
          sessionStorage.setItem(LOGIN_TOKEN_STORAGE_KEY, data.loginToken);
        } catch {
          // ignore
        }
      }
      setInfo(data.message ?? "Check the admin inbox — your code expires in 5 minutes.");
      setStep("code");
      startResendCooldown();
      router.replace("/admin/login?step=code", { scroll: false });
    } catch (err) {
      if (isAbortLike(err)) {
        setError(
          isLocalDevHost()
            ? "Request timed out (dev server may still be compiling). Try again shortly."
            : "Request timed out. Check your connection and try again.",
        );
      } else {
        setError("Could not send sign-in email");
      }
    } finally {
      setLoading(false);
    }
  }
  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your email");
      return;
    }
    let loginToken = "";
    try {
      loginToken = sessionStorage.getItem(LOGIN_TOKEN_STORAGE_KEY) ?? "";
    } catch {
      // ignore
    }
    if (!loginToken) {
      setError("Sign-in session expired. Go back and request a new email.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: digits, loginToken, rememberMe }),
        credentials: "include",
        signal: timeoutSignal(loginTimeoutMs()),
      });
      let data: { error?: string } = {};
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        setError(res.ok ? "Invalid response from server" : `Server error (${res.status})`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Invalid code");
        return;
      }
      try {
        if (rememberMe) localStorage.setItem(REMEMBER_STORAGE_KEY, "1");
        else localStorage.removeItem(REMEMBER_STORAGE_KEY);
        sessionStorage.removeItem(LOGIN_TOKEN_STORAGE_KEY);
      } catch {
        // ignore
      }
      void fetch("/api/admin/dashboard-summary?quick=1", {
        credentials: "include",
      }).catch(() => {});
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      if (isAbortLike(err)) {
        setError("Request timed out. Try again.");
      } else {
        setError("Verification failed");
      }
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      <div className="relative hidden h-full flex-col border-r border-border bg-muted/60 p-10 lg:flex">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-background to-transparent" />
        <div className="z-10 flex items-center gap-2">
          <Grid2x2Plus className="size-6 text-primary" />
          <p className="text-xl font-semibold tracking-tight">AgentRanking</p>
        </div>
        <div className="z-10 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-xl text-pretty text-foreground/90">
              &ldquo;On-chain agent discovery, verification, and rankings — built for operators who need
              signal, not noise.&rdquo;
            </p>
            <footer className="font-mono text-sm font-semibold text-muted-foreground">AgentRanking Admin</footer>
          </blockquote>
        </div>
        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>
      <div className="relative flex min-h-screen flex-col justify-center p-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 isolate opacity-60 contain-strict"
        >
          <div className="absolute top-0 right-0 h-[20rem] w-[35rem] -translate-y-[87.5%] rounded-full bg-foreground/[0.06] blur-3xl" />
          <div className="absolute top-0 right-0 h-[20rem] w-[15rem] translate-x-[5%] -translate-y-1/2 rounded-full bg-foreground/[0.04] blur-3xl" />
          <div className="absolute top-0 right-0 h-[20rem] w-[15rem] -translate-y-[87.5%] rounded-full bg-foreground/[0.04] blur-3xl" />
        </div>
        <Button variant="ghost" className="absolute top-7 left-5" asChild>
          <Link href="/">
            <ChevronLeft className="me-2 size-4" />
            Home
          </Link>
        </Button>
        <div className="mx-auto w-full max-w-sm space-y-4">
          <div className="flex items-center gap-2 lg:hidden">
            <Grid2x2Plus className="size-6 text-primary" />
            <p className="text-xl font-semibold tracking-tight">AgentRanking</p>
          </div>
          <div className="flex flex-col space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Admin sign in</h1>
            <p className="text-base text-muted-foreground">
              {step === "email"
                ? "We’ll email you a one-time code and sign-in link."
                : "Enter the 6-digit code from your email."}
            </p>
          </div>
          {step === "email" ? (
            <form onSubmit={requestCode} className="space-y-3">
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="admin-remember"
                  checked={rememberMe}
                  onCheckedChange={(v: boolean) => setRememberMe(v === true)}
                />
                <Label
                  htmlFor="admin-remember"
                  className="cursor-pointer text-sm font-normal leading-none text-muted-foreground"
                >
                  Remember this device (30 days)
                </Label>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
              <Button type="submit" disabled={loading} className="w-full gap-2" size="lg">
                <Mail className="h-4 w-4" aria-hidden />
                {loading ? "Sending…" : "Send sign-in email"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="admin-code" className="text-muted-foreground text-xs">
                  Sign-in code
                </Label>
                <div className="relative">
                  <Input
                    id="admin-code"
                    placeholder="000000"
                    className="peer ps-9 text-center text-lg tracking-[0.4em] font-mono"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                  />
                  <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground">
                    <KeyRound className="size-4" aria-hidden />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="admin-remember-code"
                  checked={rememberMe}
                  onCheckedChange={(v: boolean) => setRememberMe(v === true)}
                />
                <Label
                  htmlFor="admin-remember-code"
                  className="cursor-pointer text-sm font-normal leading-none text-muted-foreground"
                >
                  Remember this device (30 days)
                </Label>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
              <Button type="submit" disabled={loading || code.replace(/\D/g, "").length !== 6} className="w-full" size="lg">
                {loading ? "Verifying…" : "Verify code"}
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={loading || resendCooldown > 0}
                  onClick={() => void requestCode()}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend email"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError("");
                    setInfo("");
                    router.replace("/admin/login", { scroll: false });
                  }}
                >
                  Back
                </Button>
              </div>
            </form>
          )}
          <p className="mt-8 text-sm text-muted-foreground">
            By signing in you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-primary">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
function FloatingPaths({ position }: Readonly<{ position: number }>) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${
      216 - i * 6
    } ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${
      875 - i * 6
    } ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
    duration: 20 + (i % 10) * 1.2,
  }));
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="h-full w-full text-foreground" viewBox="0 0 696 316" fill="none" aria-hidden>
        <title>Background paths</title>
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.1 + path.id * 0.03}
            initial={{ pathLength: 0.3, opacity: 0.6 }}
            animate={{
              pathLength: 1,
              opacity: [0.3, 0.6, 0.3],
              pathOffset: [0, 1, 0],
            }}
            transition={{
              duration: path.duration,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }}
          />
        ))}
      </svg>
    </div>
  );
}
export { AdminAuthPage as AuthPage };
