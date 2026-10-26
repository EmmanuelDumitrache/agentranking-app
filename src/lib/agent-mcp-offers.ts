import { prisma } from "@/lib/db";
import { serializeMcpOffer } from "@/lib/mcp-offers-api-shared";
export type SerializedMcpOffer = ReturnType<typeof serializeMcpOffer>;
export async function getMcpOffers(
  agentDbId: number,
  options?: { includeUnpublished?: boolean },
): Promise<SerializedMcpOffer[]> {
  const where: { agentId: number; isPublished?: boolean } = { agentId: agentDbId };
  if (!options?.includeUnpublished) {
    where.isPublished = true;
  }
  const offers = await prisma.agentMcpOffer.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      summary: true,
      priceLabel: true,
      ctaUrl: true,
      linkedServiceId: true,
      sortOrder: true,
      isPublished: true,
      createdAt: true,
      updatedAt: true,
      linkedService: {
        select: { id: true, name: true, endpoint: true },
      },
    },
  });
  return offers.map((o) => serializeMcpOffer(o));
}