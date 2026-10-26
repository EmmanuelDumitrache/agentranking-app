import "server-only";
import { prisma } from "@/lib/db";
import type {
  DashboardGithubConnectionDto,
  DashboardGithubDataDto,
  DashboardGithubSnapshotDto,
} from "@/lib/dashboard/agent-github";
function toConnectionDto(row: {
  id: string;
  repoFullName: string;
  status: string;
  visibility: string;
  lastSyncedAt: Date | null;
}): DashboardGithubConnectionDto {
  return {
    id: row.id,
    repoFullName: row.repoFullName,
    status: row.status,
    visibility: row.visibility,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };
}
function toSnapshotDto(row: {
  commitCount30d: number;
  contributorCount: number;
  releaseCount: number;
  lastCommitAt: Date | null;
  capturedAt: Date;
}): DashboardGithubSnapshotDto {
  return {
    commitCount30d: row.commitCount30d,
    contributorCount: row.contributorCount,
    releaseCount: row.releaseCount,
    lastCommitAt: row.lastCommitAt?.toISOString() ?? null,
    capturedAt: row.capturedAt.toISOString(),
  };
}
/** Full records retained for the existing browser API response contract. */
export async function loadDashboardGithubRouteData(agentDbId: number) {
  const [connection, snapshots] = await Promise.all([
    prisma.agentGithubConnection.findFirst({
      where: { agentId: agentDbId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentGithubSnapshot.findMany({
      where: { agentId: agentDbId },
      orderBy: { capturedAt: "desc" },
      take: 10,
    }),
  ]);
  return { connection, snapshots };
}
/** Narrow, serialisable projection used across the RSC boundary. */
export async function loadDashboardGithubData(
  agentDbId: number,
): Promise<DashboardGithubDataDto> {
  const { connection, snapshots } = await loadDashboardGithubRouteData(agentDbId);
  return {
    connection: connection ? toConnectionDto(connection) : null,
    snapshots: snapshots.map(toSnapshotDto),
  };
}
