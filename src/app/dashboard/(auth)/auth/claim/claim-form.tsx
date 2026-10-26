"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle,
  LayoutDashboard,
  Loader2,
  Lock,
} from "lucide-react";
import type { DashboardClaimTokenInfo } from "@/lib/dashboard/claim-page.server";

export function DashboardClaimForm({
  token,
  tokenInfo,
}: {
  readonly token: string;
  readonly tokenInfo: DashboardClaimTokenInfo;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/dashboard/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { email?: string; error?: string };
      if (!response.ok || !data.email) {
        setError(data.error ?? "Failed to claim account.");
        return;
      }
      await fetch("/api/dashboard/auth/resend-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      setDone(true);
      router.push(
        `/dashboard/auth/confirm-pending?email=${encodeURIComponent(data.email)}`,
      );
    } catch {
      setError("Failed to claim account. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!tokenInfo.valid) {
    return (
      <div className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel space-y-4 text-center">
        <AlertCircle
          className="mx-auto h-10 w-10 text-[var(--ui-danger)]"
          aria-hidden
        />
        <h2 className="ui-auth-heading">Invalid or expired link</h2>
        <p className="ui-auth-lead">
          {tokenInfo.error ?? "This claim link is no longer valid."}
        </p>
        <Link href="/dashboard" className="ui-btn ui-btn-secondary ui-btn-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel space-y-4 text-center">
        <CheckCircle className="ui-verify-tick mx-auto h-10 w-10" aria-hidden />
        <h2 className="ui-auth-heading">Account claimed</h2>
        <p className="ui-auth-lead">Redirecting…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel ui-auth-form">
      <div className="text-center">
        <div className="ui-empty-icon mx-auto mb-4 border border-[#303030] bg-[#212121]" aria-hidden>
          <LayoutDashboard className="ui-verify-tick h-5 w-5" />
        </div>
        <h1 className="ui-auth-heading">Claim your Dashboard access</h1>
        {tokenInfo.email ? (
          <p className="ui-auth-lead mt-1">
            For{" "}
            <span className="font-medium text-[var(--ui-text-primary)]">
              {tokenInfo.email}
            </span>
          </p>
        ) : null}
      </div>
      <p className="ui-auth-lead text-center">
        Set a backup password, then confirm your email to access Agent Dashboard.
      </p>
      <div className="ui-field">
        <label htmlFor="password" className="ui-label">
          Password
        </label>
        <div className="relative">
          <Lock
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ui-text-muted)]"
            aria-hidden
          />
          <input
            id="password"
            type="password"
            className="ui-input w-full pl-8"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
      </div>
      <div className="ui-field">
        <label htmlFor="confirm" className="ui-label">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          className="ui-input w-full"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      {error ? <p className="ui-form-error">{error}</p> : null}
      <button
        type="submit"
        className="ui-btn ui-btn-primary ui-btn-block"
        disabled={submitting}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Claim account
      </button>
    </form>
  );
}
