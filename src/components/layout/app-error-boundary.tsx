"use client";
import React from "react";
import { AppRecoveryPage } from "@/components/layout/app-recovery-page";
import { AppErrorRecoveryActions } from "@/components/layout/app-error-recovery-actions";
import {
  isChunkLoadErrorMessage,
  reloadForChunkError,
  shouldAttemptChunkReload,
} from "@/lib/chunk-load-error";
function formatErrorDetail(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "An unexpected error occurred.";
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
}
/** Top-level error boundary so the whole app never goes blank. */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error) {
    console.error("[AppErrorBoundary] crash:", error);
    if (
      process.env.NODE_ENV !== "development" &&
      isChunkLoadErrorMessage(error.message) &&
      shouldAttemptChunkReload()
    ) {
      reloadForChunkError();
    }
  }
  render() {
    if (this.state.hasError) {
      const detail = formatErrorDetail(this.state.error);
      return (
        <AppRecoveryPage
          title="Something went wrong"
          description="The page hit an unexpected error. Head home or copy the error details if you need support."
          detail={detail}
          actions={<AppErrorRecoveryActions errorDetail={detail} />}
        />
      );
    }
    return this.props.children;
  }
}