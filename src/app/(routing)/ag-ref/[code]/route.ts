import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildPublicReferralRedirectUrl, normalizePublicReferralCodeInput } from "@/lib/agent-public-referral";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizePublicReferralCodeInput(raw);
  if (!code) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const agent = await prisma.agent.findFirst({
    where: { publicReferralCode: code },
    select: {
      chainId: true,
      agentId: true,
      name: true,
      publicReferralDestination: true,
    },
  });
  if (!agent) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const origin = new URL(request.url).origin;
  const target = buildPublicReferralRedirectUrl({
    requestOrigin: origin,
    destination: agent.publicReferralDestination ?? "",
    chainId: agent.chainId,
    agentId: agent.agentId,
    name: agent.name,
    code,
  });
  return NextResponse.redirect(target);
}
