"use client";
import { useEffect } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
export default function DashboardAgentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard/agents] unhandled error:", error);
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="mx-auto w-full max-w-md space-y-5 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Agent page error
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Failed to load this agent&apos;s data. Please try again.
          </p>
          {process.env.NODE_ENV === "development" && error?.message ? (
            <p className="mt-2 break-words font-mono text-xs text-red-400/90">
              {error.message}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}