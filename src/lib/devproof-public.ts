import { getOrInsertComputed } from "@/lib/map-upsert";
export type DevProofRecentCommit = {
  sha: string;
  fullSha?: string | null;
  message: string;
  authorLogin: string | null;
  committedAt: string;
  htmlUrl?: string | null;
  devNote?: string | null;
  hidden?: boolean;
};
export type DevProofLatestRelease = {
  tagName: string;
  name: string;
  publishedAt: string;
};
export type AgentDevProofPayload = {
  repoFullName: string;
  visibility: string;
  lastSyncedAt: string | null;
  commitCount30d: number;
  releaseCount: number;
  contributorCount: number;
  lastCommitAt: string | null;
  capturedAt: string;
  description?: string | null;
  language?: string | null;
  defaultBranch?: string | null;
  pushedAt?: string | null;
  recentCommits?: DevProofRecentCommit[];
  latestRelease?: DevProofLatestRelease | null;
};
type SnapshotScalars = {
  commitCount30d: number;
  releaseCount: number;
  contributorCount: number;
  lastCommitAt: Date | null;
  capturedAt: Date;
  payloadJson?: unknown;
};
type ConnectionFields = {
  repoFullName: string;
  visibility: string;
  lastSyncedAt: Date | null;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
/** Normalize GitHub commit sha for DB keys (7-char prefix). */
export function normalizeCommitShaKey(sha: string): string {
  return sha.trim().toLowerCase().slice(0, 7);
}
export type PushNoteRow = {
  commitSha: string;
  devNote: string;
  hidden: boolean;
};
export function mergePushNotes(
  commits: DevProofRecentCommit[],
  notes: PushNoteRow[],
  options?: { includeHidden?: boolean },
): DevProofRecentCommit[] {
  const includeHidden = options?.includeHidden ?? false;
  const noteByKey = new Map(notes.map((n) => [normalizeCommitShaKey(n.commitSha), n]));
  return commits
    .map((commit) => {
      const key = normalizeCommitShaKey(commit.fullSha ?? commit.sha);
      const note = noteByKey.get(key);
      return {
        ...commit,
        devNote: note?.devNote?.trim() || null,
        hidden: note?.hidden ?? false,
      };
    })
    .filter((commit) => includeHidden || !commit.hidden);
}
export function formatPushDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function groupPushesByDate(
  commits: DevProofRecentCommit[],
): Array<{ dateLabel: string; dateKey: string; pushes: DevProofRecentCommit[] }> {
  const buckets = new Map<string, DevProofRecentCommit[]>();
  for (const push of commits) {
    const d = new Date(push.committedAt);
    const dateKey = Number.isNaN(d.getTime())
      ? "unknown"
      : d.toISOString().slice(0, 10);
    getOrInsertComputed(buckets, dateKey, () => []).push(push);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, pushes]) => ({
      dateKey,
      dateLabel:
        dateKey === "unknown"
          ? "Unknown date"
          : formatPushDateLabel(`${dateKey}T12:00:00.000Z`),
      pushes,
    }));
}
function parseRecentCommits(value: unknown): DevProofRecentCommit[] {
  if (!Array.isArray(value)) return [];
  const commits: DevProofRecentCommit[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const sha = readString(item.sha);
    const message = readString(item.message);
    const committedAt = readString(item.committedAt);
    if (!sha || !message || !committedAt) continue;
    commits.push({
      sha,
      fullSha: readString(item.fullSha) ?? sha,
      message,
      authorLogin: readString(item.authorLogin),
      committedAt,
      htmlUrl: readString(item.htmlUrl),
    });
  }
  return commits;
}
function parseLatestRelease(value: unknown): DevProofLatestRelease | null {
  if (!isRecord(value)) return null;
  const tagName = readString(value.tagName);
  const publishedAt = readString(value.publishedAt);
  if (!tagName || !publishedAt) return null;
  return {
    tagName,
    name: readString(value.name) ?? tagName,
    publishedAt,
  };
}
function parsePayloadJson(payloadJson: unknown): Partial<
  Pick<
    AgentDevProofPayload,
    | "description"
    | "language"
    | "defaultBranch"
    | "pushedAt"
    | "recentCommits"
    | "latestRelease"
  >
> {
  if (!isRecord(payloadJson)) return {};
  return {
    description: readString(payloadJson.description),
    language: readString(payloadJson.language),
    defaultBranch: readString(payloadJson.defaultBranch),
    pushedAt: readString(payloadJson.pushedAt),
    recentCommits: parseRecentCommits(payloadJson.recentCommits),
    latestRelease: parseLatestRelease(payloadJson.latestRelease),
  };
}
export function parseDevProofPayload(
  connection: ConnectionFields,
  snapshot: SnapshotScalars,
): AgentDevProofPayload {
  const isPrivate = connection.visibility === "private";
  const extras = parsePayloadJson(snapshot.payloadJson);
  return {
    repoFullName: isPrivate ? "" : connection.repoFullName,
    visibility: connection.visibility,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    commitCount30d: snapshot.commitCount30d,
    releaseCount: snapshot.releaseCount,
    contributorCount: snapshot.contributorCount,
    lastCommitAt: snapshot.lastCommitAt?.toISOString() ?? null,
    capturedAt: snapshot.capturedAt.toISOString(),
    ...extras,
  };
}