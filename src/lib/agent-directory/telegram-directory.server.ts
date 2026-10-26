import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { resolveAgentListSearchForApi } from "@/lib/agents-search-scope";
import type { TelegramDirectoryQuery, TelegramDirectoryResponse } from "@/lib/agent-directory/telegram-directory";

function telegramDirectoryOrderBy(sort: string): Prisma.AgentOrderByWithRelationInput[] {
  switch (sort) {
    case "name_asc":
      return [{ name: "asc" }, { id: "asc" }];
    case "created_asc":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "created_desc":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "profile_desc":
    default:
      return [
        { score: "desc" },
        { totalFeedback: "desc" },
        { lastActiveAt: "desc" },
        { id: "asc" },
      ];
  }
}

const TELEGRAM_METADATA_KEYS = [
  "telegramBotUsername",
  "telegramBotType",
  "telegramManagerBotUsername",
  "telegramSpawnUrl",
  "telegramAvatarUrl",
  "tags",
];
export async function readTelegramDirectoryPage(input: TelegramDirectoryQuery): Promise<TelegramDirectoryResponse> {
  const search = resolveAgentListSearchForApi(input.search);
  const where: Prisma.AgentWhereInput = { isActive: true, archetype: "telegram" };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { owner: { contains: search, mode: "insensitive" } },
      { metadata: { some: { key: "telegramBotUsername", value: { contains: search, mode: "insensitive" } } } },
    ];
  }
  const and: Prisma.AgentWhereInput[] = [];
  if (input.verified === "true") {
    and.push({ OR: [{ isVerified: true }, { isPremiumVerified: true }] });
  }
  if (input.botType) {
    and.push({ metadata: { some: { key: "telegramBotType", value: input.botType } } });
  }
  if (input.spawn === "true") {
    and.push({ metadata: { some: { key: "telegramSpawnUrl", value: { not: "" } } } });
  }
  if (input.tag) {
    and.push({ metadata: { some: { key: "tags", value: { contains: input.tag, mode: "insensitive" } } } });
  }
  if (and.length > 0) where.AND = and;
  const publicWhere = await extendAgentWhereNotBlocked(where);
  const [rows, total] = await Promise.all([
    prisma.agent.findMany({
      where: publicWhere,
      orderBy: telegramDirectoryOrderBy(input.sort),
      skip: (input.page - 1) * input.perPage,
      take: input.perPage,
      select: {
        agentId: true,
        chainId: true,
        name: true,
        description: true,
        image: true,
        score: true,
        createdAt: true,
        isVerified: true,
        isPremiumVerified: true,
        metadata: {
          where: { key: { in: TELEGRAM_METADATA_KEYS } },
          select: { key: true, value: true },
        },
      },
    }),
    prisma.agent.count({ where: publicWhere }),
  ]);
  return {
    agents: rows.map((row) => ({
      agentId: row.agentId,
      chainId: row.chainId,
      name: row.name,
      description: row.description,
      image: sanitizeAgentImageUrl(row.image) || null,
      score: row.score,
      createdAt: row.createdAt.toISOString(),
      slug: toAgentUrlSlug(row.name),
      profilePath: agentPublicPath(row),
      isVerified: row.isVerified,
      isPremiumVerified: row.isPremiumVerified,
      metadata: row.metadata,
    })),
    total,
    page: input.page,
    perPage: input.perPage,
    totalPages: Math.ceil(total / input.perPage),
    generatedAt: new Date().toISOString(),
  };
}
