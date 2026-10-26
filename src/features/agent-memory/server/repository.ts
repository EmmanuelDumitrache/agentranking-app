import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  AgentMemoryFactKind,
  AgentMemoryFactRecord,
  AgentMemoryFactStatus,
  AgentMemoryPageData,
  AgentMemorySettingsRecord,
} from "../shared/types";
import {
  AGENT_MEMORY_LIST_LIMIT,
  AGENT_MEMORY_MAX_LIVE_FACTS,
  AGENT_MEMORY_MAX_STORED_FACTS,
  DEFAULT_AGENT_MEMORY_SETTINGS,
} from "../shared/types";
import { memoryKeySchema } from "../shared/schemas";
import { isSafeMemoryContent } from "./safety";

type MemoryDb = PrismaClient | Prisma.TransactionClient;

type MemoryScope = {
  agentDbId: number;
  appAccountId: string;
};

export class AgentMemoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentMemoryConflictError";
  }
}

export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

export function hashMemoryContent(content: string): string {
  return createHash("sha256")
    .update(normalizeMemoryContent(content).toLowerCase())
    .digest("hex");
}

function newManualMemoryKey(): string {
  return `manual.${randomUUID()}`;
}

function validateMemoryKey(key: string): string {
  const parsed = memoryKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new AgentMemoryConflictError(
      "Memory key must be a lowercase stable dotted identifier",
    );
  }
  return parsed.data;
}

