import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle } from "lucide-react";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export const dynamic = "force-dynamic";

export default async function DashboardAuthConfirmPage({ searchParams }: Props) {
  const params = await searchParams;
  const confirmed = first(params.confirmed) === "1";
  const error = first(params.error);
  const email = first(params.email);
  const token = first(params.token);

  if (token && !confirmed && !error) {
    redirect(`/api/dashboard/auth/confirm?token=${encodeURIComponent(token)}`);
  }

  if (confirmed) {
    return (
      <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
        <div className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel space-y-4 text-center">
          <CheckCircle className="ui-verify-tick mx-auto h-10 w-10" aria-hidden />
          <h1 className="ui-auth-heading">Email confirmed</h1>
          <p className="ui-auth-lead">
            {email ? (
              <>
                <span className="text-[var(--ui-text-primary)]">{email}</span> is
                verified. Sign in to open Agent Dashboard.
              </>
            ) : (
              "Your email is verified. Sign in to continue."
            )}
          </p>
          <Link href="/dashboard" className="ui-btn ui-btn-primary ui-btn-block">
            Sign in to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const errorCopy: Record<string, string> = {
    missing: "Confirmation link is missing a token.",
    invalid: "This confirmation link is invalid.",
    expired: "This confirmation link has expired.",
    used: "This confirmation link was already used.",
  };
  return (
    <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
      <div className="ui-auth-page-card ui-auth-youtube__panel ui-overview-panel space-y-4 text-center">
        <AlertCircle
          className="mx-auto h-10 w-10 text-[var(--ui-danger)]"
          aria-hidden
        />
        <h1 className="ui-auth-heading">Could not confirm email</h1>
        <p className="ui-auth-lead">
          {errorCopy[error || "missing"] ?? "Something went wrong."}
        </p>
        <Link href="/dashboard" className="ui-btn ui-btn-secondary ui-btn-block">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
