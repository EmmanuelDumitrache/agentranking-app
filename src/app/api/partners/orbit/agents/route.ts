import { NextRequest, NextResponse } from "next/server";
import { AgentBlocklistError } from "@/lib/agent-blocklist";
import { backgroundJobsPausedResponse, isBackgroundJobsPaused } from "@/lib/pause-background-jobs";
import { authorizeOrbitPartnerIngestRequest } from "@/lib/orbit/orbit-api";
import { normalizeOrbitIngestPayload } from "@/lib/orbit/ingest-payload";
import { ingestOrbitAgent } from "@/lib/orbit/ingest";
import type { OrbitAgentIngestPayload } from "@/lib/orbit/types";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/**
 * POST /api/partners/orbit/agents
 * Partner launch ingestion — creates or updates a Solana agent profile from Orbit.
 */
export async function POST(request: NextRequest) {
  const auth = authorizeOrbitPartnerIngestRequest(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  if (isBackgroundJobsPaused()) return backgroundJobsPausedResponse();
  try {
    const body = (await request.json()) as OrbitAgentIngestPayload;
    const normalized = normalizeOrbitIngestPayload(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const result = await ingestOrbitAgent(normalized.payload);
    return NextResponse.json({
      ok: true,
      agentId: result.agentId,
      agentSlug: result.agentSlug,
      profilePath: result.profilePath,
      agentUrl: result.agentUrl,
      badge: result.badge,
      created: result.created,
      updated: result.updated,
    });
  } catch (error) {
    if (error instanceof AgentBlocklistError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/partners/orbit/agents error:", error);
    return NextResponse.json(
      { error: Error.isError(error) ? error.message : "Orbit ingest failed." },
      { status: 500 },
    );
  }
}
