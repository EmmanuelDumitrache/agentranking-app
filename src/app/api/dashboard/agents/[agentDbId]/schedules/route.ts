import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import {
  createAgentSchedule,
  listAgentSchedules,
  parseFrequencyBody,
  reorderAgentSchedules,
} from "@/lib/agent-schedule/service";
import type { AgentScheduleType } from "@/lib/agent-schedule/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schedules = await listAgentSchedules(id);
  return NextResponse.json({ schedules });
}

export async function POST(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profile = await getDashboardUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const appAccount = await ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });

  const body = (await request.json()) as {
    label?: string;
    type?: AgentScheduleType;
    modelKey?: string;
    promptText?: string;
    frequency?: unknown;
    missedPolicy?: "skip" | "catch_up_once";
    tradeConfig?: unknown;
  };

  const label = body.label?.trim() ?? "";
  const modelKey = body.modelKey?.trim() ?? "";
  const promptText = body.promptText?.trim() ?? "";
  const frequency = parseFrequencyBody(body.frequency);

  if (!label || !modelKey || !promptText || !frequency) {
    return NextResponse.json(
      { error: "label, modelKey, promptText, and frequency are required" },
      { status: 400 },
    );
  }

  try {
    const schedule = await createAgentSchedule(id, appAccount.id, {
      label,
      type: body.type,
      modelKey,
      promptText,
      frequency,
      missedPolicy: body.missedPolicy,
      tradeConfig: body.tradeConfig,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create schedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { orderedIds?: string[] };
  const orderedIds = body.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.some((item) => typeof item !== "string")) {
    return NextResponse.json({ error: "orderedIds must be a string array" }, { status: 400 });
  }

  await reorderAgentSchedules(id, orderedIds);
  const schedules = await listAgentSchedules(id);
  return NextResponse.json({ schedules });
}
