"use client";
import { useRouter } from "next/navigation";
import { DashboardGithubPanel } from "@/components/dashboard/github/github-panel";
import type { DashboardGithubDataDto } from "@/lib/dashboard/agent-github";
import type { DevProofRecentCommit } from "@/lib/devproof-public";
type Props = {
  agentDbId: number;
  isPremiumVerified: boolean;
  initialData: DashboardGithubDataDto;
  initialPushes: DevProofRecentCommit[];
};
export function DashboardGithubClient({
  agentDbId,
  isPremiumVerified,
  initialData,
  initialPushes,
}: Props) {
  const router = useRouter();
  return (
    <DashboardGithubPanel
      agentDbId={agentDbId}
      isPremiumVerified={isPremiumVerified}
      initialData={initialData}
      initialPushes={initialPushes}
      onUpdated={() => router.refresh()}
    />
  );
}
