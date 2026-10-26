import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toDaoVotesAdminRow } from "@/lib/admin-dao-votes";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

const MAX_LIMIT = 2000;
const AGENT_SELECT = {
  id: true,
  rank: true,
  name: true,
  image: true,
  chainId: true,
  agentId: true,
  powerScore: true,
  activeBoosts: true,
  adminPowerAdjust: true,
  chain: { select: { name: true } },
} as const;

function boardWhere(): Prisma.AgentWhereInput {
  return {
    isActive: true,
    agentId: { not: 88888 },
    powerScore: { gt: 0 },
  };
}

export function normalizeAdminDaoVotesInput(input: {
  readonly search?: string | null;
  readonly scope?: string | null;
  readonly limit?: number;
}) {
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(1, Math.trunc(input.limit!)), MAX_LIMIT)
    : 500;
  return {
    search: input.search?.trim() ?? "",
    scope: input.scope === "all" ? ("all" as const) : ("board" as const),
    limit,
  };
}

export async function readAdminDaoVotes(input: {
  readonly search?: string | null;
  readonly scope?: string | null;
  readonly limit?: number;
}) {
  await requireAdminOperationsSession();
  const normalized = normalizeAdminDaoVotesInput(input);
  const nameFilter: Prisma.AgentWhereInput | null = normalized.search
    ? { name: { contains: normalized.search, mode: "insensitive" } }
    : null;
  const where: Prisma.AgentWhereInput =
    normalized.scope === "all"
      ? (nameFilter ?? {})
      : nameFilter
        ? { AND: [boardWhere(), nameFilter] }
        : boardWhere();

  if (normalized.scope === "board" && !nameFilter) {
    const boardCount = await prisma.agent.count({ where: boardWhere() });
    if (boardCount === 0) return { agents: [], total: 0 };
  }

  const orderBy: Prisma.AgentOrderByWithRelationInput[] =
    normalized.scope === "all"
      ? [{ id: "desc" }]
      : [{ powerScore: "desc" }, { id: "asc" }];
  const rows = await prisma.agent.findMany({
    where,
    select: AGENT_SELECT,
    orderBy,
    take: normalized.limit,
  });
  const agents = rows.map((row, index) =>
    toDaoVotesAdminRow(
      normalized.scope === "all" ? row : { ...row, rank: index + 1 },
    ),
  );
  return { agents, total: agents.length };
}
