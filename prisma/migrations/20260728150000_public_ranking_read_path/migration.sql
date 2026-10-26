-- Dedicated indexes for the public /ranking read path.
--
-- The deployment workflow places the site in maintenance mode before applying
-- migrations. Regular CREATE INDEX is therefore intentional here: it keeps the
-- migration compatible with Prisma Migrate's transaction handling and avoids
-- the operational ambiguity of CREATE INDEX CONCURRENTLY inside migration files.

CREATE INDEX IF NOT EXISTS "Agent_public_ranking_rank_id_idx"
ON "Agent" (rank ASC, id ASC)
WHERE "isActive" = TRUE
  AND "publicly_active" = TRUE
  AND rank > 0
  AND (
    "cluster_key" IS NULL
    OR btrim("cluster_key") = ''
    OR "cluster_key" = 'cluster:' || "chainId"::text || ':' || "agentId"::text
  );

CREATE INDEX IF NOT EXISTS "Agent_public_ranking_chain_rank_id_idx"
ON "Agent" ("chainId" ASC, rank ASC, id ASC)
WHERE "isActive" = TRUE
  AND "publicly_active" = TRUE
  AND rank > 0
  AND (
    "cluster_key" IS NULL
    OR btrim("cluster_key") = ''
    OR "cluster_key" = 'cluster:' || "chainId"::text || ':' || "agentId"::text
  );
