-- Account-scoped, provider-neutral BYOK credentials. Secrets are encrypted by the
-- application with versioned AES-256-GCM keys and are never returned to clients.
CREATE TABLE "llm_provider_credentials" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "encrypted_secret" TEXT,
    "encryption_key_id" VARCHAR(64),
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" VARCHAR(64) NOT NULL,
    "validation_status" VARCHAR(32) NOT NULL DEFAULT 'unknown',
    "validated_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "llm_provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llm_provider_credentials_app_account_id_provider_key"
    ON "llm_provider_credentials"("app_account_id", "provider");
CREATE INDEX "llm_provider_credentials_provider_validation_status_idx"
    ON "llm_provider_credentials"("provider", "validation_status");
ALTER TABLE "llm_provider_credentials"
    ADD CONSTRAINT "llm_provider_credentials_app_account_id_fkey"
    FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Schedule execution leases prevent a just-created run from rejecting itself and
-- allow abandoned workers to be reclaimed after bounded expiry.
ALTER TABLE "agent_schedule_runs"
    ADD COLUMN "lease_owner" TEXT,
    ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
    ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "agent_schedule_runs_status_lease_expires_at_idx"
    ON "agent_schedule_runs"("status", "lease_expires_at");

-- Durable idempotency ledger for user-approved/state-changing chat tools. A
-- toolCallId is executed at most once per chat run; ambiguous failures remain
-- UNKNOWN and are never replayed automatically.
CREATE TABLE "agent_chat_tool_executions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'STARTED',
    "output_json" JSONB,
    "error_json" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_chat_tool_executions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_chat_tool_executions_run_id_tool_call_id_key"
    ON "agent_chat_tool_executions"("run_id", "tool_call_id");
CREATE INDEX "agent_chat_tool_executions_run_id_status_idx"
    ON "agent_chat_tool_executions"("run_id", "status");
ALTER TABLE "agent_chat_tool_executions"
    ADD CONSTRAINT "agent_chat_tool_executions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_chat_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;



-- Transactional outbox for memory extraction. The chat settlement and this
-- intent commit together; queue delivery is retried independently.
CREATE TABLE "agent_memory_extraction_outbox" (
    "run_id" TEXT NOT NULL,
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

    CONSTRAINT "agent_memory_extraction_outbox_pkey" PRIMARY KEY ("run_id")
);
CREATE INDEX "agent_memory_extraction_outbox_delivered_at_available_at_idx"
    ON "agent_memory_extraction_outbox"("delivered_at", "available_at");
CREATE INDEX "agent_memory_extraction_outbox_claimed_at_idx"
    ON "agent_memory_extraction_outbox"("claimed_at");
ALTER TABLE "agent_memory_extraction_outbox"
    ADD CONSTRAINT "agent_memory_extraction_outbox_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_chat_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
