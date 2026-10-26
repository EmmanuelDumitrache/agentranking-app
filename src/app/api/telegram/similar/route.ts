import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { agentPublicPath } from "@/lib/agent-public-url";
export const dynamic = "force-dynamic";
const TELEGRAM_CHAIN_ID = 9999;
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username")?.replace(/^@/, "").toLowerCase();
  const excludeId = Number.parseInt(searchParams.get("exclude") ?? "0", 10);
  if (!username) {
    return NextResponse.json({ bots: [] });
  }
  // Find reference bot and its tags
  const referenceWhere = await extendAgentWhereIndexable({
    archetype: "telegram",
    chainId: TELEGRAM_CHAIN_ID,
    metadata: { some: { key: "telegramBotUsername", value: username } },
  });
  const ref = await prisma.agent.findFirst({
    where: referenceWhere,
    select: { id: true, metadata: { select: { key: true, value: true } } },
  });
  if (!ref) return NextResponse.json({ bots: [] });
  const tagsMeta = ref.metadata.find((m) => m.key === "tags")?.value ?? "";
  const refTags  = tagsMeta.split(",").filter(Boolean);
  if (refTags.length === 0) return NextResponse.json({ bots: [] });
  const candidateWhere = await extendAgentWhereIndexable({
    archetype: "telegram",
    chainId: TELEGRAM_CHAIN_ID,
    NOT: [
      { id: ref.id },
      ...(excludeId ? [{ agentId: excludeId }] : []),
    ],
    metadata: {
      some: { key: "tags", value: { contains: refTags[0] } },
    },
  });
  const candidates = await prisma.agent.findMany({
    where: candidateWhere,
    select: {
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      score: true,
      metadata: { select: { key: true, value: true } },
    },
    orderBy: { score: "desc" },
    take: 20,
  });
  const scored = candidates
    .map((a) => {
      const botTags     = a.metadata.find((m) => m.key === "tags")?.value.split(",").filter(Boolean) ?? [];
      const botUsername = a.metadata.find((m) => m.key === "telegramBotUsername")?.value ?? null;
      const avatarMeta  = a.metadata.find((m) => m.key === "telegramAvatarUrl")?.value ?? null;
      const slugMeta    = a.metadata.find((m) => m.key === "slug")?.value ?? null;
      const overlap     = refTags.filter((t) => botTags.includes(t)).length;
      return {
        agentId:  a.agentId,
        chainId:  a.chainId,
        name:     a.name,
        username: botUsername,
        image:    avatarMeta ?? a.image ?? null,
        telegramSlug: slugMeta,
        profilePath: agentPublicPath(a),
        score:    Math.round(a.score),
        tags:     botTags,
        overlap,
      };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.score - a.score)
    .slice(0, 5);
  return NextResponse.json({ bots: scored });
}
