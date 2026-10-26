CREATE TYPE "AgentMcpAuthMode" AS ENUM ('NONE', 'BEARER', 'OAUTH', 'CLIENT_CREDENTIALS');
CREATE TYPE "AgentMcpConnectionStatus" AS ENUM ('UNKNOWN', 'READY', 'AUTH_REQUIRED', 'UNAVAILABLE', 'INVALID');
CREATE TYPE "AgentMcpTransportMode" AS ENUM ('AUTO', 'STREAMABLE_HTTP', 'SSE');
CREATE TYPE "AgentMcpApprovalMode" AS ENUM ('AUTO', 'MUTATIONS', 'ALWAYS');

CREATE TABLE "agent_mcp_connections" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auth_mode" "AgentMcpAuthMode" NOT NULL DEFAULT 'NONE',
    "transport_mode" "AgentMcpTransportMode" NOT NULL DEFAULT 'AUTO',
    "approval_mode" "AgentMcpApprovalMode" NOT NULL DEFAULT 'AUTO',
    "annotations_trusted" BOOLEAN NOT NULL DEFAULT false,
    "status" "AgentMcpConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_connected_at" TIMESTAMPTZ(3),
    "last_error_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "last_error_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_mcp_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_mcp_connections_app_account_id_service_id_key" ON "agent_mcp_connections"("app_account_id", "service_id");
CREATE INDEX "agent_mcp_connections_agent_db_id_enabled_idx" ON "agent_mcp_connections"("agent_db_id", "enabled");
CREATE INDEX "agent_mcp_connections_app_account_id_agent_db_id_idx" ON "agent_mcp_connections"("app_account_id", "agent_db_id");
ALTER TABLE "agent_mcp_connections" ADD CONSTRAINT "agent_mcp_connections_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_connections" ADD CONSTRAINT "agent_mcp_connections_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_connections" ADD CONSTRAINT "agent_mcp_connections_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "AgentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_mcp_credentials" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(64) NOT NULL,
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_mcp_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_mcp_credentials_connection_id_key" ON "agent_mcp_credentials"("connection_id");
CREATE INDEX "agent_mcp_credentials_app_account_id_idx" ON "agent_mcp_credentials"("app_account_id");
ALTER TABLE "agent_mcp_credentials" ADD CONSTRAINT "agent_mcp_credentials_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_credentials" ADD CONSTRAINT "agent_mcp_credentials_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_mcp_catalogs" (
    "connection_id" TEXT NOT NULL,
    "protocol_era" VARCHAR(16),
    "protocol_version" VARCHAR(32),
    "server_info_json" JSONB,
    "capabilities_json" JSONB,
    "discover_json" JSONB,
    "instructions" TEXT,
    "tools_json" JSONB NOT NULL,
    "resources_json" JSONB,
    "resource_templates_json" JSONB,
    "prompts_json" JSONB,
    "tools_digest" VARCHAR(64) NOT NULL,
    "endpoint_snapshot" TEXT NOT NULL,
    "service_digest" VARCHAR(64),
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_mcp_catalogs_pkey" PRIMARY KEY ("connection_id")
);
CREATE INDEX "agent_mcp_catalogs_fetched_at_idx" ON "agent_mcp_catalogs"("fetched_at");
ALTER TABLE "agent_mcp_catalogs" ADD CONSTRAINT "agent_mcp_catalogs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_mcp_oauth_transactions" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "state_hash" VARCHAR(64) NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_mcp_oauth_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_mcp_oauth_transactions_state_hash_key" ON "agent_mcp_oauth_transactions"("state_hash");
CREATE INDEX "agent_mcp_oauth_transactions_connection_id_expires_at_idx" ON "agent_mcp_oauth_transactions"("connection_id", "expires_at");
CREATE INDEX "agent_mcp_oauth_transactions_app_account_id_expires_at_idx" ON "agent_mcp_oauth_transactions"("app_account_id", "expires_at");
ALTER TABLE "agent_mcp_oauth_transactions" ADD CONSTRAINT "agent_mcp_oauth_transactions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_oauth_transactions" ADD CONSTRAINT "agent_mcp_oauth_transactions_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_chat_tool_events"
    ADD COLUMN "tool_source" VARCHAR(32),
    ADD COLUMN "source_connection_id" TEXT,
    ADD COLUMN "source_tool_name" TEXT,
    ADD COLUMN "source_display_name" TEXT;

CREATE TABLE "agent_mcp_continuations" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "connection_id" TEXT NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "encrypted_request" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(64) NOT NULL,
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" VARCHAR(64) NOT NULL,
    "input_requests_json" JSONB NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_mcp_continuations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_mcp_continuations_app_account_id_agent_db_id_expires_at_idx" ON "agent_mcp_continuations"("app_account_id", "agent_db_id", "expires_at");
CREATE INDEX "agent_mcp_continuations_connection_id_expires_at_idx" ON "agent_mcp_continuations"("connection_id", "expires_at");
ALTER TABLE "agent_mcp_continuations" ADD CONSTRAINT "agent_mcp_continuations_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_continuations" ADD CONSTRAINT "agent_mcp_continuations_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_continuations" ADD CONSTRAINT "agent_mcp_continuations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
