"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";

export function DashboardConfirmPendingClient({ email }: { readonly email: string }) {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  async function resend() {
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch("/api/dashboard/auth/resend-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not resend.");
        return;
      }
      setInfo(data.message ?? "Confirmation email sent.");
    } catch {
      setError("Could not resend.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel space-y-4">
      <Mail className="ui-verify-tick mx-auto h-10 w-10" aria-hidden />
      <h1 className="ui-auth-heading text-center">Confirm your email</h1>
      <p className="ui-auth-lead text-center">
        Agent Dashboard requires a confirmed email before you can sign in.
        {email ? (
          <>
            {" "}Check the inbox for{" "}
            <span className="text-[var(--ui-text-primary)]">{email}</span>.
          </>
        ) : null}
      </p>
      {error ? <p className="ui-form-error text-center">{error}</p> : null}
      {info ? <p className="ui-form-info text-center">{info}</p> : null}
      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-block"
        disabled={loading || !email}
        onClick={() => void resend()}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Resend confirmation email
      </button>
      <Link href="/dashboard" className="ui-btn ui-btn-secondary ui-btn-block">
        Back to Dashboard
      </Link>
    </div>
  );
}
