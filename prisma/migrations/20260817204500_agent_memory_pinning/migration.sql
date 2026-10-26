ALTER TABLE "agent_memory_facts"
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "agent_memory_extraction_outbox_source_run_id_key";

CREATE INDEX "agent_memory_extraction_outbox_source_run_id_idx"
  ON "agent_memory_extraction_outbox" ("source_run_id");

CREATE INDEX "agent_memory_facts_prompt_rank_idx"
  ON "agent_memory_facts" (
    "agent_db_id",
    "app_account_id",
    "status",
    "pinned" DESC,
    "last_confirmed_at" DESC
  );

-- The destructive chat/memory redesign recreated this table after the earlier
-- worker hot-path migration, so restore its partial dispatch/cleanup indexes
-- against the new source-message primary key.
CREATE INDEX "agent_memory_extraction_outbox_ready_idx"
  ON "agent_memory_extraction_outbox" ("available_at", "created_at", "source_message_id")
  WHERE "delivered_at" IS NULL;

CREATE INDEX "agent_memory_extraction_outbox_claim_token_idx"
  ON "agent_memory_extraction_outbox" ("claim_token")
  WHERE "delivered_at" IS NULL AND "claim_token" IS NOT NULL;

CREATE INDEX "agent_memory_extraction_outbox_delivered_cleanup_idx"
  ON "agent_memory_extraction_outbox" ("delivered_at", "source_message_id")
  WHERE "delivered_at" IS NOT NULL;
