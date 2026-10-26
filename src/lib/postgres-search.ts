import "server-only";

import { Prisma } from "@/generated/prisma/client";

/**
 * Escape LIKE metacharacters while using `!` as the explicit PostgreSQL
 * escape character. This keeps `%` and `_` supplied by a user literal rather
 * than silently changing the search into a broader pattern.
 */
function escapeLikePattern(value: string): string {
  return value
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_");
}

function normalizedLike(
  expression: Prisma.Sql,
  pattern: string,
): Prisma.Sql {
  return Prisma.sql`
    public.agentranking_search_normalize(${expression})
    LIKE public.agentranking_search_normalize(${pattern}) ESCAPE '!'
  `;
}

export function postgresAccentInsensitiveContains(
  expression: Prisma.Sql,
  value: string,
): Prisma.Sql {
  return normalizedLike(expression, `%${escapeLikePattern(value)}%`);
}

export function postgresAccentInsensitivePrefix(
  expression: Prisma.Sql,
  value: string,
): Prisma.Sql {
  return normalizedLike(expression, `${escapeLikePattern(value)}%`);
}

export function postgresAccentInsensitiveJsonContains(
  expression: Prisma.Sql,
  value: string,
): Prisma.Sql {
  return Prisma.sql`
    public.agentranking_search_normalize_jsonb(${expression})
    LIKE public.agentranking_search_normalize(${`%${escapeLikePattern(value)}%`}) ESCAPE '!'
  `;
}
