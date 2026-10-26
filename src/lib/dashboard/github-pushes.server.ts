import "server-only";
import { prisma } from "@/lib/db";
import {
  loadAgentGithubPushNotes,
  mergeSnapshotPushesWithNotes,
} from "@/lib/dashboard/github-push-notes";
import { groupPushesByDate, type DevProofRecentCommit, type PushNoteRow } from "@/lib/devproof-public";
export type DashboardGithubPushesDto = {
  connection: {
    repoFullName: string;
    visibility: string;
    lastSyncedAt: string | null;
  } | null;
  snapshot: {
    commitCount30d: number;
    releaseCount: number;
    contributorCount: number;
    lastCommitAt: string | null;
    capturedAt: string;
    payloadJson: unknown;
  } | null;
  pushes: DevProofRecentCommit[];
  groups: ReturnType<typeof groupPushesByDate>;
  notes?: PushNoteRow[];
};
export async function loadDashboardGithubPushes(
  agentDbId: number,
): Promise<DashboardGithubPushesDto> {
  const [connection, snapshot, notes] = await Promise.all([
    prisma.agentGithubConnection.findFirst({
      where: { agentId: agentDbId, status: { in: ["pending", "active"] } },
      orderBy: { createdAt: "desc" },
      select: { repoFullName: true, visibility: true, lastSyncedAt: true },
    }),
    prisma.agentGithubSnapshot.findFirst({
      where: { agentId: agentDbId },
      orderBy: { capturedAt: "desc" },
      select: {
        commitCount30d: true,
        releaseCount: true,
        contributorCount: true,
        lastCommitAt: true,
        capturedAt: true,
        payloadJson: true,
      },
    }),
    loadAgentGithubPushNotes(agentDbId),
  ]);
  if (!connection || !snapshot) {
    return {
      connection: connection
        ? {
            repoFullName: connection.repoFullName,
            visibility: connection.visibility,
            lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
          }
        : null,
      snapshot: snapshot
        ? {
            commitCount30d: snapshot.commitCount30d,
            releaseCount: snapshot.releaseCount,
            contributorCount: snapshot.contributorCount,
            lastCommitAt: snapshot.lastCommitAt?.toISOString() ?? null,
            capturedAt: snapshot.capturedAt.toISOString(),
            payloadJson: snapshot.payloadJson,
          }
        : null,
      pushes: [],
      groups: [],
      notes,
    };
  }
  const pushes = mergeSnapshotPushesWithNotes(connection, snapshot, notes, {
    includeHidden: true,
  });
  return {
    connection: {
      repoFullName: connection.repoFullName,
      visibility: connection.visibility,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    },
    snapshot: {
      commitCount30d: snapshot.commitCount30d,
      releaseCount: snapshot.releaseCount,
      contributorCount: snapshot.contributorCount,
      lastCommitAt: snapshot.lastCommitAt?.toISOString() ?? null,
      capturedAt: snapshot.capturedAt.toISOString(),
      payloadJson: snapshot.payloadJson,
    },
    pushes,
    groups: groupPushesByDate(pushes.filter((push) => !push.hidden)),
    notes,
  };
}
