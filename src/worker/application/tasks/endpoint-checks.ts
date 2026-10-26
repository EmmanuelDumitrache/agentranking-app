import { prisma } from "@/lib/db";
import { mergeServiceHealthCheck } from "@/lib/dashboard/service-health-server";
import { probeServiceByKind } from "@/lib/dashboard/service-probe";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";

const ENDPOINT_SCAN_CURSOR_KEY = "maintenance:endpoint-checks";
const ENDPOINT_SCAN_BATCH = 500;

function parseEndpointScanCursor(value: string | null | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value) as { v?: unknown; lastId?: unknown };
    return parsed.v === 1 && Number.isSafeInteger(parsed.lastId) && Number(parsed.lastId) >= 0
      ? Number(parsed.lastId)
      : 0;
  } catch {
    return 0;
  }
}

export async function endpointChecksJob() {
  const cursorRow = await prisma.indexerSourceCursor.findUnique({
    where: { sourceKey: ENDPOINT_SCAN_CURSOR_KEY },
    select: { opaqueCursor: true },
  });
  const lastId = parseEndpointScanCursor(cursorRow?.opaqueCursor);
  // Scan services directly. The previous agent-first query repeatedly selected
  // the same first 100 agents and hydrated every service relation, including
  // empty endpoints, so large registries never made forward progress.
  const services = await prisma.$queryRaw<Array<{ id: number; agentId: number }>>`
    SELECT service.id, service."agentId"
    FROM "AgentService" AS service
    INNER JOIN "Agent" AS agent ON agent.id = service."agentId"
    WHERE service.id > ${lastId}
      AND BTRIM(service.endpoint) <> ''
      AND (agent."isVerified" = TRUE OR agent."isPremiumVerified" = TRUE)
    ORDER BY service.id ASC
    LIMIT ${ENDPOINT_SCAN_BATCH}
  `;
  const targets = services.map((service) => ({ agentId: service.agentId, serviceId: service.id }));
  const jobIds = await enqueueApplicationJobs(
    JOB_QUEUES.MAINT_ENDPOINT_CHECK,
    targets.map((target) => ({
      data: { v: 1, ...target },
      singletonKey: `${target.agentId}:${target.serviceId}`,
    })),
  );
  const complete = services.length < ENDPOINT_SCAN_BATCH;
  const nextId = complete ? 0 : services.at(-1)!.id;
  const now = new Date();
  await prisma.indexerSourceCursor.upsert({
    where: { sourceKey: ENDPOINT_SCAN_CURSOR_KEY },
    create: {
      sourceKey: ENDPOINT_SCAN_CURSOR_KEY,
      domain: "endpoint-health",
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId }),
      lastAdvancedAt: now,
      reconciliationGeneration: complete ? 1n : 0n,
    },
    update: {
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId }),
      lastAdvancedAt: now,
      ...(complete ? { reconciliationGeneration: { increment: 1n } } : {}),
    },
  });
  return { ok: true, scanned: services.length, selected: targets.length, enqueued: jobIds.length, complete };
}
export async function endpointCheckJob(agentId: number, serviceId: number) {
  const service = await prisma.agentService.findFirst({ where: { id: serviceId, agentId }, select: { id: true, agentId: true, name: true, endpoint: true, agent: { select: { x402Support: true } } } });
  if (!service?.endpoint.trim()) return { ok: true, skipped: true };
  const result = await probeServiceByKind({ name: service.name, endpoint: service.endpoint, x402Detected: service.agent.x402Support });
  if (result.skipped) return { ok: true, skipped: true, reason: result.error ?? "probe_skipped" };
  await mergeServiceHealthCheck(service.agentId, service.id, service.name, service.endpoint, result, "scheduled", result.checkType);
  return { ok: true, agentId, serviceId };
}
