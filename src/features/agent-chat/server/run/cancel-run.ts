import { prisma } from "@/lib/db";
import { getRun } from "../repositories/runs";
import { requestAbort } from "./abort-registry";
import type { AgentChatScope, CancelRunResponse } from "../../shared/contracts";
import { HttpError } from "../http-error";
export async function cancelRun(
  scope: AgentChatScope,
  runId: string,
): Promise<CancelRunResponse> {
  const run = await getRun(scope, runId);
  if (!run) throw new HttpError(404, "RUN_NOT_FOUND", "Run not found");
  if (!["PREPARING", "RESERVED", "STREAMING"].includes(run.status)) {
    return { runId, status: run.status, cancellationRequested: false };
  }
  requestAbort(runId);
  const updated = await prisma.agentChatRunRuntime.updateMany({
    where: { runId },
    data: { abortRequestedAt: new Date() },
  });
  if (updated.count !== 1) {
    throw new HttpError(
      409,
      "RUN_ALREADY_ACTIVE",
      "The active run lost its execution lease; refresh while recovery settles it",
      true,
      "REFRESH",
    );
  }
  return { runId, status: run.status, cancellationRequested: true };
}
