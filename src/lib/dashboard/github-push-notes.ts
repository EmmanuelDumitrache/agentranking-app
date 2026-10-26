import { prisma } from "@/lib/db";
import {
  mergePushNotes,
  normalizeCommitShaKey,
  parseDevProofPayload,
  type DevProofRecentCommit,
  type PushNoteRow,
} from "@/lib/devproof-public";
const MAX_DEV_NOTE_LENGTH = 500;
type PushNoteDelegate = {
  findMany: (args: unknown) => Promise<PushNoteRow[]>;
  findUnique: (args: unknown) => Promise<PushNoteRow | null>;
  upsert: (args: unknown) => Promise<PushNoteRow>;
  updateMany: (args: unknown) => Promise<unknown>;
};
function pushNotesDelegate(): PushNoteDelegate | null {
  const delegate = (prisma as unknown as { agentGithubPushNote?: PushNoteDelegate })
    .agentGithubPushNote;
  return delegate?.findMany ? delegate : null;
}
function isPushNotesSchemaUnavailable(err: unknown): boolean {
  if (!Error.isError(err)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("agent_github_push_notes") ||
    msg.includes("agentgithubpushnote") ||
    msg.includes("does not exist") ||
    msg.includes("relation") && msg.includes("push")
  );
}
export function pushNotesSetupHint(): string {
  return "Run: pnpm exec prisma generate && pnpm exec prisma db execute --file prisma/migrations/20260612103000_agent_github_push_notes/migration.sql — then restart the dev server.";
}
export function sanitizeDevNote(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value.trim().slice(0, MAX_DEV_NOTE_LENGTH);
}
export async function loadAgentGithubPushNotes(agentDbId: number): Promise<PushNoteRow[]> {
  const delegate = pushNotesDelegate();
  if (!delegate) return [];
  try {
    const rows = await delegate.findMany({
      where: { agentId: agentDbId },
      select: { commitSha: true, devNote: true, hidden: true },
    });
    return rows.map((row) => ({
      commitSha: row.commitSha,
      devNote: row.devNote,
      hidden: row.hidden,
    }));
  } catch (err) {
    if (isPushNotesSchemaUnavailable(err)) return [];
    throw err;
  }
}
export async function upsertAgentGithubPushNote(
  agentDbId: number,
  commitSha: string,
  patch: { devNote?: string | null; hidden?: boolean },
): Promise<PushNoteRow> {
  const delegate = pushNotesDelegate();
  if (!delegate) {
    throw new Error(`DevProof push notes are not available. ${pushNotesSetupHint()}`);
  }
  const key = normalizeCommitShaKey(commitSha);
  if (key.length < 7) {
    throw new Error("Invalid commit sha");
  }
  const existing = await delegate.findUnique({
    where: { agentId_commitSha: { agentId: agentDbId, commitSha: key } },
  });
  const devNote =
    patch.devNote !== undefined ? sanitizeDevNote(patch.devNote) : (existing?.devNote ?? "");
  const hidden = patch.hidden !== undefined ? patch.hidden : (existing?.hidden ?? false);
  const row = await delegate.upsert({
    where: { agentId_commitSha: { agentId: agentDbId, commitSha: key } },
    create: {
      agentId: agentDbId,
      commitSha: key,
      devNote,
      hidden,
    },
    update: {
      devNote,
      hidden,
    },
    select: { commitSha: true, devNote: true, hidden: true },
  });
  return row;
}
export async function clearAgentGithubPushNote(agentDbId: number, commitSha: string): Promise<void> {
  const delegate = pushNotesDelegate();
  if (!delegate) {
    throw new Error(`DevProof push notes are not available. ${pushNotesSetupHint()}`);
  }
  const key = normalizeCommitShaKey(commitSha);
  await delegate.updateMany({
    where: { agentId: agentDbId, commitSha: key },
    data: { devNote: "" },
  });
}
type SnapshotRow = {
  commitCount30d: number;
  releaseCount: number;
  contributorCount: number;
  lastCommitAt: Date | null;
  capturedAt: Date;
  payloadJson?: unknown;
};
type ConnectionRow = {
  repoFullName: string;
  visibility: string;
  lastSyncedAt: Date | null;
};
export function extractRecentCommitsFromSnapshot(
  connection: ConnectionRow,
  snapshot: SnapshotRow,
): DevProofRecentCommit[] {
  const payload = parseDevProofPayload(connection, snapshot);
  return payload.recentCommits ?? [];
}
export function mergeSnapshotPushesWithNotes(
  connection: ConnectionRow,
  snapshot: SnapshotRow,
  notes: PushNoteRow[],
  options?: { includeHidden?: boolean },
): DevProofRecentCommit[] {
  const commits = extractRecentCommitsFromSnapshot(connection, snapshot);
  return mergePushNotes(commits, notes, options);
}
