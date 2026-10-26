-- Production drift repair: agent_memory tables were created before source_ordinal shipped.
ALTER TABLE "agent_memory_facts"
  ADD COLUMN IF NOT EXISTS "source_ordinal" SMALLINT;

ALTER TABLE "agent_memory_facts"
  DROP CONSTRAINT IF EXISTS "agent_memory_facts_source_ordinal_check";

ALTER TABLE "agent_memory_facts"
  ADD CONSTRAINT "agent_memory_facts_source_ordinal_check"
  CHECK (
    "source_ordinal" IS NULL
    OR ("source_ordinal" >= 0 AND "source_ordinal" < 3)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_facts_source_run_id_source_ordinal_key"
  ON "agent_memory_facts" ("source_run_id", "source_ordinal");

DROP INDEX IF EXISTS "agent_memory_facts_agent_db_id_status_created_at_idx";

CREATE INDEX IF NOT EXISTS "agent_memory_facts_agent_db_id_status_updated_at_idx"
  ON "agent_memory_facts" ("agent_db_id", "status", "updated_at" DESC);
