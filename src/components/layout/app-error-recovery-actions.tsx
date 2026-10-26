"use client";
import { useTransientState } from "@/hooks/use-transient-state";

import { AppRecoveryLink } from "@/components/layout/app-recovery-page";
export function AppErrorRecoveryActions({ errorDetail }: { readonly errorDetail: string }) {
  const [copied, setCopied] = useTransientState(false, 2000);
  async function copyError() {
    try {
      await navigator.clipboard.writeText(errorDetail);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <AppRecoveryLink href="/" primary className="app-recovery-btn">
        Home
      </AppRecoveryLink>
      <AppRecoveryLink href="/" className="app-recovery-btn">
        Discover
      </AppRecoveryLink>
      <button type="button" className="ar-btn ar-btn-secondary app-recovery-btn" onClick={() => void copyError()}>
        {copied ? "Copied" : "Copy error"}
      </button>
    </>
  );
}