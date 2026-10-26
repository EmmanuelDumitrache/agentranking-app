import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MAX_AGENT_SCHEDULES_PER_AGENT } from "@/lib/agent-schedule/constants";
import {
  computeNextRunAt,
  frequencyToCronExpr,
  isValidCronExpr,
} from "@/lib/agent-schedule/cron";
import { mapScheduleRow, mapScheduleRunRow } from "@/lib/agent-schedule/mappers";
import type {
  AgentScheduleFrequency,
  AgentScheduleRow,
  AgentScheduleRunRow,
  AgentScheduleStatus,
  AgentScheduleType,
  CreateAgentScheduleInput,
  UpdateAgentScheduleInput,
} from "@/lib/agent-schedule/types";

const SCHEDULE_TYPES = new Set<AgentScheduleType>(["prompt", "report", "trade"]);
const SCHEDULE_STATUSES = new Set<AgentScheduleStatus>(["active", "paused", "completed"]);

export async function listAgentSchedules(
  agentDbId: number,
): Promise<AgentScheduleRow[]> {
  const rows = await prisma.agentSchedule.findMany({
    where: { agentDbId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, outputSummary: true },
      },
    },
  });
  return rows.map(mapScheduleRow);
}

export async function getAgentSchedule(
  agentDbId: number,
  scheduleId: string,
): Promise<AgentScheduleRow | null> {
  const row = await prisma.agentSchedule.findFirst({
    where: { id: scheduleId, agentDbId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, outputSummary: true },
      },
    },
  });
  return row ? mapScheduleRow(row) : null;
}

export async function listAgentScheduleRuns(
  scheduleId: string,
  limit = 20,
): Promise<AgentScheduleRunRow[]> {
  const rows = await prisma.agentScheduleRun.findMany({
    where: { scheduleId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapScheduleRunRow);
}

export async function createAgentSchedule(
  agentDbId: number,
  appAccountId: string,
  input: CreateAgentScheduleInput,
): Promise<AgentScheduleRow> {
  const existingCount = await prisma.agentSchedule.count({ where: { agentDbId } });
  if (existingCount >= MAX_AGENT_SCHEDULES_PER_AGENT) {
    throw new Error(
      `You can schedule up to ${MAX_AGENT_SCHEDULES_PER_AGENT} recurring tasks per agent`,
    );
  }

  const cronExpr = frequencyToCronExpr(input.frequency);
  const type = normalizeType(input.type);
  if (input.frequency.kind === "once") {
    const runAt = new Date(input.frequency.runAtUtc);
    if (runAt.getTime() <= Date.now()) {
      throw new Error("One-time tasks must be scheduled in the future");
    }
  }
  const maxOrder = await prisma.agentSchedule.aggregate({
    where: { agentDbId },
    _max: { sortOrder: true },
  });
  const nextRunAt = computeNextRunAt(cronExpr);
  const created = await prisma.agentSchedule.create({
    data: {
      agentDbId,
      appAccountId,
      label: input.label.trim(),
      type,
      modelKey: input.modelKey.trim(),
      promptText: input.promptText.trim(),
      cronExpr,
      nextRunAt,
      missedPolicy: input.missedPolicy ?? "skip",
      tradeConfig: input.tradeConfig ?? undefined,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, outputSummary: true },
      },
    },
  });
  return mapScheduleRow(created);
}

export async function updateAgentSchedule(
  agentDbId: number,
  scheduleId: string,
  input: UpdateAgentScheduleInput,
): Promise<AgentScheduleRow | null> {
  const existing = await prisma.agentSchedule.findFirst({
    where: { id: scheduleId, agentDbId },
  });
  if (!existing) return null;

  let cronExpr = existing.cronExpr;
  let nextRunAt = existing.nextRunAt;
  if (input.frequency) {
    cronExpr = frequencyToCronExpr(input.frequency);
    nextRunAt = computeNextRunAt(cronExpr);
  }

  const updated = await prisma.agentSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.type !== undefined ? { type: normalizeType(input.type) } : {}),
      ...(input.status !== undefined && SCHEDULE_STATUSES.has(input.status)
        ? { status: input.status }
        : {}),
      ...(input.modelKey !== undefined ? { modelKey: input.modelKey.trim() } : {}),
      ...(input.promptText !== undefined
        ? { promptText: input.promptText.trim() }
        : {}),
      ...(input.missedPolicy !== undefined ? { missedPolicy: input.missedPolicy } : {}),
      ...(input.tradeConfig !== undefined
        ? {
            tradeConfig:
              input.tradeConfig === null
                ? Prisma.JsonNull
                : (input.tradeConfig as Prisma.InputJsonValue),
          }
        : {}),
      ...(input.frequency ? { cronExpr, nextRunAt } : {}),
    },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, outputSummary: true },
      },
    },
  });
  return mapScheduleRow(updated);
}

export async function deleteAgentSchedule(
  agentDbId: number,
  scheduleId: string,
): Promise<boolean> {
  const result = await prisma.agentSchedule.deleteMany({
    where: { id: scheduleId, agentDbId },
  });
  return result.count > 0;
}

export async function reorderAgentSchedules(
  agentDbId: number,
  orderedIds: readonly string[],
): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.agentSchedule.updateMany({
        where: { id, agentDbId },
        data: { sortOrder: index },
      }),
    ),
  );
}

export function parseFrequencyBody(
  body: unknown,
): AgentScheduleFrequency | null {
  if (!body || typeof body !== "object") return null;
  const freq = body as Record<string, unknown>;
  const kind = freq.kind;
  if (kind === "hourly" && typeof freq.minuteUtc === "number") {
    return { kind: "hourly", minuteUtc: freq.minuteUtc };
  }
  if (
    kind === "daily"
    && typeof freq.hourUtc === "number"
    && typeof freq.minuteUtc === "number"
  ) {
    return { kind: "daily", hourUtc: freq.hourUtc, minuteUtc: freq.minuteUtc };
  }
  if (
    kind === "weekly"
    && typeof freq.dayOfWeekUtc === "number"
    && typeof freq.hourUtc === "number"
    && typeof freq.minuteUtc === "number"
  ) {
    return {
      kind: "weekly",
      dayOfWeekUtc: freq.dayOfWeekUtc,
      hourUtc: freq.hourUtc,
      minuteUtc: freq.minuteUtc,
    };
  }
  if (kind === "once" && typeof freq.runAtUtc === "string") {
    const runAt = new Date(freq.runAtUtc);
    if (Number.isNaN(runAt.getTime())) return null;
    return { kind: "once", runAtUtc: runAt.toISOString() };
  }
  if (kind === "custom" && typeof freq.cronExpr === "string") {
    if (!isValidCronExpr(freq.cronExpr)) return null;
    return { kind: "custom", cronExpr: freq.cronExpr };
  }
  return null;
}

function normalizeType(type: AgentScheduleType | undefined): AgentScheduleType {
  if (type && SCHEDULE_TYPES.has(type)) return type;
  return "prompt";
}
