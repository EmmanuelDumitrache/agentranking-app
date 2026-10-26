import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  clearAgentGithubPushNote,
  upsertAgentGithubPushNote,
} from "@/lib/dashboard/github-push-notes";
import { loadDashboardGithubPushes } from "@/lib/dashboard/github-pushes.server";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  try {
    const data = await loadDashboardGithubPushes(agentDbId);
    return NextResponse.json(data);
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Failed to load pushes";
    console.error("[github-pushes] GET failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as {
    commitSha?: string;
    devNote?: string | null;
    hidden?: boolean;
    clearNote?: boolean;
  };
  const commitSha = body.commitSha?.trim();
  if (!commitSha) {
    return NextResponse.json({ error: "commitSha is required" }, { status: 400 });
  }
  try {
    if (body.clearNote) {
      await clearAgentGithubPushNote(agentDbId, commitSha);
    }
    const note = await upsertAgentGithubPushNote(agentDbId, commitSha, {
      ...(body.devNote !== undefined ? { devNote: body.devNote } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      ...(body.clearNote ? { devNote: "" } : {}),
    });
    await revalidateAgentByDbId(agentDbId);
    const data = await loadDashboardGithubPushes(agentDbId);
    return NextResponse.json({ note, ...data });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Failed to update push";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
