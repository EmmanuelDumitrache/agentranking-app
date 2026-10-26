import { DashboardLoadingSequence } from "@/components/dashboard/dashboard-loading-sequence";

/** Branded full-screen transition while the authenticated shell resolves. */
export function DashboardPageSkeleton() {
  return <DashboardLoadingSequence fullScreen />;
}
