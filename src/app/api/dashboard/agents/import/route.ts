import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { importAgentForWorkspace, resolveImportCandidate } from "@/lib/dashboard/import-agent";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const result = await resolveImportCandidate(query);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ agent: result.agent });
}
type ImportBody = { agentDbId?: number };
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Profile required" }, { status: 403 });
  }
  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentDbId = body.agentDbId;
  if (!agentDbId || !Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }
  const result = await importAgentForWorkspace(
    {
      id: profile.id,
      walletAddress: profile.walletAddress,
      solanaWallet: profile.solanaWallet,
    },
    agentDbId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: result.status, agentDbId });
}
