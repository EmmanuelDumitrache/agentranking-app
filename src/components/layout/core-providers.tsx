"use client";

import { AppErrorBoundary } from "@/components/layout/app-error-boundary";
import { ChunkLoadRecovery } from "@/components/layout/chunk-load-recovery";
import { ToastContainer } from "@/components/ui/toast-simple";

/**
 * The smallest client runtime shared by every rendered route.
 *
 * Authentication, TanStack Query, wallet, and product-specific providers must
 * be mounted by the narrowest route layout or client island that consumes them.
 */
export function AppRuntimeBoundary({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <AppErrorBoundary>
      <ChunkLoadRecovery />
      {children}
      <ToastContainer />
    </AppErrorBoundary>
  );
}
