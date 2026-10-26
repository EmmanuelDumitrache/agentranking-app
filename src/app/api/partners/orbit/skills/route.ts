import { NextResponse, type NextRequest } from "next/server";
import {
  ORBIT_CURATED_MCP_VERSION,
  authorizeOrbitPartnerRequest,
  parseOrbitApiOptions,
} from "@/lib/orbit/orbit-api";
import { getOrbitSkills } from "@/lib/orbit/orbit-curated-agents";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const auth = authorizeOrbitPartnerRequest(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const options = parseOrbitApiOptions(request.nextUrl.searchParams);
  const skills = getOrbitSkills()
    .filter((skill) => (options.category ? skill.category === options.category : true))
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  return NextResponse.json({
    version: ORBIT_CURATED_MCP_VERSION,
    generatedAt: new Date().toISOString(),
    skills,
    count: skills.length,
    notes: ["The skill taxonomy is limited to Orbit skills that fit AgentRanking's current indexed agent database."],
  });
}
