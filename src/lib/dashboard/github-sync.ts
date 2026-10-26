import { createHmac, sign as signData, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeGithubRepoFullName } from "@/lib/dashboard/github-repo-parse";
import { requestPublicHttp, type OutboundHttpResponse } from "@/lib/outbound-http";
import { upsertAgentSignals } from "@/lib/signals/store";
type RepoStats = {
  commitCount30d: number;
  releaseCount: number;
  contributorCount: number;
  lastCommitAt: Date | null;
  payload: Record<string, unknown>;
};
type GithubCommitRow = {
  sha?: string;
  html_url?: string;
  commit?: { message?: string; author?: { date?: string } };
  author?: { login?: string | null } | null;
};
type GithubReleaseRow = {
  tag_name?: string;
  name?: string;
  published_at?: string;
};
type GithubRepoRow = {
  description?: string | null;
  language?: string | null;
  default_branch?: string;
  pushed_at?: string;
};
function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
let githubAppJwtCache:
  | { appId: string; privateKeyPem: string; expiresAtMs: number; jwt: string }
  | undefined;
let githubAppJwtInFlight:
  | { appId: string; privateKeyPem: string; promise: Promise<string> }
  | undefined;
export async function createGithubAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const cached = githubAppJwtCache;
  if (
    cached?.appId === appId &&
    cached.privateKeyPem === privateKeyPem &&
    cached.expiresAtMs - Date.now() > 60_000
  ) {
    return cached.jwt;
  }
  const inFlight = githubAppJwtInFlight;
  if (inFlight?.appId === appId && inFlight.privateKeyPem === privateKeyPem) {
    return inFlight.promise;
  }
  const promise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64UrlEncode(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
    );
    const signingInput = `${header}.${payload}`;
    const key = privateKeyPem.includes("\\n")
      ? privateKeyPem.replace(/\\n/g, "\n")
      : privateKeyPem;
    const signature = await new Promise<Buffer>((resolve, reject) => {
      signData("RSA-SHA256", Buffer.from(signingInput), key, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
    const jwt = `${signingInput}.${signature.toString("base64url")}`;
    githubAppJwtCache = {
      appId,
      privateKeyPem,
      expiresAtMs: (now + 540) * 1_000,
      jwt,
    };
    return jwt;
  })();
  githubAppJwtInFlight = { appId, privateKeyPem, promise };
  try {
    return await promise;
  } finally {
    if (githubAppJwtInFlight?.promise === promise) githubAppJwtInFlight = undefined;
  }
}
async function githubRequest(
  path: string,
  token?: string,
  method: "GET" | "POST" = "GET",
): Promise<OutboundHttpResponse> {
  if (!path.startsWith("/")) throw new Error("GitHub API path must be absolute");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AgentRanking-DevProof",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return requestPublicHttp(`https://api.github.com${path}`, {
    method,
    headers,
    timeoutMs: 20_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxRedirects: 0,
  });
}
function githubJson<T>(response: OutboundHttpResponse, context: string): T {
  if (response.truncated) throw new Error(`${context}: GitHub response exceeded 2 MiB`);
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`${context}: GitHub returned invalid JSON (HTTP ${response.status})`);
  }
}
function githubApiError(response: OutboundHttpResponse, context: string): Error {
  let detail = "";
  try {
    detail = String((JSON.parse(response.body) as { message?: unknown }).message ?? "").trim();
  } catch {
    detail = response.body.trim().slice(0, 300);
  }
  return new Error(`${context} (HTTP ${response.status}${detail ? `: ${detail}` : ""})`);
}
async function getInstallationAccessToken(installationId: string): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) return null;
  const jwt = await createGithubAppJwt(appId, privateKey);
  const response = await githubRequest(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, jwt, "POST");
  if (response.status < 200 || response.status >= 300) {
    throw githubApiError(response, `Could not create a GitHub installation token for ${installationId}`);
  }
  const data = githubJson<{ token?: unknown }>(response, "GitHub installation token response");
  return typeof data.token === "string" && data.token.trim() ? data.token.trim() : null;
}
function parseRepoFullName(repoFullName: string): { owner: string; repo: string } | null {
  const normalized = normalizeGithubRepoFullName(repoFullName);
  if (!normalized) return null;
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}
function paginationCount(response: OutboundHttpResponse, rowsOnPage: number): number {
  const link = Array.isArray(response.headers.link) ? response.headers.link[0] : response.headers.link;
  if (!link) return rowsOnPage;
  for (const part of link.split(",")) {
    if (!part.includes('rel="last"')) continue;
    const match = /[?&]page=(\d+)/.exec(part);
    const page = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
    if (Number.isSafeInteger(page) && page >= rowsOnPage) return page;
  }
  return rowsOnPage;
}
function parseList<T>(response: OutboundHttpResponse, context: string, emptyStatuses: number[] = []): T[] {
  if (emptyStatuses.includes(response.status)) return [];
  if (response.status < 200 || response.status >= 300) throw githubApiError(response, context);
  const value = githubJson<unknown>(response, context);
  if (!Array.isArray(value)) throw new Error(`${context}: expected a JSON array`);
  return value as T[];
}
export async function fetchRepoStats(
  repoFullName: string,
  installationId?: string,
): Promise<RepoStats> {
  const parsed = parseRepoFullName(repoFullName);
  if (!parsed) throw new Error(`Invalid repository name: ${repoFullName}`);
  const { owner: ghOwner, repo: ghRepo } = parsed;
  const token =
    (installationId ? await getInstallationAccessToken(installationId) : null) ??
    process.env.GITHUB_PAT?.trim() ??
    null;
  const since = encodeURIComponent(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const base = `/repos/${encodeURIComponent(ghOwner)}/${encodeURIComponent(ghRepo)}`;
  const [repoRes, commitsRes, recentPushesRes, releasesRes, contributorsRes] = await Promise.all([
    githubRequest(base, token ?? undefined),
    githubRequest(`${base}/commits?since=${since}&per_page=1`, token ?? undefined),
    githubRequest(`${base}/commits?per_page=8`, token ?? undefined),
    githubRequest(`${base}/releases?per_page=1`, token ?? undefined),
    githubRequest(`${base}/contributors?per_page=1&anon=true`, token ?? undefined),
  ]);
  if (repoRes.status < 200 || repoRes.status >= 300) {
    throw githubApiError(repoRes, `Could not read repository ${repoFullName}`);
  }
  const repoMeta = githubJson<GithubRepoRow>(repoRes, `Repository ${repoFullName}`);
  const commits = parseList<GithubCommitRow>(commitsRes, `Could not read commits for ${repoFullName}`, [409]);
  const recentPushRows = parseList<GithubCommitRow>(recentPushesRes, `Could not read recent commits for ${repoFullName}`, [409]);
  const releases = parseList<GithubReleaseRow>(releasesRes, `Could not read releases for ${repoFullName}`);
  const contributors = parseList<unknown>(contributorsRes, `Could not read contributors for ${repoFullName}`, [204, 409]);
  const firstCommit = recentPushRows[0] ?? commits[0];
  const lastCommitAt = firstCommit?.commit?.author?.date
    ? new Date(firstCommit.commit.author.date)
    : null;
  if (lastCommitAt && !Number.isFinite(lastCommitAt.getTime())) {
    throw new Error(`GitHub returned an invalid commit timestamp for ${repoFullName}`);
  }
  function mapCommitRow(row: GithubCommitRow) {
    const fullSha = row.sha?.trim();
    const sha = fullSha?.slice(0, 7);
    const rawMessage = row.commit?.message?.split("\n")[0]?.trim();
    const committedAt = row.commit?.author?.date;
    if (!sha || !rawMessage || !committedAt) return null;
    const parsedDate = new Date(committedAt);
    if (!Number.isFinite(parsedDate.getTime())) return null;
    const message = rawMessage.length > 120 ? `${rawMessage.slice(0, 117)}…` : rawMessage;
    return {
      sha,
      fullSha: fullSha ?? sha,
      message,
      authorLogin: row.author?.login?.trim() || null,
      committedAt,
      htmlUrl: row.html_url?.trim() || (fullSha ? `https://github.com/${ghOwner}/${ghRepo}/commit/${fullSha}` : null),
    };
  }
  const recentCommits = recentPushRows
    .map(mapCommitRow)
    .filter((row): row is NonNullable<typeof row> => row != null);
  const latestReleaseRow = releases[0];
  const latestRelease = latestReleaseRow?.tag_name && latestReleaseRow.published_at
    ? {
        tagName: latestReleaseRow.tag_name,
        name: latestReleaseRow.name?.trim() || latestReleaseRow.tag_name,
        publishedAt: latestReleaseRow.published_at,
      }
    : null;
  return {
    commitCount30d: paginationCount(commitsRes, commits.length),
    releaseCount: paginationCount(releasesRes, releases.length),
    contributorCount: paginationCount(contributorsRes, contributors.length),
    lastCommitAt,
    payload: {
      repoFullName,
      fetchedAt: new Date().toISOString(),
      viaInstallation: Boolean(installationId && token),
      description: repoMeta.description?.trim() || null,
      language: repoMeta.language?.trim() || null,
      defaultBranch: repoMeta.default_branch?.trim() || null,
      pushedAt: repoMeta.pushed_at || null,
      recentCommits,
      latestRelease,
    },
  };
}
export async function syncGithubConnectionForAgent(agentDbId: number, connectionId?: string) {
  const connection = connectionId
    ? await prisma.agentGithubConnection.findFirst({
        where: { id: connectionId, agentId: agentDbId },
      })
    : await prisma.agentGithubConnection.findFirst({
        where: { agentId: agentDbId, status: { in: ["pending", "active"] } },
        orderBy: { createdAt: "desc" },
      });
  if (!connection?.repoFullName) {
    throw new Error("No GitHub connection for agent");
  }
  if (connection.status !== "pending" && connection.status !== "active") {
    throw new Error("GitHub connection is not active or pending");
  }
  const stats = await fetchRepoStats(
    connection.repoFullName,
    connection.githubInstallationId || undefined,
  );
  const active =
    stats.commitCount30d > 0 || stats.releaseCount > 0 || stats.contributorCount > 1;
  const checkedAt = new Date();
  return prisma.$transaction(async (tx) => {
    // Lease the connection row before persisting anything. A concurrent
    // installation removal changes the status to disconnected and makes this
    // conditional update fail instead of allowing a stale sync to reactivate it.
    const leased = await tx.agentGithubConnection.updateMany({
      where: {
        id: connection.id,
        agentId: agentDbId,
        repoFullName: connection.repoFullName,
        status: { in: ["pending", "active"] },
      },
      data: { status: "pending" },
    });
    if (leased.count !== 1) {
      throw new Error("GitHub connection changed or was disconnected during synchronization");
    }
    const snapshot = await tx.agentGithubSnapshot.create({
      data: {
        agentId: agentDbId,
        connectionId: connection.id,
        commitCount30d: stats.commitCount30d,
        releaseCount: stats.releaseCount,
        contributorCount: stats.contributorCount,
        lastCommitAt: stats.lastCommitAt,
        payloadJson: stats.payload as Prisma.InputJsonValue,
      },
    });
    await upsertAgentSignals(agentDbId, [
      {
        signalType: "repo_connected",
        status: "verified",
        source: "github_app",
        confidence: "high",
        value: connection.repoFullName,
        verifiedAt: checkedAt,
        lastCheckedAt: checkedAt,
        expiresAt: null,
      },
      {
        signalType: "devproof_active",
        status: active ? "verified" : "detected",
        source: "github_app",
        confidence: active ? "high" : "medium",
        value: connection.repoFullName,
        verifiedAt: active ? checkedAt : null,
        lastCheckedAt: checkedAt,
        expiresAt: null,
      },
    ], tx);
    const updatedConnection = await tx.agentGithubConnection.update({
      where: { id: connection.id },
      data: { status: "active", lastSyncedAt: checkedAt },
    });
    return { connection: updatedConnection, snapshot, stats };
  });
}
export function verifyGithubWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = `sha256=${digest}`;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}
export type NormalizedGithubWebhookEvent = {
  event: string;
  action: string | null;
  installationId: string | null;
  repositories: Array<{ fullName: string; repoId: string | null }>;
  removedRepositories: Array<{ fullName: string; repoId: string | null }>;
  repositoryFullName: string | null;
};
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function optionalString(value: unknown, maxLength = 300): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
function optionalIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return optionalString(value, 100);
}
export function normalizeGithubWebhookEvent(
  event: string,
  payload: Record<string, unknown>,
): NormalizedGithubWebhookEvent {
  const installation = objectValue(payload.installation);
  const repository = objectValue(payload.repository);
  const normalizeRepositories = (value: unknown) => Array.isArray(value)
    ? value.slice(0, 1_000).flatMap((item) => {
        const row = objectValue(item);
        const fullName = row ? optionalString(row.full_name) : null;
        const normalized = fullName ? normalizeGithubRepoFullName(fullName) : null;
        return normalized ? [{ fullName: normalized, repoId: optionalIdentifier(row?.id) }] : [];
      })
    : [];
  const eventName = event.trim().slice(0, 100);
  const repositories = normalizeRepositories(
    eventName === "installation_repositories"
      ? payload.repositories_added
      : payload.repositories,
  );
  const removedRepositories = normalizeRepositories(payload.repositories_removed);
  return {
    event: eventName,
    action: optionalString(payload.action, 100),
    installationId: optionalIdentifier(installation?.id),
    repositories,
    removedRepositories,
    repositoryFullName: normalizeGithubRepoFullName(optionalString(repository?.full_name) ?? ""),
  };
}
async function markGithubConnectionsDisconnected(
  connections: Array<{ id: string; agentId: number }>,
): Promise<void> {
  if (connections.length === 0) return;
  const connectionIds = connections.map((connection) => connection.id);
  const affectedAgentIds = [...new Set(connections.map((connection) => connection.agentId))];
  await prisma.$transaction(async (tx) => {
    // Lock and transition connection rows before touching signal rows. Sync uses
    // the same connection-then-signals lock order, avoiding stale reactivation
    // and reducing deadlock risk under concurrent webhook delivery.
    await tx.agentGithubConnection.updateMany({
      where: { id: { in: connectionIds } },
      data: { status: "disconnected" },
    });
    for (const agentId of affectedAgentIds) {
      const remaining = await tx.agentGithubConnection.findFirst({
        where: { agentId, status: "active" },
        select: { repoFullName: true },
      });
      if (remaining) continue;
      const checkedAt = new Date();
      await upsertAgentSignals(agentId, [
        {
          signalType: "repo_connected",
          status: "disabled",
          source: "github_app",
          confidence: "high",
          value: "",
          verifiedAt: null,
          lastCheckedAt: checkedAt,
          expiresAt: null,
        },
        {
          signalType: "devproof_active",
          status: "disabled",
          source: "github_app",
          confidence: "high",
          value: "",
          verifiedAt: null,
          lastCheckedAt: checkedAt,
          expiresAt: null,
        },
      ], tx);
    }
  });
}
/** Handle normalized installation / push / release webhook payloads. */
export async function handleNormalizedGithubWebhookEvent(
  input: NormalizedGithubWebhookEvent,
): Promise<{ handled: boolean; agentIds: number[] }> {
  const agentIds = new Set<number>();
  async function connectRepositories(
    repositories: Array<{ fullName: string; repoId: string | null }>,
  ): Promise<void> {
    for (const repo of repositories) {
      const connections = await prisma.agentGithubConnection.findMany({
        where: { repoFullName: { equals: repo.fullName, mode: "insensitive" }, status: { in: ["pending", "active", "disconnected"] } },
      });
      for (const conn of connections) {
        await prisma.agentGithubConnection.update({
          where: { id: conn.id },
          data: {
            githubInstallationId: input.installationId ?? conn.githubInstallationId,
            repoId: repo.repoId ?? conn.repoId,
            status: "pending",
          },
        });
        await syncGithubConnectionForAgent(conn.agentId, conn.id);
        agentIds.add(conn.agentId);
      }
    }
  }
  if (input.event === "installation" && input.action === "created") {
    await connectRepositories(input.repositories);
    return { handled: true, agentIds: [...agentIds] };
  }
  if (
    input.event === "installation" &&
    (input.action === "deleted" || input.action === "suspend") &&
    input.installationId
  ) {
    const connections = await prisma.agentGithubConnection.findMany({
      where: { githubInstallationId: input.installationId, status: { not: "disconnected" } },
      select: { id: true, agentId: true },
    });
    if (connections.length > 0) {
      await markGithubConnectionsDisconnected(connections);
      connections.forEach((connection) => agentIds.add(connection.agentId));
    }
    return { handled: true, agentIds: [...agentIds] };
  }
  if (input.event === "installation" && input.action === "unsuspend" && input.installationId) {
    const connections = await prisma.agentGithubConnection.findMany({
      where: { githubInstallationId: input.installationId, status: "disconnected" },
    });
    for (const connection of connections) {
      await prisma.agentGithubConnection.updateMany({
        where: { id: connection.id, status: "disconnected" },
        data: { status: "pending" },
      });
      // syncGithubConnectionForAgent activates only after snapshot and signals
      // commit atomically. A failure leaves this row pending for job retry.
      await syncGithubConnectionForAgent(connection.agentId, connection.id);
      agentIds.add(connection.agentId);
    }
    return { handled: true, agentIds: [...agentIds] };
  }
  if (input.event === "installation_repositories") {
    if (input.action === "added") await connectRepositories(input.repositories);
    if (input.action === "removed" && input.removedRepositories.length > 0) {
      const names = input.removedRepositories.map((repository) => repository.fullName);
      const connections = await prisma.agentGithubConnection.findMany({
        where: {
          repoFullName: { in: names, mode: "insensitive" },
          ...(input.installationId ? { githubInstallationId: input.installationId } : {}),
          status: { not: "disconnected" },
        },
        select: { id: true, agentId: true },
      });
      if (connections.length > 0) {
        await markGithubConnectionsDisconnected(connections);
        connections.forEach((connection) => agentIds.add(connection.agentId));
      }
    }
    return { handled: input.action === "added" || input.action === "removed", agentIds: [...agentIds] };
  }
  if (input.event === "push" || input.event === "release") {
    if (!input.repositoryFullName) return { handled: false, agentIds: [] };
    const connections = await prisma.agentGithubConnection.findMany({
      where: { repoFullName: { equals: input.repositoryFullName, mode: "insensitive" }, status: "active" },
    });
    for (const conn of connections) {
      await syncGithubConnectionForAgent(conn.agentId, conn.id);
      agentIds.add(conn.agentId);
    }
    return { handled: connections.length > 0, agentIds: [...agentIds] };
  }
  return { handled: false, agentIds: [] };
}
