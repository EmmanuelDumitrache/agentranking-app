import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
function uniqStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}
function firstSharedProtocol(centerProtos: string[], neighborProtos: string[]): string {
  const set = new Set(centerProtos);
  for (const p of neighborProtos) {
    if (set.has(p)) return p;
  }
  return centerProtos[0] ?? neighborProtos[0] ?? "shared";
}
/**
 * GET /api/sap/graph?chainId=&agentId=
 * Neighbors = other SAP agents sharing at least one on-chain protocol tag (honest proxy; not tx-level interaction).
 */
export async function GET(req: NextRequest) {
  const chainIdRaw = req.nextUrl.searchParams.get("chainId");
  const agentIdRaw = req.nextUrl.searchParams.get("agentId");
  const chainId = Number.parseInt(chainIdRaw ?? "", 10);
  const agentId = Number.parseInt(agentIdRaw ?? "", 10);
  if (!Number.isFinite(chainId) || chainId <= 0 || !Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "chainId and agentId are required positive integers" }, { status: 400 });
  }
  const center = await prisma.agent.findFirst({
    where: { chainId, agentId, sapVerified: true, isActive: true },
    select: {
      id: true,
      chainId: true,
      agentId: true,
      name: true,
      sapAgentPda: true,
      sapProtocols: true,
      score: true,
    },
  });
  if (!center) {
    return NextResponse.json({ error: "SAP verified agent not found" }, { status: 404 });
  }
  const capRows = await prisma.agentSapCapability.findMany({
    where: { agentDbId: center.id },
    select: { protocol: true },
  });
  const capProtos = uniqStrings(capRows.map((c) => c.protocol.trim()).filter(Boolean));
  const sharedKeys = uniqStrings([...center.sapProtocols, ...capProtos].filter(Boolean));
  const neighbors =
    sharedKeys.length === 0
      ? []
      : await prisma.agent.findMany({
          where: {
            sapVerified: true,
            isActive: true,
            id: { not: center.id },
            sapProtocols: { hasSome: sharedKeys },
          },
          take: 40,
          select: {
            id: true,
            chainId: true,
            agentId: true,
            name: true,
            sapAgentPda: true,
            sapProtocols: true,
            score: true,
          },
        });
  const centerSlug = toAgentUrlSlug(center.name);
  const centerNodeId = `agent-${center.id}`;
  const centerProtoList = uniqStrings([...center.sapProtocols, ...capProtos]);
  const nodes = [
    {
      id: centerNodeId,
      chainId: center.chainId,
      agentId: center.agentId,
      name: center.name,
      slug: centerSlug,
      profilePath: agentPublicPath(center),
      sapAgentPda: center.sapAgentPda,
      score: center.score,
      isCenter: true,
    },
    ...neighbors.map((n) => ({
      id: `agent-${n.id}`,
      chainId: n.chainId,
      agentId: n.agentId,
      name: n.name,
      slug: toAgentUrlSlug(n.name),
      profilePath: agentPublicPath(n),
      sapAgentPda: n.sapAgentPda,
      score: n.score,
      isCenter: false,
    })),
  ];
  const links = neighbors.map((n) => ({
    source: centerNodeId,
    target: `agent-${n.id}`,
    sharedProtocol: firstSharedProtocol(centerProtoList, n.sapProtocols),
  }));
  return NextResponse.json(
    {
      center: {
        chainId: center.chainId,
        agentId: center.agentId,
        name: center.name,
        slug: centerSlug,
        profilePath: agentPublicPath(center),
        sapAgentPda: center.sapAgentPda,
      },
      nodes,
      links,
      sharedKeysUsed: sharedKeys,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
