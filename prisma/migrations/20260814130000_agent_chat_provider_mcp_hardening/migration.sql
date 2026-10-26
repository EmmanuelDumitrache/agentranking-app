ALTER TYPE "AgentChatRunAttemptReason" ADD VALUE IF NOT EXISTS 'FAILOVER';

CREATE TYPE "AgentMcpResolvedTransport" AS ENUM ('STREAMABLE_HTTP', 'SSE');

ALTER TABLE "agent_chat_run_attempts"
  ADD COLUMN "step_index" SMALLINT,
  ADD COLUMN "step_attempt_index" SMALLINT NOT NULL DEFAULT 0;

UPDATE "agent_chat_run_attempts"
SET "step_index" = "sequence"
WHERE "step_index" IS NULL;

ALTER TABLE "agent_chat_run_attempts"
  ALTER COLUMN "step_index" SET NOT NULL,
  ALTER COLUMN "step_attempt_index" DROP DEFAULT;

CREATE UNIQUE INDEX "agent_chat_run_attempts_run_id_step_index_step_attempt_index_key"
  ON "agent_chat_run_attempts"("run_id", "step_index", "step_attempt_index");
CREATE INDEX "agent_chat_run_attempts_run_id_step_index_idx"
  ON "agent_chat_run_attempts"("run_id", "step_index");

ALTER TABLE "agent_mcp_connections"
  ADD COLUMN "last_successful_transport" "AgentMcpResolvedTransport";

ALTER TABLE "agent_mcp_oauth_transactions"
  ADD COLUMN "transport_kind" "AgentMcpResolvedTransport";
