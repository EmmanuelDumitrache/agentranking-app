import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeOrbitPartnerRequest,
  buildOrbitUnknownSkillPayload,
  parseOrbitApiOptions,
} from "@/lib/orbit/orbit-api";
import { getCuratedAgentsForOrbitSkill } from "@/lib/orbit/orbit-curated-agents";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const auth = authorizeOrbitPartnerRequest(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const { skillId } = await params;
  const options = parseOrbitApiOptions(request.nextUrl.searchParams);
  const response = await getCuratedAgentsForOrbitSkill(skillId, options);
  if (!response) {
    return NextResponse.json(buildOrbitUnknownSkillPayload(skillId), { status: 404 });
  }
  return NextResponse.json(response);
}