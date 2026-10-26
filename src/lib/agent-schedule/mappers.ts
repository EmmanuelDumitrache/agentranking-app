import type { AgentSchedule, AgentScheduleRun } from "@/generated/prisma/client";
import type { AgentScheduleRow, AgentScheduleRunRow } from "./types";

export function mapScheduleRow(
  row: AgentSchedule & {
    runs?: Array<Pick<AgentScheduleRun, "status" | "outputSummary">>;
  },
): AgentScheduleRow {
  const lastRun = row.runs?.[0];
  return {
    id: row.id,
    agentDbId: row.agentDbId,
    label: row.label,
    type: row.type as AgentScheduleRow["type"],
    status: row.status as AgentScheduleRow["status"],
    sortOrder: row.sortOrder,
    cronExpr: row.cronExpr,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    modelKey: row.modelKey,
    promptText: row.promptText,
    missedPolicy: row.missedPolicy as AgentScheduleRow["missedPolicy"],
    tradeConfig: row.tradeConfig,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRunStatus: (lastRun?.status as AgentScheduleRow["lastRunStatus"]) ?? null,
    lastRunSummary: lastRun?.outputSummary ?? null,
  };
}

export function mapScheduleRunRow(row: AgentScheduleRun): AgentScheduleRunRow {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status as AgentScheduleRunRow["status"],
    modelKey: row.modelKey,
    costCents: row.costCents,
    outputSummary: row.outputSummary,
    errorMessage: row.errorMessage,
    skipReason: row.skipReason,
    conversationId: row.conversationId,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}
