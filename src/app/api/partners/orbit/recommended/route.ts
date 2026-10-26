import { NextResponse, type NextRequest } from "next/server";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  ORBIT_CURATED_MCP_VERSION,
  authorizeOrbitPartnerRequest,
  parseOrbitApiOptions,
} from "@/lib/orbit/orbit-api";
import {
  getCuratedAgentsForOrbitSkill,
  getOrbitSkills,
} from "@/lib/orbit/orbit-curated-agents";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const auth = authorizeOrbitPartnerRequest(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const options = parseOrbitApiOptions(request.nextUrl.searchParams);
  const requestedSkillId = request.nextUrl.searchParams.get("skillId")?.trim().toLowerCase();
  const skills = getOrbitSkills()
    .filter((skill) => (requestedSkillId ? skill.id === requestedSkillId : true))
    .filter((skill) => (options.category ? skill.category === options.category : true))
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  if (requestedSkillId && skills.length === 0) {
    return NextResponse.json(
      {
        error: "Unknown Orbit skill.",
        skillId: requestedSkillId,
        availableSkills: getOrbitSkills().map((skill) => skill.id),
      },
      { status: 404 },
    );
  }
  const recommendations = await mapWithConcurrency(
    skills,
    8,
    (skill) => getCuratedAgentsForOrbitSkill(skill.id, options),
  );
  return NextResponse.json({
    version: ORBIT_CURATED_MCP_VERSION,
    generatedAt: new Date().toISOString(),
    recommendations: recommendations.filter((item) => item != null),
    count: recommendations.filter((item) => item != null).length,
    notes: ["The integration provides discovery and curation only. Execution is handled by Orbit or the target agent."],
  });
}
