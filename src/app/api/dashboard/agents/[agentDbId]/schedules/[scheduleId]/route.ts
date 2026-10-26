import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  deleteAgentSchedule,
  getAgentSchedule,
  parseFrequencyBody,
  updateAgentSchedule,
} from "@/lib/agent-schedule/service";
import type { AgentScheduleStatus, AgentScheduleType } from "@/lib/agent-schedule/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ agentDbId: string; scheduleId: string }>;
};

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId, scheduleId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schedule = await getAgentSchedule(id, scheduleId);
  if (!schedule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ schedule });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { agentDbId, scheduleId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    label?: string;
    type?: AgentScheduleType;
    status?: AgentScheduleStatus;
    modelKey?: string;
    promptText?: string;
    frequency?: unknown;
    missedPolicy?: "skip" | "catch_up_once";
    tradeConfig?: unknown;
  };

  try {
    const frequency = body.frequency ? parseFrequencyBody(body.frequency) : undefined;
    if (body.frequency && !frequency) {
      return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
    }

    const schedule = await updateAgentSchedule(id, scheduleId, {
      label: body.label,
      type: body.type,
      status: body.status,
      modelKey: body.modelKey,
      promptText: body.promptText,
      frequency: frequency ?? undefined,
      missedPolicy: body.missedPolicy,
      tradeConfig: body.tradeConfig,
    });
    if (!schedule) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ schedule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { agentDbId, scheduleId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = await deleteAgentSchedule(id, scheduleId);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
