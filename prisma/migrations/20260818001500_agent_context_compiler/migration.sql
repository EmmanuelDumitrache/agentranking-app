ALTER TYPE "AgentChatRunAttemptReason" ADD VALUE IF NOT EXISTS 'SUBAGENT';

ALTER TABLE "agent_chat_conversations"
  ADD COLUMN "working_state" JSONB;

CREATE TABLE "agent_chat_artifacts" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "run_id" TEXT,
  "response_message_id" TEXT,
  "tool_call_id" TEXT,
  "tool_name" TEXT,
  "kind" VARCHAR(32) NOT NULL DEFAULT 'TOOL_RESULT',
  "payload_json" JSONB NOT NULL,
  "preview_text" TEXT NOT NULL,
  "digest_text" TEXT,
  "search_text" TEXT NOT NULL,
  "estimated_tokens" INTEGER NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "state_changing" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_chat_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_chat_artifacts_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "agent_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_chat_artifacts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_chat_artifacts_run_id_tool_call_id_key"
  ON "agent_chat_artifacts"("run_id", "tool_call_id");
CREATE INDEX "agent_chat_artifacts_conversation_id_created_at_idx"
  ON "agent_chat_artifacts"("conversation_id", "created_at" DESC);
CREATE INDEX "agent_chat_artifacts_run_id_created_at_idx"
  ON "agent_chat_artifacts"("run_id", "created_at");
CREATE INDEX "agent_chat_artifacts_tool_name_created_at_idx"
  ON "agent_chat_artifacts"("tool_name", "created_at" DESC);

ALTER TABLE "agent_chat_tool_events"
  ADD COLUMN "result_artifact_id" TEXT;

CREATE UNIQUE INDEX "agent_chat_tool_events_result_artifact_id_key"
  ON "agent_chat_tool_events"("result_artifact_id");

ALTER TABLE "agent_chat_tool_events"
  ADD CONSTRAINT "agent_chat_tool_events_result_artifact_id_fkey"
    FOREIGN KEY ("result_artifact_id") REFERENCES "agent_chat_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
