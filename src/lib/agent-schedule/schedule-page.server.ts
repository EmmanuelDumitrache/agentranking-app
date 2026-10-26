import "server-only";
import { loadClientModelOptions } from "@/features/agent-chat/server/dashboard-bootstrap";
import { listAgentSchedules } from "@/lib/agent-schedule/service";
import type { DashboardSchedulePageData } from "@/lib/agent-schedule/types";

export type { DashboardSchedulePageData } from "@/lib/agent-schedule/types";

export async function loadDashboardSchedulePageData(
  agentDbId: number,
  appAccountId?: string,
): Promise<DashboardSchedulePageData> {
  const [schedules, modelsResponse] = await Promise.all([
    listAgentSchedules(agentDbId),
    loadClientModelOptions(appAccountId),
  ]);
  const defaultModel =
    modelsResponse.models.find((m) => m.isDefault)
    ?? modelsResponse.models.find((m) => m.isFree)
    ?? modelsResponse.models[0];
  return {
    agentDbId,
    schedules,
    models: modelsResponse.models,
    defaultModelKey: defaultModel?.modelKey ?? "",
  };
}
