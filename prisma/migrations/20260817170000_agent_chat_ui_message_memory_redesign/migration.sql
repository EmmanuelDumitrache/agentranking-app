-- Pre-launch destructive reset: the previous chat transcript/memory formats are intentionally unsupported.
-- Chat runs/messages and memory rows are test-only at this stage, so remove the entire
-- execution dependency graph instead of carrying a runtime converter. Refund the net
-- effect of run-ledger test charges before deleting those ledger rows.
UPDATE "app_accounts" AS account
SET "llm_balance_cents" = GREATEST(
  0,
  account."llm_balance_cents" - reset."net_delta"
)
FROM (
  SELECT ledger."app_account_id", SUM(ledger."delta")::INTEGER AS "net_delta"
  FROM "account_credit_ledger" AS ledger
  INNER JOIN "agent_chat_runs" AS run
    ON ledger."reference_id" = run."id"
    OR ledger."id" = run."reservation_ledger_id"
    OR ledger."id" = run."settlement_ledger_id"
  GROUP BY ledger."app_account_id"
) AS reset
WHERE account."id" = reset."app_account_id";

DELETE FROM "account_credit_ledger" AS ledger
USING "agent_chat_runs" AS run
WHERE ledger."reference_id" = run."id"
   OR ledger."id" = run."reservation_ledger_id"
   OR ledger."id" = run."settlement_ledger_id";

-- Schedule execution history stores chat run/thread IDs as scalar provenance rather
-- than foreign keys, so remove those now-dangling pre-launch execution rows explicitly.
DELETE FROM "agent_schedule_runs"
WHERE "conversation_id" IS NOT NULL OR "run_id" IS NOT NULL;

DELETE FROM "agent_chat_conversations";
DELETE FROM "agent_memory_facts";
DELETE FROM "agent_memory_settings";

DROP TABLE IF EXISTS "agent_memory_extraction_outbox";
DROP TABLE IF EXISTS "agent_chat_tool_events";
DROP TABLE IF EXISTS "agent_memory_facts";
DROP TABLE IF EXISTS "agent_memory_settings";

ALTER TABLE "agent_chat_conversations"
  ADD COLUMN "context_summary" TEXT,
  ADD COLUMN "summary_through_sequence" INTEGER,
  ADD COLUMN "summary_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "summary_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "agent_chat_runs"
  DROP COLUMN IF EXISTS "user_message_id" CASCADE,
  DROP COLUMN IF EXISTS "assistant_message_id" CASCADE,
  ADD COLUMN "trigger_message_id" TEXT,
  ADD COLUMN "response_message_id" TEXT,
  ADD COLUMN "parent_run_id" TEXT,
  ADD COLUMN "finish_reason" TEXT;

CREATE TYPE "AgentChatRunTriggerKind" AS ENUM ('USER_MESSAGE', 'REGENERATE', 'TOOL_APPROVAL', 'MCP_INPUT');
ALTER TABLE "agent_chat_runs"
  ADD COLUMN "trigger_kind" "AgentChatRunTriggerKind" NOT NULL DEFAULT 'USER_MESSAGE';

ALTER TABLE "agent_chat_messages"
  DROP COLUMN IF EXISTS "ui_message_id" CASCADE,
  DROP COLUMN IF EXISTS "status" CASCADE,
  DROP COLUMN IF EXISTS "content_text" CASCADE,
  DROP COLUMN IF EXISTS "parts_json" CASCADE,
  DROP COLUMN IF EXISTS "finish_reason" CASCADE,
  DROP COLUMN IF EXISTS "error_code" CASCADE,
  DROP COLUMN IF EXISTS "error_message" CASCADE,
  DROP COLUMN IF EXISTS "completed_at" CASCADE,
  ADD COLUMN "parts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "metadata" JSONB;
ALTER TABLE "agent_chat_messages" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "agent_chat_messages" ALTER COLUMN "parts" DROP DEFAULT;

DROP TYPE IF EXISTS "AgentChatMessageStatus";

ALTER TABLE "agent_chat_runs"
  ADD CONSTRAINT "agent_chat_runs_trigger_message_fkey"
    FOREIGN KEY ("trigger_message_id")
    REFERENCES "agent_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_chat_runs_response_message_fkey"
    FOREIGN KEY ("response_message_id")
    REFERENCES "agent_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_chat_runs_parent_run_fkey"
    FOREIGN KEY ("parent_run_id") REFERENCES "agent_chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "agent_chat_runs_response_message_id_key"
  ON "agent_chat_runs"("response_message_id");
CREATE INDEX "agent_chat_runs_parent_run_started_at_idx"
  ON "agent_chat_runs"("parent_run_id", "started_at" DESC);

