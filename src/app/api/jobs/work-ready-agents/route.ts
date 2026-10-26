import { NextResponse } from "next/server";
import { loadPublicWorkReadyAgents } from "@/lib/jobs/work-ready-agents.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ agents: await loadPublicWorkReadyAgents() });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("GET /api/jobs/work-ready-agents:", message);
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }
}
