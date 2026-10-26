import {
  formatGithubConnectionStatus,
  isGithubConnectionHealthy,
} from "@/lib/dashboard/github-status";
export type GithubConnectionInput = {
  repoFullName: string;
  status: string;
  visibility?: string | null;
  lastSyncedAt?: Date | string | null;
} | null;
export type GithubSnapshotInput = {
  commitCount30d: number;
  contributorCount: number;
  releaseCount: number;
  lastCommitAt?: Date | string | null;
  capturedAt?: Date | string | null;
} | null;
export type AgentGithubDisplay = {
  connectionStatus: string;
  connectionStatusLabel: string;
  devProofActive: boolean;
  repoFullName: string | null;
  visibility: string | null;
  lastSyncedAt: Date | null;
  lastCommitAt: Date | null;
  commitCount30d: number | null;
  contributorCount: number | null;
  releaseCount: number | null;
  snapshotCapturedAt: Date | null;
  hasConnection: boolean;
  hasSnapshot: boolean;
};
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function buildAgentGithubDisplay(
  connection: GithubConnectionInput,
  snapshot: GithubSnapshotInput,
  devProofSignalActive: boolean,
): AgentGithubDisplay {
  const hasConnection = Boolean(connection?.repoFullName?.trim());
  const connectionStatus = connection?.status ?? "not_connected";
  const devProofActive =
    devProofSignalActive ||
    (isGithubConnectionHealthy(connectionStatus) && Boolean(snapshot));
  return {
    connectionStatus,
    connectionStatusLabel: hasConnection
      ? formatGithubConnectionStatus(connectionStatus)
      : "Not connected",
    devProofActive,
    repoFullName: connection?.repoFullName?.trim() || null,
    visibility: connection?.visibility?.trim() || null,
    lastSyncedAt: toDate(connection?.lastSyncedAt),
    lastCommitAt: toDate(snapshot?.lastCommitAt),
    commitCount30d: snapshot != null ? snapshot.commitCount30d : null,
    contributorCount: snapshot != null ? snapshot.contributorCount : null,
    releaseCount: snapshot != null ? snapshot.releaseCount : null,
    snapshotCapturedAt: toDate(snapshot?.capturedAt),
    hasConnection,
    hasSnapshot: snapshot != null,
  };
}
export type DashboardGithubConnectionDto = {
  id: string;
  repoFullName: string;
  status: string;
  visibility: string;
  lastSyncedAt: string | null;
};
export type DashboardGithubSnapshotDto = {
  commitCount30d: number;
  contributorCount: number;
  releaseCount: number;
  lastCommitAt: string | null;
  capturedAt: string;
};
export type DashboardGithubDataDto = {
  connection: DashboardGithubConnectionDto | null;
  snapshots: DashboardGithubSnapshotDto[];
};
