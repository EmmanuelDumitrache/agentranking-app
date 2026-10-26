import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { agentPublicPath } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

export type AdminVerifiedAgentsFilter = "all" | "verified" | "unverified";

export function normalizeAdminVerifiedAgentsInput(input: {
  readonly page?: number;
  readonly perPage?: number;
  readonly search?: string | null;
  readonly filter?: string | null;
}) {
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page!)) : 1;
  const perPage = Number.isFinite(input.perPage)
    ? Math.min(100, Math.max(1, Math.trunc(input.perPage!)))
    : 25;
  const filter: AdminVerifiedAgentsFilter =
    input.filter === "verified" || input.filter === "unverified"
      ? input.filter
      : "all";
  return {
    page,
    perPage,
    search: input.search?.trim() ?? "",
    filter,
  };
}

export async function readAdminVerifiedAgents(input: {
  readonly page?: number;
  readonly perPage?: number;
  readonly search?: string | null;
  readonly filter?: string | null;
}) {
  await requireAdminOperationsSession();
  const normalized = normalizeAdminVerifiedAgentsInput(input);
  const where: Prisma.AgentWhereInput = {};
  if (normalized.filter === "verified") {
    where.OR = [{ isVerified: true }, { isPremiumVerified: true }];
  } else if (normalized.filter === "unverified") {
    where.AND = [{ isVerified: false }, { isPremiumVerified: false }];
  }
  if (normalized.search) {
    const searchClause: Prisma.AgentWhereInput = {
      OR: [
        { name: { contains: normalized.search, mode: "insensitive" } },
        { description: { contains: normalized.search, mode: "insensitive" } },
        { owner: { contains: normalized.search, mode: "insensitive" } },
        { tokenAddress: { contains: normalized.search, mode: "insensitive" } },
      ],
    };
    if (where.AND && Array.isArray(where.AND)) {
      where.AND = [...where.AND, searchClause];
    } else if (where.OR) {
      where.AND = [{ OR: where.OR }, searchClause];
      delete where.OR;
    } else {
      Object.assign(where, searchClause);
    }
  }

  const [total, agents] = await Promise.all([
    prisma.agent.count({ where }),
    prisma.agent.findMany({
      where,
      select: {
        id: true,
        agentId: true,
        chainId: true,
        name: true,
        description: true,
        image: true,
        owner: true,
        tokenAddress: true,
        isVerified: true,
        isPremiumVerified: true,
        isActive: true,
        isCustomListed: true,
        createdAt: true,
        chain: { select: { shortName: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (normalized.page - 1) * normalized.perPage,
      take: normalized.perPage,
    }),
  ]);

  return {
    agents: agents.map((agent) => ({
      ...agent,
      createdAt: agent.createdAt.toISOString(),
      profilePath: agentPublicPath(agent),
    })),
    total,
    page: normalized.page,
    perPage: normalized.perPage,
    totalPages: Math.max(1, Math.ceil(total / normalized.perPage)),
  };
}