-- PostgreSQL partial uniqueness is the durable concurrency invariant Prisma cannot express.
CREATE UNIQUE INDEX "agent_chat_one_active_run"
  ON "agent_chat_runs"("conversation_id")
  WHERE "settlement_status" = 'PENDING'
    AND "status" IN ('PREPARING', 'RESERVED', 'STREAMING');

CREATE TABLE "agent_chat_tool_events" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "response_message_id" TEXT NOT NULL,
  "step_index" SMALLINT NOT NULL,
  "tool_call_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "tool_source" VARCHAR(32),
  "source_connection_id" TEXT,
  "source_tool_name" TEXT,
  "source_display_name" TEXT,
  "state" "AgentChatToolState" NOT NULL DEFAULT 'PENDING',
  "input_json" JSONB,
  "output_json" JSONB,
  "summary_json" JSONB,
  "error_json" JSONB,
  "visibility" "AgentChatToolVisibility" NOT NULL DEFAULT 'SUMMARY',
  "duration_ms" INTEGER,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_chat_tool_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_chat_tool_events_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_chat_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_chat_tool_events_run_id_tool_call_id_key"
  ON "agent_chat_tool_events"("run_id", "tool_call_id");
CREATE INDEX "agent_chat_tool_events_run_id_step_index_idx"
  ON "agent_chat_tool_events"("run_id", "step_index");
CREATE INDEX "agent_chat_tool_events_response_message_id_step_index_idx"
  ON "agent_chat_tool_events"("response_message_id", "step_index");

DROP TYPE IF EXISTS "AgentMemoryFactKind";
CREATE TYPE "AgentMemoryFactKind" AS ENUM ('profile', 'preference', 'constraint', 'avoid');

CREATE TABLE "agent_memory_settings" (
  "id" TEXT NOT NULL,
  "agent_db_id" INTEGER NOT NULL,
  "app_account_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "require_approval" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_memory_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_memory_settings_agent_db_id_fkey"
    FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_settings_app_account_id_fkey"
    FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_memory_settings_agent_db_id_app_account_id_key"
  ON "agent_memory_settings"("agent_db_id", "app_account_id");
CREATE INDEX "agent_memory_settings_app_account_id_updated_at_idx"
  ON "agent_memory_settings"("app_account_id", "updated_at" DESC);

CREATE TABLE "agent_memory_facts" (
  "id" TEXT NOT NULL,
  "agent_db_id" INTEGER NOT NULL,
  "app_account_id" TEXT NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "kind" "AgentMemoryFactKind" NOT NULL,
  "content" VARCHAR(500) NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "status" "AgentMemoryFactStatus" NOT NULL DEFAULT 'active',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "salience" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "source_run_id" TEXT,
  "source_conversation_id" TEXT,
  "source_message_id" TEXT,
  "first_learned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "superseded_by_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_memory_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_memory_facts_agent_db_id_fkey"
    FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_facts_app_account_id_fkey"
    FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_memory_facts_agent_account_content_hash_key"
  ON "agent_memory_facts"("agent_db_id", "app_account_id", "content_hash");
CREATE INDEX "agent_memory_facts_agent_account_status_updated_idx"
  ON "agent_memory_facts"("agent_db_id", "app_account_id", "status", "updated_at" DESC);
CREATE INDEX "agent_memory_facts_agent_account_key_status_idx"
  ON "agent_memory_facts"("agent_db_id", "app_account_id", "key", "status");
CREATE INDEX "agent_memory_facts_account_created_idx"
  ON "agent_memory_facts"("app_account_id", "created_at" DESC);
CREATE INDEX "agent_memory_facts_source_message_idx"
  ON "agent_memory_facts"("source_message_id");

CREATE TABLE "agent_memory_extraction_outbox" (
  "source_message_id" TEXT NOT NULL,
  "source_run_id" TEXT,
  "app_account_id" TEXT NOT NULL,
  "agent_db_id" INTEGER NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_token" TEXT,
  "claimed_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_memory_extraction_outbox_pkey" PRIMARY KEY ("source_message_id"),
  CONSTRAINT "agent_memory_extraction_outbox_source_message_fkey"
    FOREIGN KEY ("conversation_id", "source_message_id")
    REFERENCES "agent_chat_messages"("conversation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memory_extraction_outbox_source_run_fkey"
    FOREIGN KEY ("source_run_id") REFERENCES "agent_chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_memory_extraction_outbox_source_run_id_key"
  ON "agent_memory_extraction_outbox"("source_run_id");
CREATE INDEX "agent_memory_extraction_outbox_agent_account_available_idx"
  ON "agent_memory_extraction_outbox"("agent_db_id", "app_account_id", "available_at");
