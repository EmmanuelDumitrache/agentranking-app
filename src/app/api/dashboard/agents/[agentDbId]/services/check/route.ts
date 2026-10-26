import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { mergeServiceHealthCheck } from "@/lib/dashboard/service-health-server";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { probeKindLabel, probeServiceByKind } from "@/lib/dashboard/service-probe";
import { mapWithConcurrency } from "@/lib/async-pool";
import { HttpBodyTooLargeError, parseBoundedJsonBody } from "@/lib/bounded-http-body";
export const dynamic = "force-dynamic";

const ServiceCheckBodySchema = z.strictObject({
  serviceId: z.number().int().positive().optional(),
  serviceIds: z.array(z.number().int().positive()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  let body: z.infer<typeof ServiceCheckBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, ServiceCheckBodySchema, 32 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof HttpBodyTooLargeError ? 413 : 400 },
    );
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { x402Support: true },
  });
  let services;
  if (Array.isArray(body.serviceIds) && body.serviceIds.length > 0) {
    services = await prisma.agentService.findMany({
      where: { agentId: agentDbId, id: { in: body.serviceIds } },
    });
  } else if (body.serviceId) {
    services = await prisma.agentService.findMany({
      where: { id: body.serviceId, agentId: agentDbId },
    });
  } else {
    services = await prisma.agentService.findMany({ where: { agentId: agentDbId } });
  }
  const results = await mapWithConcurrency(services, 4, async (svc) => {
    if (!svc.endpoint?.trim()) {
      return {
        serviceId: svc.id,
        name: svc.name,
        skipped: true,
        reason: "No endpoint",
        checkType: "not_probeable" as const,
        checkTypeLabel: probeKindLabel("not_probeable"),
      };
    }
    const check = await probeServiceByKind({
      name: svc.name,
      endpoint: svc.endpoint,
      x402Detected: agent?.x402Support,
    }, request.signal);
    if (!check.skipped) {
      await mergeServiceHealthCheck(
        agentDbId,
        svc.id,
        svc.name,
        svc.endpoint,
        check,
        "manual",
        check.checkType,
      );
    }
    return {
      serviceId: svc.id,
      name: svc.name,
      skipped: check.skipped === true,
      reason: check.reason,
      checkType: check.checkType,
      checkTypeLabel: probeKindLabel(check.checkType),
      check,
    };
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ results });
}