function serializeFact(row: {
  id: string;
  agentDbId: number;
  appAccountId: string;
  key: string;
  kind: string;
  content: string;
  status: string;
  confidence: number;
  salience: number;
  pinned: boolean;
  sourceRunId: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  firstLearnedAt: Date;
  lastConfirmedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AgentMemoryFactRecord {
  return {
    id: row.id,
    agentDbId: row.agentDbId,
    appAccountId: row.appAccountId,
    key: row.key,
    kind: row.kind as AgentMemoryFactKind,
    content: row.content,
    status: row.status as AgentMemoryFactStatus,
    confidence: row.confidence,
    salience: row.salience,
    pinned: row.pinned,
    sourceRunId: row.sourceRunId,
    sourceConversationId: row.sourceConversationId,
    sourceMessageId: row.sourceMessageId,
    firstLearnedAt: row.firstLearnedAt.toISOString(),
    lastConfirmedAt: row.lastConfirmedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    supersededById: row.supersededById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function withAgentMemoryLock<T>(
  prisma: PrismaClient,
  scope: MemoryScope,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const lockKey = `${scope.agentDbId}:${scope.appAccountId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    return operation(tx);
  });
}

function scopedWhere(scope: MemoryScope) {
  return {
    agentDbId: scope.agentDbId,
    appAccountId: scope.appAccountId,
  } as const;
}

function isExpired(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

function liveMemoryLifetimeWhere(now: Date): Prisma.AgentMemoryFactWhereInput {
  return {
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

async function assertLiveMemoryCapacity(
  db: MemoryDb,
  scope: MemoryScope,
  replacedLiveCount = 0,
): Promise<void> {
  const now = new Date();
  const count = await db.agentMemoryFact.count({
    where: {
      ...scopedWhere(scope),
      status: { in: ["active", "pending"] },
      ...liveMemoryLifetimeWhere(now),
    },
  });
  if (count - Math.max(0, replacedLiveCount) >= AGENT_MEMORY_MAX_LIVE_FACTS) {
    throw new AgentMemoryConflictError("Live memory limit reached");
  }
}

async function makeRoomForNewMemoryRow(
  db: MemoryDb,
  scope: MemoryScope,
): Promise<void> {
  const storedCount = await db.agentMemoryFact.count({
    where: scopedWhere(scope),
  });
  if (storedCount < AGENT_MEMORY_MAX_STORED_FACTS) return;

  const now = new Date();
  const deleteCount = storedCount - AGENT_MEMORY_MAX_STORED_FACTS + 1;
  const staleRows = await db.agentMemoryFact.findMany({
    where: {
      ...scopedWhere(scope),
      OR: [
        { status: { in: ["archived", "rejected"] } },
        { expiresAt: { lte: now } },
      ],
    },
    orderBy: [
      { pinned: "asc" },
      { lastUsedAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
      { id: "asc" },
    ],
    take: deleteCount,
    select: { id: true },
  });
  if (staleRows.length < deleteCount) {
    throw new AgentMemoryConflictError("Memory storage history limit reached");
  }

  const staleIds = staleRows.map((row) => row.id);
  await db.agentMemoryFact.updateMany({
    where: {
      ...scopedWhere(scope),
      supersededById: { in: staleIds },
    },
    data: { supersededById: null },
  });
  await db.agentMemoryFact.deleteMany({
    where: {
      ...scopedWhere(scope),
      id: { in: staleIds },
    },
  });
}

async function assertNewMemoryCapacity(
  db: MemoryDb,
  scope: MemoryScope,
  replacedLiveCount = 0,
): Promise<void> {
  await assertLiveMemoryCapacity(db, scope, replacedLiveCount);
  await makeRoomForNewMemoryRow(db, scope);
}

function validateContent(content: string): string {
  const normalized = normalizeMemoryContent(content);
  if (normalized.length < 3 || normalized.length > 500) {
    throw new AgentMemoryConflictError("Memory content must be 3-500 characters");
  }
  if (!isSafeMemoryContent(normalized)) {
    throw new AgentMemoryConflictError(
      "Memory cannot contain credentials, private keys, or policy overrides",
    );
  }
  return normalized;
}

function validateUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new AgentMemoryConflictError(`${label} must be between 0 and 1`);
  }
  return value;
}

export async function readAgentMemorySettings(
  db: MemoryDb,
  agentDbId: number,
  appAccountId: string,
): Promise<AgentMemorySettingsRecord> {
  const row = await db.agentMemorySettings.findUnique({
    where: { agentDbId_appAccountId: { agentDbId, appAccountId } },
    select: { enabled: true, requireApproval: true },
  });
  return row ?? { ...DEFAULT_AGENT_MEMORY_SETTINGS };
}

export async function updateAgentMemorySettings(
  prisma: PrismaClient,
  agentDbId: number,
  appAccountId: string,
  patch: Partial<AgentMemorySettingsRecord>,
): Promise<AgentMemorySettingsRecord> {
  return prisma.agentMemorySettings.upsert({
    where: { agentDbId_appAccountId: { agentDbId, appAccountId } },
    create: {
      agentDbId,
      appAccountId,
      enabled: patch.enabled ?? DEFAULT_AGENT_MEMORY_SETTINGS.enabled,
      requireApproval:
        patch.requireApproval ?? DEFAULT_AGENT_MEMORY_SETTINGS.requireApproval,
    },
    update: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.requireApproval !== undefined
        ? { requireApproval: patch.requireApproval }
        : {}),
    },
    select: { enabled: true, requireApproval: true },
  });
}

export async function listAgentMemoryFacts(
  db: MemoryDb,
  agentDbId: number,
  appAccountId: string,
  options: {
    status?: AgentMemoryFactStatus | AgentMemoryFactStatus[];
    limit?: number;
  } = {},
): Promise<AgentMemoryFactRecord[]> {
  const statuses = options.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : undefined;
  const liveStatusesOnly =
    statuses !== undefined &&
    statuses.every((status) => status === "active" || status === "pending");
  const rows = await db.agentMemoryFact.findMany({
    where: {
      agentDbId,
      appAccountId,
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(liveStatusesOnly ? liveMemoryLifetimeWhere(new Date()) : {}),
    },
    orderBy: [
      { pinned: "desc" },
      { lastConfirmedAt: "desc" },
      { id: "desc" },
    ],
    take: Math.max(
      1,
      Math.min(options.limit ?? AGENT_MEMORY_LIST_LIMIT, AGENT_MEMORY_LIST_LIMIT),
    ),
  });
  return rows.map(serializeFact);
}

export async function countFactsLearnedToday(
  db: MemoryDb,
  agentDbId: number,
  appAccountId: string,
): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return db.agentMemoryFact.count({
    where: {
      agentDbId,
      appAccountId,
      firstLearnedAt: { gte: start },
      status: { in: ["active", "pending"] },
      ...liveMemoryLifetimeWhere(new Date()),
    },
  });
}

export async function readAgentMemoryPageData(
  db: MemoryDb,
  agentDbId: number,
  appAccountId: string,
): Promise<AgentMemoryPageData> {
  const [settings, active, pending, learnedToday] = await Promise.all([
    readAgentMemorySettings(db, agentDbId, appAccountId),
    listAgentMemoryFacts(db, agentDbId, appAccountId, {
      status: "active",
      limit: AGENT_MEMORY_LIST_LIMIT,
    }),
    listAgentMemoryFacts(db, agentDbId, appAccountId, {
      status: "pending",
      limit: AGENT_MEMORY_LIST_LIMIT,
    }),
    countFactsLearnedToday(db, agentDbId, appAccountId),
  ]);
  return { settings, facts: { active, pending }, learnedToday };
}

export type CreateAgentMemoryFactResult = {
  fact: AgentMemoryFactRecord | null;
  created: boolean;
  revived: boolean;
};

export async function createAgentMemoryFact(
  prisma: PrismaClient,
  input: {
    agentDbId: number;
    appAccountId: string;
    key?: string;
    kind: AgentMemoryFactKind;
    content: string;
    status: AgentMemoryFactStatus;
    confidence?: number;
    salience?: number;
    pinned?: boolean;
    sourceRunId?: string | null;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    reviveInactive?: boolean;
  },
): Promise<CreateAgentMemoryFactResult> {
  const scope = { agentDbId: input.agentDbId, appAccountId: input.appAccountId };
  const content = validateContent(input.content);
  const confidence = validateUnitInterval(input.confidence ?? 0.8, "Memory confidence");
  const salience = validateUnitInterval(input.salience ?? 0.5, "Memory salience");
  const contentHash = hashMemoryContent(content);
  const requestedKey = input.key === undefined ? null : validateMemoryKey(input.key);

  return withAgentMemoryLock(prisma, scope, async (tx) => {
    const existing = await tx.agentMemoryFact.findUnique({
      where: {
        agentDbId_appAccountId_contentHash: {
          agentDbId: input.agentDbId,
          appAccountId: input.appAccountId,
          contentHash,
        },
      },
    });
    if (existing) {
      const inactive =
        existing.status === "archived" ||
        existing.status === "rejected" ||
        isExpired(existing.expiresAt);
      if (!inactive || !input.reviveInactive) {
        return { fact: serializeFact(existing), created: false, revived: false };
      }
      if (input.status === "active" || input.status === "pending") {
        await assertLiveMemoryCapacity(tx, scope);
      }
      const revived = await tx.agentMemoryFact.update({
        where: { id: existing.id },
        data: {
          key: requestedKey ?? existing.key,
          kind: input.kind,
          content,
          contentHash,
          status: input.status,
          confidence,
          salience,
          pinned: input.pinned ?? existing.pinned,
          sourceRunId: input.sourceRunId ?? null,
          sourceConversationId: input.sourceConversationId ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          lastConfirmedAt: new Date(),
          expiresAt: null,
          supersededById: null,
        },
      });
      return { fact: serializeFact(revived), created: false, revived: true };
    }
    await assertNewMemoryCapacity(tx, scope);
    const row = await tx.agentMemoryFact.create({
      data: {
        agentDbId: input.agentDbId,
        appAccountId: input.appAccountId,
        key: requestedKey ?? newManualMemoryKey(),
        kind: input.kind,
        content,
        contentHash,
        status: input.status,
        confidence,
        salience,
        pinned: input.pinned ?? false,
        sourceRunId: input.sourceRunId ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
      },
    });
    return { fact: serializeFact(row), created: true, revived: false };
  });
}

export async function upsertExtractedAgentMemory(
  prisma: PrismaClient,
  input: {
    agentDbId: number;
    appAccountId: string;
    key: string;
    kind: AgentMemoryFactKind;
    content: string;
    status: "active" | "pending";
    confidence: number;
    salience: number;
    sourceRunId: string;
    sourceConversationId: string;
    sourceMessageId: string;
  },
): Promise<{ fact: AgentMemoryFactRecord; created: boolean; superseded: number }> {
  const scope = { agentDbId: input.agentDbId, appAccountId: input.appAccountId };
  const content = validateContent(input.content);
  const confidence = validateUnitInterval(input.confidence, "Memory confidence");
  const salience = validateUnitInterval(input.salience, "Memory salience");
  const contentHash = hashMemoryContent(content);
  const key = validateMemoryKey(input.key);
  const now = new Date();

  return withAgentMemoryLock(prisma, scope, async (tx) => {
    const keyed = await tx.agentMemoryFact.findMany({
      where: {
        ...scopedWhere(scope),
        key,
        status: { in: ["active", "pending"] },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const sameContent = await tx.agentMemoryFact.findUnique({
      where: {
        agentDbId_appAccountId_contentHash: {
          agentDbId: input.agentDbId,
          appAccountId: input.appAccountId,
          contentHash,
        },
      },
    });

    const inheritedPinned = keyed.some((row) => row.pinned);
    const liveKeyed = keyed.filter((row) => !isExpired(row.expiresAt, now));
    let fact;
    let created = false;
    if (sameContent) {
      // A pending extraction that merely confirms an already-approved memory
      // must not demote it back to pending. Confirmation can safely refresh its
      // provenance/confidence without creating a new approval obligation.
      const nextStatus =
        sameContent.status === "active" && input.status === "pending"
          ? "active"
          : input.status;
      if (
        (sameContent.status === "archived" ||
          sameContent.status === "rejected" ||
          isExpired(sameContent.expiresAt, now)) &&
        (nextStatus === "active" || nextStatus === "pending")
      ) {
        const replacedLiveCount = liveKeyed.filter(
          (row) =>
            row.id !== sameContent.id &&
            (nextStatus === "active" || row.status === "pending"),
        ).length;
        await assertLiveMemoryCapacity(tx, scope, replacedLiveCount);
      }
      fact = await tx.agentMemoryFact.update({
        where: { id: sameContent.id },
        data: {
          key,
          kind: input.kind,
          content,
          status: nextStatus,
          confidence: Math.max(sameContent.confidence, confidence),
          salience: Math.max(sameContent.salience, salience),
          pinned: sameContent.pinned || inheritedPinned,
          sourceRunId: input.sourceRunId,
          sourceConversationId: input.sourceConversationId,
          sourceMessageId: input.sourceMessageId,
          lastConfirmedAt: now,
          expiresAt: null,
          supersededById: null,
        },
      });
    } else {
      const replacedLiveCount = liveKeyed.filter(
        (row) => input.status === "active" || row.status === "pending",
      ).length;
      await assertNewMemoryCapacity(tx, scope, replacedLiveCount);
      fact = await tx.agentMemoryFact.create({
        data: {
          agentDbId: input.agentDbId,
          appAccountId: input.appAccountId,
          key,
          kind: input.kind,
          content,
          contentHash,
          status: input.status,
          confidence,
          salience,
          pinned: inheritedPinned,
          sourceRunId: input.sourceRunId,
          sourceConversationId: input.sourceConversationId,
          sourceMessageId: input.sourceMessageId,
          lastConfirmedAt: now,
        },
      });
      created = true;
    }

    // Pending replacements coexist with the currently approved value until a
    // human approves them, but a newer pending candidate replaces older pending
    // candidates for the same semantic key. Activating a candidate supersedes
    // every other active/pending representation of that concept.
    const supersedeIds = keyed
      .filter(
        (row) =>
          row.id !== fact.id &&
          (fact.status === "active" ||
            (fact.status === "pending" && row.status === "pending")),
      )
      .map((row) => row.id);
    if (supersedeIds.length > 0) {
      await tx.agentMemoryFact.updateMany({
        where: { id: { in: supersedeIds } },
        data: { status: "archived", supersededById: fact.id },
      });
    }
    return { fact: serializeFact(fact), created, superseded: supersedeIds.length };
  });
}

export async function forgetAgentMemoryByKey(
  prisma: PrismaClient,
  scope: MemoryScope,
  key: string,
): Promise<number> {
  const canonicalKey = validateMemoryKey(key);
  return withAgentMemoryLock(prisma, scope, async (tx) => {
    const result = await tx.agentMemoryFact.updateMany({
      where: {
        ...scopedWhere(scope),
        key: canonicalKey,
        status: { in: ["active", "pending"] },
      },
      data: { status: "archived", supersededById: null },
    });
    return result.count;
  });
}

export async function updateAgentMemoryFact(
  prisma: PrismaClient,
  agentDbId: number,
  appAccountId: string,
  factId: string,
  patch: {
    kind?: AgentMemoryFactKind;
    content?: string;
    status?: AgentMemoryFactStatus;
    pinned?: boolean;
  },
): Promise<AgentMemoryFactRecord | null> {
  const scope = { agentDbId, appAccountId };
  return withAgentMemoryLock(prisma, scope, async (tx) => {
    const existing = await tx.agentMemoryFact.findFirst({
      where: { id: factId, ...scopedWhere(scope) },
    });
    if (!existing) return null;
    const nextContent =
      patch.content !== undefined ? validateContent(patch.content) : existing.content;
    const contentHash =
      patch.content !== undefined ? hashMemoryContent(nextContent) : existing.contentHash;

    if (contentHash !== existing.contentHash) {
      const duplicate = await tx.agentMemoryFact.findUnique({
        where: {
          agentDbId_appAccountId_contentHash: {
            agentDbId,
            appAccountId,
            contentHash,
          },
        },
      });
      if (duplicate && duplicate.id !== factId) {
        throw new AgentMemoryConflictError("A memory with this content already exists");
      }
    }
    const existingLive =
      (existing.status === "active" || existing.status === "pending") &&
      !isExpired(existing.expiresAt);
    const activating =
      patch.status === "active" &&
      (existing.status !== "active" || isExpired(existing.expiresAt));
    const competing = activating
      ? await tx.agentMemoryFact.findMany({
          where: {
            ...scopedWhere(scope),
            key: existing.key,
            id: { not: factId },
            status: { in: ["active", "pending"] },
          },
          select: { id: true, status: true, expiresAt: true },
        })
      : [];
    if (
      patch.status &&
      ["active", "pending"].includes(patch.status) &&
      !existingLive
    ) {
      const replacedLiveCount =
        patch.status === "active"
          ? competing.filter((fact) => !isExpired(fact.expiresAt)).length
          : 0;
      await assertLiveMemoryCapacity(tx, scope, replacedLiveCount);
    }

    const row = await tx.agentMemoryFact.update({
      where: { id: factId },
      data: {
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.content !== undefined
          ? { content: nextContent, contentHash, lastConfirmedAt: new Date() }
          : {}),
        ...(patch.status !== undefined
          ? {
              status: patch.status,
              supersededById: patch.status === "active" ? null : undefined,
              ...((patch.status === "active" || patch.status === "pending")
                ? { expiresAt: null }
                : {}),
            }
          : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      },
    });
    if (patch.pinned !== undefined) {
      // Pinning is a semantic-key preference, not a historical-row property.
      // Keep a currently active value and any pending replacement aligned so
      // approving a correction cannot accidentally lose (or resurrect) a pin.
      await tx.agentMemoryFact.updateMany({
        where: {
          ...scopedWhere(scope),
          key: existing.key,
          id: { not: factId },
          status: { in: ["active", "pending"] },
        },
        data: { pinned: patch.pinned },
      });
    }
    if (row.status === "active" && competing.length > 0) {
      await tx.agentMemoryFact.updateMany({
        where: { id: { in: competing.map((fact) => fact.id) } },
        data: { status: "archived", supersededById: row.id },
      });
    }
    return serializeFact(row);
  });
}

export async function archiveAgentMemoryFact(
  prisma: PrismaClient,
  agentDbId: number,
  appAccountId: string,
  factId: string,
): Promise<boolean> {
  return Boolean(
    await updateAgentMemoryFact(prisma, agentDbId, appAccountId, factId, {
      status: "archived",
    }),
  );
}
