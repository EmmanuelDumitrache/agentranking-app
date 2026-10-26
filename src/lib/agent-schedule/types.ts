import type { ClientModelOption } from "@/features/agent-chat/shared/contracts";

export type AgentScheduleType = "prompt" | "report" | "trade";
export type AgentScheduleStatus = "active" | "paused" | "completed";
export type AgentScheduleMissedPolicy = "skip" | "catch_up_once";
export type AgentScheduleRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export type AgentScheduleFrequency =
  | { kind: "hourly"; minuteUtc: number }
  | { kind: "daily"; hourUtc: number; minuteUtc: number }
  | {
      kind: "weekly";
      dayOfWeekUtc: number;
      hourUtc: number;
      minuteUtc: number;
    }
  | { kind: "once"; runAtUtc: string }
  | { kind: "custom"; cronExpr: string };

export type AgentScheduleRow = {
  id: string;
  agentDbId: number;
  label: string;
  type: AgentScheduleType;
  status: AgentScheduleStatus;
  sortOrder: number;
  cronExpr: string;
  nextRunAt: string;
  lastRunAt: string | null;
  modelKey: string;
  promptText: string;
  missedPolicy: AgentScheduleMissedPolicy;
  tradeConfig: unknown;
  createdAt: string;
  updatedAt: string;
  lastRunStatus: AgentScheduleRunStatus | null;
  lastRunSummary: string | null;
};

export type AgentScheduleRunRow = {
  id: string;
  scheduleId: string;
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  status: AgentScheduleRunStatus;
  modelKey: string;
  costCents: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  conversationId: string | null;
  runId: string | null;
  createdAt: string;
};

export type CreateAgentScheduleInput = {
  label: string;
  type?: AgentScheduleType;
  modelKey: string;
  promptText: string;
  frequency: AgentScheduleFrequency;
  missedPolicy?: AgentScheduleMissedPolicy;
  tradeConfig?: unknown;
};

export type UpdateAgentScheduleInput = Partial<CreateAgentScheduleInput> & {
  status?: AgentScheduleStatus;
};

export type DashboardSchedulePageData = {
  agentDbId: number;
  schedules: AgentScheduleRow[];
  models: ClientModelOption[];
  defaultModelKey: string;
};
