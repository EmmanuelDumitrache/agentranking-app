-- One-way cutover from AgentService-coupled MCP execution to reusable,
-- account-owned connections with explicit per-agent bindings.

-- The cutover never rewrites credential envelopes. Retain a transaction-local
-- guard so the migration aborts if ciphertext or its envelope metadata changes.
CREATE TEMP TABLE "mcp_credential_ciphertext_guard" AS
SELECT
  "id",
  md5("encrypted_secret") AS "ciphertext_checksum",
  "encryption_key_id",
  "encryption_version",
  "fingerprint"
FROM "agent_mcp_credentials";

CREATE TYPE "AgentMcpAuthMode_new" AS ENUM (
  'NONE',
  'BEARER_TOKEN',
  'API_KEY_HEADER',
  'OAUTH2_AUTHORIZATION_CODE',
  'OAUTH2_CLIENT_CREDENTIALS'
);
CREATE TYPE "AgentMcpConnectionStatus_new" AS ENUM (
  'DRAFT',
  'AUTH_PENDING',
  'VERIFYING',
  'READY',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'INVALID',
  'BLOCKED',
  'DISABLED',
  'DELETED'
);
CREATE TYPE "AgentMcpTransportMode_new" AS ENUM ('STREAMABLE_HTTP', 'LEGACY_SSE');
CREATE TYPE "AgentMcpResolvedTransport_new" AS ENUM ('STREAMABLE_HTTP', 'LEGACY_SSE');
CREATE TYPE "AgentMcpApprovalMode_new" AS ENUM (
  'AUTO_READ_ONLY',
  'CONFIRM_MUTATIONS',
  'CONFIRM_EVERY_CALL',
  'BLOCK_ALL'
);
CREATE TYPE "AgentMcpToolRisk" AS ENUM (
  'READ_ONLY',
  'ANALYTICS_QUERY',
  'TRANSACTION_PREPARE',
  'WRITE_OFFCHAIN',
  'TRADE',
  'SIGN',
  'BROADCAST',
  'PAYMENT',
  'CUSTODY',
  'INFRA_ADMIN',
  'UNKNOWN'
);

CREATE TYPE "AgentMcpAdminRuleScope" AS ENUM (
  'GLOBAL',
  'PROVIDER_KEY',
  'ORIGIN',
  'CONNECTION_ID',
  'ACCOUNT_ID',
  'TOOL_PATTERN',
  'RISK_CLASS'
);

CREATE TYPE "AgentMcpAdminRuleAction" AS ENUM (
  'BLOCK_NEW',
  'BLOCK_RUNTIME',
  'QUARANTINE'
);

ALTER TABLE "agent_mcp_catalogs"
  RENAME COLUMN "service_digest" TO "principal_digest";

ALTER TABLE "agent_mcp_connections"
  ADD COLUMN "provider_key" VARCHAR(80),
  ADD COLUMN "runtime_key" VARCHAR(64),
  ADD COLUMN "display_name" VARCHAR(120),
  ADD COLUMN "endpoint_url" TEXT,
  ADD COLUMN "endpoint_origin" VARCHAR(512),
  ADD COLUMN "endpoint_host" VARCHAR(253),
  ADD COLUMN "endpoint_fingerprint" VARCHAR(64),
  ADD COLUMN "auth_mode_new" "AgentMcpAuthMode_new",
  ADD COLUMN "transport_mode_new" "AgentMcpTransportMode_new",
  ADD COLUMN "last_successful_transport_new" "AgentMcpResolvedTransport_new",
  ADD COLUMN "status_new" "AgentMcpConnectionStatus_new",
  ADD COLUMN "status_reason_code" VARCHAR(80),
  ADD COLUMN "status_message" VARCHAR(500),
  ADD COLUMN "server_name" VARCHAR(160),
  ADD COLUMN "server_version" VARCHAR(80),
  ADD COLUMN "server_identity_hash" VARCHAR(64),
  ADD COLUMN "protocol_version" VARCHAR(32),
  ADD COLUMN "catalog_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "catalog_hash" VARCHAR(64),
  ADD COLUMN "manifest_version" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_discovered_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_healthy_at" TIMESTAMPTZ(3),
  ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "circuit_opened_at" TIMESTAMPTZ(3),
  ADD COLUMN "circuit_open_until" TIMESTAMPTZ(3),
  ADD COLUMN "disabled_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "idempotency_key" VARCHAR(128);

-- Fail closed on relationships that cannot prove a single same-account owner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_mcp_connections" c
    LEFT JOIN "AgentService" s ON s."id" = c."service_id"
    LEFT JOIN "Agent" a ON a."id" = c."agent_db_id"
    LEFT JOIN "Agent" sa ON sa."id" = s."agentId"
    WHERE s."id" IS NULL
       OR a."id" IS NULL
       OR sa."id" IS NULL
       OR s."agentId" IS DISTINCT FROM c."agent_db_id"
       OR a."owner_account_id" IS NULL
       OR a."owner_account_id" <> c."app_account_id"
       OR sa."owner_account_id" IS NULL
       OR sa."owner_account_id" <> c."app_account_id"
  ) THEN
    RAISE EXCEPTION 'MCP cutover aborted: orphaned or cross-account connection relationship';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "agent_mcp_credentials" credential
    LEFT JOIN "agent_mcp_connections" connection
      ON connection."id" = credential."connection_id"
    WHERE connection."id" IS NULL
       OR credential."app_account_id" <> connection."app_account_id"
  ) OR EXISTS (
    SELECT 1
    FROM "agent_mcp_oauth_transactions" oauth
    LEFT JOIN "agent_mcp_connections" connection
      ON connection."id" = oauth."connection_id"
    WHERE connection."id" IS NULL
       OR oauth."app_account_id" <> connection."app_account_id"
  ) OR EXISTS (
    SELECT 1
    FROM "agent_mcp_continuations" continuation
    LEFT JOIN "agent_mcp_connections" connection
      ON connection."id" = continuation."connection_id"
    LEFT JOIN "Agent" agent
      ON agent."id" = continuation."agent_db_id"
    WHERE connection."id" IS NULL
       OR agent."id" IS NULL
       OR continuation."app_account_id" <> connection."app_account_id"
       OR agent."owner_account_id" IS NULL
       OR continuation."app_account_id" <> agent."owner_account_id"
  ) THEN
    RAISE EXCEPTION 'MCP cutover aborted: orphaned or cross-account auth/continuation relationship';
  END IF;
END $$;

-- Legacy continuation ciphertext predates explicit binding and descriptor/schema
-- capability identity. It cannot be safely rebound during the cutover, so revoke
-- these short-lived capabilities rather than allowing a later replacement binding
-- to inherit them.
DELETE FROM "agent_mcp_continuations";

UPDATE "agent_mcp_connections" c
SET
  "runtime_key" = 'mcp_' || substr(md5(c."id"), 1, 16),
  "display_name" = LEFT(COALESCE(NULLIF(BTRIM(s."name"), ''), 'MCP connection'), 120),
  -- Do not copy legacy userinfo, query credentials, or fragments into the new
  -- endpoint metadata. Non-canonical values receive a non-routable placeholder
  -- and must be explicitly re-entered through the current endpoint validator.
  "endpoint_url" = CASE
    WHEN BTRIM(s."endpoint") ~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN BTRIM(s."endpoint")
    ELSE 'https://invalid.invalid/mcp-reentry-required'
  END,
  "endpoint_origin" = CASE
    WHEN BTRIM(s."endpoint") ~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN LEFT(LOWER(substring(BTRIM(s."endpoint") FROM '(?i)^(https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?)')), 512)
    ELSE 'https://invalid.invalid'
  END,
  "endpoint_host" = CASE
    WHEN BTRIM(s."endpoint") ~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN LEFT(LOWER(substring(BTRIM(s."endpoint") FROM '(?i)^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)')), 253)
    ELSE 'invalid.invalid'
  END,
  "endpoint_fingerprint" = repeat(md5(CASE
    WHEN BTRIM(s."endpoint") ~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN BTRIM(s."endpoint")
    ELSE 'https://invalid.invalid/mcp-reentry-required'
  END), 2),
  "auth_mode_new" = CASE c."auth_mode"::text
    WHEN 'BEARER' THEN 'BEARER_TOKEN'::"AgentMcpAuthMode_new"
    WHEN 'OAUTH' THEN 'OAUTH2_AUTHORIZATION_CODE'::"AgentMcpAuthMode_new"
    WHEN 'CLIENT_CREDENTIALS' THEN 'OAUTH2_CLIENT_CREDENTIALS'::"AgentMcpAuthMode_new"
    ELSE 'NONE'::"AgentMcpAuthMode_new"
  END,
  "transport_mode_new" = CASE c."transport_mode"::text
    WHEN 'SSE' THEN 'LEGACY_SSE'::"AgentMcpTransportMode_new"
    ELSE 'STREAMABLE_HTTP'::"AgentMcpTransportMode_new"
  END,
  "last_successful_transport_new" = CASE c."last_successful_transport"::text
    WHEN 'SSE' THEN 'LEGACY_SSE'::"AgentMcpResolvedTransport_new"
    WHEN 'STREAMABLE_HTTP' THEN 'STREAMABLE_HTTP'::"AgentMcpResolvedTransport_new"
    ELSE NULL
  END,
  "status_new" = CASE
    WHEN BTRIM(s."endpoint") !~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN 'BLOCKED'::"AgentMcpConnectionStatus_new"
    -- The legacy envelope does not contain a reviewed token endpoint. Reusing
    -- its client secret before endpoint/issuer pinning would permit discovery
    -- metadata to choose where the secret is sent.
    WHEN c."auth_mode"::text = 'CLIENT_CREDENTIALS' THEN 'REAUTH_REQUIRED'::"AgentMcpConnectionStatus_new"
    WHEN c."status"::text = 'READY' THEN 'READY'::"AgentMcpConnectionStatus_new"
    WHEN c."status"::text = 'AUTH_REQUIRED' THEN 'REAUTH_REQUIRED'::"AgentMcpConnectionStatus_new"
    WHEN c."status"::text = 'UNAVAILABLE' THEN 'DEGRADED'::"AgentMcpConnectionStatus_new"
    WHEN c."status"::text = 'INVALID' THEN 'INVALID'::"AgentMcpConnectionStatus_new"
    ELSE 'DRAFT'::"AgentMcpConnectionStatus_new"
  END,
  "status_reason_code" = CASE
    WHEN BTRIM(s."endpoint") !~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN 'MCP_ENDPOINT_BLOCKED'
    WHEN c."auth_mode"::text = 'CLIENT_CREDENTIALS' THEN 'MCP_AUTH_REQUIRED'
    ELSE c."last_error_code"
  END,
  "status_message" = CASE
    WHEN BTRIM(s."endpoint") !~* '^https://(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?(/[^?#]*)?$'
      THEN 'Legacy endpoint was not canonical public HTTPS and must be re-entered.'
    WHEN c."auth_mode"::text = 'CLIENT_CREDENTIALS'
      THEN 'Re-enter OAuth client credentials with a reviewed token endpoint and issuer.'
    ELSE LEFT(c."last_error_text", 500)
  END,
  "last_verified_at" = c."last_connected_at",
  "last_healthy_at" = CASE
    WHEN c."status"::text = 'READY' AND c."auth_mode"::text <> 'CLIENT_CREDENTIALS'
      THEN c."last_connected_at"
    ELSE NULL
  END
FROM "AgentService" s
WHERE s."id" = c."service_id";

UPDATE "agent_mcp_connections" c
SET
  "catalog_revision" = 1,
  "catalog_hash" = cat."tools_digest",
  "protocol_version" = cat."protocol_version",
  "server_name" = LEFT(NULLIF(cat."server_info_json"->>'name', ''), 160),
  "server_version" = LEFT(NULLIF(cat."server_info_json"->>'version', ''), 80),
  "last_discovered_at" = cat."fetched_at"
FROM "agent_mcp_catalogs" cat
WHERE cat."connection_id" = c."id";

ALTER TABLE "agent_mcp_connections"
  ALTER COLUMN "display_name" SET NOT NULL,
  ALTER COLUMN "runtime_key" SET NOT NULL,
  ALTER COLUMN "endpoint_url" SET NOT NULL,
  ALTER COLUMN "endpoint_origin" SET NOT NULL,
  ALTER COLUMN "endpoint_host" SET NOT NULL,
  ALTER COLUMN "endpoint_fingerprint" SET NOT NULL,
  ALTER COLUMN "auth_mode_new" SET NOT NULL,
  ALTER COLUMN "auth_mode_new" SET DEFAULT 'NONE',
  ALTER COLUMN "transport_mode_new" SET NOT NULL,
  ALTER COLUMN "transport_mode_new" SET DEFAULT 'STREAMABLE_HTTP',
  ALTER COLUMN "status_new" SET NOT NULL,
  ALTER COLUMN "status_new" SET DEFAULT 'DRAFT';

-- Composite tenant keys make same-account ownership a database invariant for
-- every live MCP child record, not merely an application-service convention.
CREATE UNIQUE INDEX "Agent_id_owner_account_id_key"
  ON "Agent"("id", "owner_account_id");
CREATE UNIQUE INDEX "agent_mcp_connections_id_app_account_id_key"
  ON "agent_mcp_connections"("id", "app_account_id");

CREATE TABLE "agent_mcp_bindings" (
  "id" TEXT NOT NULL,
  "app_account_id" TEXT NOT NULL,
  "agent_db_id" INTEGER NOT NULL,
  "connection_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "approval_mode" "AgentMcpApprovalMode_new" NOT NULL DEFAULT 'AUTO_READ_ONLY',
  "max_calls_per_run" INTEGER NOT NULL DEFAULT 12,
  "max_parallel_calls" INTEGER NOT NULL DEFAULT 2,
  "call_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  "output_byte_limit" INTEGER NOT NULL DEFAULT 1048576,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_mcp_bindings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "agent_mcp_bindings" (
  "id", "app_account_id", "agent_db_id", "connection_id", "enabled",
  "approval_mode", "created_at", "updated_at"
)
SELECT
  'mcpb_' || substr(md5(c."id"), 1, 24),
  c."app_account_id",
  c."agent_db_id",
  c."id",
  c."enabled",
  CASE c."approval_mode"::text
    WHEN 'MUTATIONS' THEN 'CONFIRM_MUTATIONS'::"AgentMcpApprovalMode_new"
    WHEN 'ALWAYS' THEN 'CONFIRM_EVERY_CALL'::"AgentMcpApprovalMode_new"
    ELSE 'AUTO_READ_ONLY'::"AgentMcpApprovalMode_new"
  END,
  c."created_at",
  c."updated_at"
FROM "agent_mcp_connections" c;

CREATE UNIQUE INDEX "agent_mcp_bindings_agent_db_id_connection_id_key"
  ON "agent_mcp_bindings"("agent_db_id", "connection_id");
CREATE UNIQUE INDEX "agent_mcp_bindings_policy_scope_key"
  ON "agent_mcp_bindings"("id", "connection_id");
CREATE UNIQUE INDEX "agent_mcp_bindings_continuation_scope_key"
  ON "agent_mcp_bindings"("id", "connection_id", "app_account_id", "agent_db_id");
CREATE INDEX "agent_mcp_bindings_app_account_id_enabled_idx"
  ON "agent_mcp_bindings"("app_account_id", "enabled");
CREATE INDEX "agent_mcp_bindings_connection_id_enabled_idx"
  ON "agent_mcp_bindings"("connection_id", "enabled");
ALTER TABLE "agent_mcp_bindings" ADD CONSTRAINT "agent_mcp_bindings_app_account_id_fkey"
  FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_bindings" ADD CONSTRAINT "agent_mcp_bindings_agent_db_id_app_account_id_fkey"
  FOREIGN KEY ("agent_db_id", "app_account_id") REFERENCES "Agent"("id", "owner_account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_bindings" ADD CONSTRAINT "agent_mcp_bindings_connection_id_app_account_id_fkey"
  FOREIGN KEY ("connection_id", "app_account_id") REFERENCES "agent_mcp_connections"("id", "app_account_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_mcp_credentials"
  DROP CONSTRAINT "agent_mcp_credentials_connection_id_fkey",
  ADD CONSTRAINT "agent_mcp_credentials_connection_id_app_account_id_fkey"
    FOREIGN KEY ("connection_id", "app_account_id") REFERENCES "agent_mcp_connections"("id", "app_account_id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "agent_mcp_credentials_connection_id_app_account_id_key"
  ON "agent_mcp_credentials"("connection_id", "app_account_id");
ALTER TABLE "agent_mcp_oauth_transactions"
  DROP CONSTRAINT "agent_mcp_oauth_transactions_connection_id_fkey",
  ADD CONSTRAINT "agent_mcp_oauth_transactions_connection_id_app_account_id_fkey"
    FOREIGN KEY ("connection_id", "app_account_id") REFERENCES "agent_mcp_connections"("id", "app_account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_continuations"
  ADD COLUMN "binding_id" TEXT NOT NULL,
  DROP CONSTRAINT "agent_mcp_continuations_agent_db_id_fkey",
  DROP CONSTRAINT "agent_mcp_continuations_connection_id_fkey",
  ADD CONSTRAINT "agent_mcp_continuations_agent_db_id_app_account_id_fkey"
    FOREIGN KEY ("agent_db_id", "app_account_id") REFERENCES "Agent"("id", "owner_account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_mcp_continuations_connection_id_app_account_id_fkey"
    FOREIGN KEY ("connection_id", "app_account_id") REFERENCES "agent_mcp_connections"("id", "app_account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_mcp_continuations_binding_scope_fkey"
    FOREIGN KEY ("binding_id", "connection_id", "app_account_id", "agent_db_id")
    REFERENCES "agent_mcp_bindings"("id", "connection_id", "app_account_id", "agent_db_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "agent_mcp_continuations_binding_id_expires_at_idx"
  ON "agent_mcp_continuations"("binding_id", "expires_at");

CREATE TABLE "agent_mcp_tool_descriptors" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "title" VARCHAR(240),
  "description" TEXT,
  "input_schema" JSONB NOT NULL,
  "output_schema" JSONB,
  "schema_hash" VARCHAR(64) NOT NULL,
  "previous_schema_hash" VARCHAR(64),
  "annotations_snapshot" JSONB,
  "provider_risk" "AgentMcpToolRisk",
  "inferred_risk" "AgentMcpToolRisk" NOT NULL,
  "effective_risk" "AgentMcpToolRisk" NOT NULL,
  "risk_reason" VARCHAR(500),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "quarantined" BOOLEAN NOT NULL DEFAULT false,
  "quarantine_reason" VARCHAR(500),
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "agent_mcp_tool_descriptors_pkey" PRIMARY KEY ("id")
);

INSERT INTO "agent_mcp_tool_descriptors" (
  "id", "connection_id", "name", "title", "description",
  "input_schema", "output_schema", "schema_hash", "annotations_snapshot",
  "inferred_risk", "effective_risk", "risk_reason",
  "quarantined", "quarantine_reason", "first_seen_at", "last_seen_at"
)
SELECT
  'mcpt_' || substr(md5(cat."connection_id" || ':' || (tool.value->>'name')), 1, 24),
  cat."connection_id",
  LEFT(tool.value->>'name', 200),
  LEFT(COALESCE(tool.value->>'title', tool.value->'annotations'->>'title'), 240),
  LEFT(tool.value->>'description', 4000),
  COALESCE(tool.value->'inputSchema', '{}'::jsonb),
  tool.value->'outputSchema',
  repeat(md5(
    COALESCE(tool.value->>'name', '') || ':' ||
    COALESCE((tool.value->'inputSchema')::text, '{}') || ':' ||
    COALESCE((tool.value->'outputSchema')::text, 'null') || ':' ||
    COALESCE((tool.value->'annotations')::text, 'null')
  ), 2),
  tool.value->'annotations',
  'UNKNOWN'::"AgentMcpToolRisk",
  'UNKNOWN'::"AgentMcpToolRisk",
  'Migrated catalog requires local risk reclassification',
  true,
  'Migrated catalog is quarantined until bounded rediscovery and local risk reclassification complete',
  cat."fetched_at",
  cat."fetched_at"
FROM "agent_mcp_catalogs" cat
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(cat."tools_json") = 'array' THEN cat."tools_json" ELSE '[]'::jsonb END
) AS tool(value)
WHERE jsonb_typeof(tool.value) = 'object'
  AND NULLIF(BTRIM(tool.value->>'name'), '') IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "agent_mcp_tool_descriptors_connection_id_name_key"
  ON "agent_mcp_tool_descriptors"("connection_id", "name");
CREATE UNIQUE INDEX "agent_mcp_tool_descriptors_policy_scope_key"
  ON "agent_mcp_tool_descriptors"("id", "connection_id");
CREATE INDEX "agent_mcp_tool_descriptors_connection_id_active_idx"
  ON "agent_mcp_tool_descriptors"("connection_id", "active");
CREATE INDEX "agent_mcp_tool_descriptors_effective_risk_quarantined_idx"
  ON "agent_mcp_tool_descriptors"("effective_risk", "quarantined");
ALTER TABLE "agent_mcp_tool_descriptors" ADD CONSTRAINT "agent_mcp_tool_descriptors_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_mcp_tool_policies" (
  "id" TEXT NOT NULL,
  "binding_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "tool_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "approval_mode" "AgentMcpApprovalMode_new",
  "max_calls_per_run" INTEGER,
  "input_constraint" JSONB,
  "acknowledged_schema_hash" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_mcp_tool_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_mcp_tool_policies_binding_id_tool_id_key"
  ON "agent_mcp_tool_policies"("binding_id", "tool_id");
CREATE INDEX "agent_mcp_tool_policies_tool_id_idx"
  ON "agent_mcp_tool_policies"("tool_id");
CREATE INDEX "agent_mcp_tool_policies_connection_id_idx"
  ON "agent_mcp_tool_policies"("connection_id");
ALTER TABLE "agent_mcp_tool_policies" ADD CONSTRAINT "agent_mcp_tool_policies_binding_scope_fkey"
  FOREIGN KEY ("binding_id", "connection_id") REFERENCES "agent_mcp_bindings"("id", "connection_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_tool_policies" ADD CONSTRAINT "agent_mcp_tool_policies_tool_scope_fkey"
  FOREIGN KEY ("tool_id", "connection_id") REFERENCES "agent_mcp_tool_descriptors"("id", "connection_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_mcp_audit_logs" (
  "id" TEXT NOT NULL,
  "app_account_id" TEXT NOT NULL,
  "agent_db_id" INTEGER,
  "binding_id" TEXT,
  "connection_id" TEXT,
  "tool_id" TEXT,
  "actor_profile_id" INTEGER,
  "action" VARCHAR(80) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "reason_code" VARCHAR(80),
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_mcp_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_mcp_admin_rules" (
  "id" TEXT NOT NULL,
  "scope" "AgentMcpAdminRuleScope" NOT NULL,
  "value" VARCHAR(512) NOT NULL,
  "action" "AgentMcpAdminRuleAction" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT NOT NULL DEFAULT '',
  "created_by" VARCHAR(160),
  "updated_by" VARCHAR(160),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "agent_mcp_admin_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_mcp_admin_rules_scope_value_action_key"
  ON "agent_mcp_admin_rules"("scope", "value", "action");
CREATE INDEX "agent_mcp_admin_rules_active_scope_action_idx"
  ON "agent_mcp_admin_rules"("active", "scope", "action");
CREATE INDEX "agent_mcp_audit_logs_app_account_id_created_at_idx"
  ON "agent_mcp_audit_logs"("app_account_id", "created_at" DESC);
CREATE INDEX "agent_mcp_audit_logs_connection_id_created_at_idx"
  ON "agent_mcp_audit_logs"("connection_id", "created_at" DESC);
CREATE INDEX "agent_mcp_audit_logs_agent_db_id_created_at_idx"
  ON "agent_mcp_audit_logs"("agent_db_id", "created_at" DESC);
ALTER TABLE "agent_mcp_audit_logs" ADD CONSTRAINT "agent_mcp_audit_logs_app_account_id_fkey"
  FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_audit_logs" ADD CONSTRAINT "agent_mcp_audit_logs_agent_db_id_fkey"
  FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_audit_logs" ADD CONSTRAINT "agent_mcp_audit_logs_binding_id_fkey"
  FOREIGN KEY ("binding_id") REFERENCES "agent_mcp_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_audit_logs" ADD CONSTRAINT "agent_mcp_audit_logs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "agent_mcp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_mcp_audit_logs" ADD CONSTRAINT "agent_mcp_audit_logs_tool_id_fkey"
  FOREIGN KEY ("tool_id") REFERENCES "agent_mcp_tool_descriptors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_chat_tool_events"
  ADD COLUMN "source_binding_id" TEXT,
  ADD COLUMN "source_descriptor_id" TEXT,
  ADD COLUMN "catalog_revision" INTEGER,
  ADD COLUMN "schema_hash" VARCHAR(64),
  ADD COLUMN "effective_risk" VARCHAR(32),
  ADD COLUMN "approval_decision" VARCHAR(40),
  ADD COLUMN "request_bytes" INTEGER,
  ADD COLUMN "response_bytes" INTEGER,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sanitized_target_json" JSONB;

-- Verify the relationship backfill before deleting the legacy ownership columns.
DO $$
DECLARE
  old_relationship_count BIGINT;
  new_relationship_count BIGINT;
  old_enabled_count BIGINT;
  new_enabled_count BIGINT;
BEGIN
  SELECT count(*) INTO old_relationship_count
  FROM "agent_mcp_connections";
  SELECT count(*) INTO new_relationship_count
  FROM "agent_mcp_bindings";
  IF old_relationship_count <> new_relationship_count THEN
    RAISE EXCEPTION 'MCP cutover aborted: relationship count mismatch (% vs %)',
      old_relationship_count, new_relationship_count;
  END IF;
  SELECT count(*) INTO old_enabled_count
  FROM "agent_mcp_connections"
  WHERE "enabled" = true;
  SELECT count(*) INTO new_enabled_count
  FROM "agent_mcp_bindings"
  WHERE "enabled" = true;
  IF old_enabled_count <> new_enabled_count THEN
    RAISE EXCEPTION 'MCP cutover aborted: enabled relationship count mismatch (% vs %)',
      old_enabled_count, new_enabled_count;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "agent_mcp_credentials" credential
    JOIN "agent_mcp_connections" connection ON connection."id" = credential."connection_id"
    WHERE credential."app_account_id" <> connection."app_account_id"
  ) THEN
    RAISE EXCEPTION 'MCP cutover aborted: credential/account ownership mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "agent_mcp_bindings" binding
    LEFT JOIN "agent_mcp_connections" connection
      ON connection."id" = binding."connection_id"
    LEFT JOIN "Agent" agent
      ON agent."id" = binding."agent_db_id"
    WHERE connection."id" IS NULL
       OR agent."id" IS NULL
       OR binding."app_account_id" <> connection."app_account_id"
       OR agent."owner_account_id" IS NULL
       OR binding."app_account_id" <> agent."owner_account_id"
  ) THEN
    RAISE EXCEPTION 'MCP cutover aborted: binding/account ownership mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "mcp_credential_ciphertext_guard" guard
    LEFT JOIN "agent_mcp_credentials" credential ON credential."id" = guard."id"
    WHERE credential."id" IS NULL
       OR md5(credential."encrypted_secret") <> guard."ciphertext_checksum"
       OR credential."encryption_key_id" <> guard."encryption_key_id"
       OR credential."encryption_version" <> guard."encryption_version"
       OR credential."fingerprint" <> guard."fingerprint"
  ) OR EXISTS (
    SELECT 1
    FROM "agent_mcp_credentials" credential
    LEFT JOIN "mcp_credential_ciphertext_guard" guard ON guard."id" = credential."id"
    WHERE guard."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'MCP cutover aborted: credential ciphertext envelope changed';
  END IF;
END $$;

DROP TABLE "mcp_credential_ciphertext_guard";

DROP INDEX "agent_mcp_connections_app_account_id_service_id_key";
DROP INDEX "agent_mcp_connections_agent_db_id_enabled_idx";
DROP INDEX "agent_mcp_connections_app_account_id_agent_db_id_idx";
ALTER TABLE "agent_mcp_connections"
  DROP CONSTRAINT "agent_mcp_connections_agent_db_id_fkey",
  DROP CONSTRAINT "agent_mcp_connections_service_id_fkey",
  DROP COLUMN "agent_db_id",
  DROP COLUMN "service_id",
  DROP COLUMN "enabled",
  DROP COLUMN "approval_mode",
  DROP COLUMN "annotations_trusted",
  DROP COLUMN "auth_mode",
  DROP COLUMN "transport_mode",
  DROP COLUMN "last_successful_transport",
  DROP COLUMN "status";

ALTER TABLE "agent_mcp_oauth_transactions"
  ADD COLUMN "transport_kind_new" "AgentMcpResolvedTransport_new",
  ADD COLUMN "resource_url" TEXT;
UPDATE "agent_mcp_oauth_transactions" AS oauth
SET
  "resource_url" = connection."endpoint_url",
  "transport_kind_new" = CASE oauth."transport_kind"::text
  WHEN 'SSE' THEN 'LEGACY_SSE'::"AgentMcpResolvedTransport_new"
  WHEN 'STREAMABLE_HTTP' THEN 'STREAMABLE_HTTP'::"AgentMcpResolvedTransport_new"
  ELSE NULL
END
FROM "agent_mcp_connections" connection
WHERE connection."id" = oauth."connection_id";
ALTER TABLE "agent_mcp_oauth_transactions" ALTER COLUMN "resource_url" SET NOT NULL;
ALTER TABLE "agent_mcp_oauth_transactions" DROP COLUMN "transport_kind";

DROP TYPE "AgentMcpAuthMode";
DROP TYPE "AgentMcpConnectionStatus";
DROP TYPE "AgentMcpTransportMode";
DROP TYPE "AgentMcpResolvedTransport";
DROP TYPE "AgentMcpApprovalMode";
ALTER TYPE "AgentMcpAuthMode_new" RENAME TO "AgentMcpAuthMode";
ALTER TYPE "AgentMcpConnectionStatus_new" RENAME TO "AgentMcpConnectionStatus";
ALTER TYPE "AgentMcpTransportMode_new" RENAME TO "AgentMcpTransportMode";
ALTER TYPE "AgentMcpResolvedTransport_new" RENAME TO "AgentMcpResolvedTransport";
ALTER TYPE "AgentMcpApprovalMode_new" RENAME TO "AgentMcpApprovalMode";

ALTER TABLE "agent_mcp_connections"
  RENAME COLUMN "auth_mode_new" TO "auth_mode";
ALTER TABLE "agent_mcp_connections"
  RENAME COLUMN "transport_mode_new" TO "transport_mode";
ALTER TABLE "agent_mcp_connections"
  RENAME COLUMN "last_successful_transport_new" TO "last_successful_transport";
ALTER TABLE "agent_mcp_connections"
  RENAME COLUMN "status_new" TO "status";
ALTER TABLE "agent_mcp_oauth_transactions"
  RENAME COLUMN "transport_kind_new" TO "transport_kind";
ALTER TABLE "agent_mcp_oauth_transactions"
  ADD COLUMN "return_agent_db_id" INTEGER;

CREATE UNIQUE INDEX "agent_mcp_connections_app_account_id_idempotency_key_key"
  ON "agent_mcp_connections"("app_account_id", "idempotency_key");
CREATE UNIQUE INDEX "agent_mcp_connections_runtime_key_key"
  ON "agent_mcp_connections"("runtime_key");
CREATE INDEX "agent_mcp_connections_app_account_id_status_idx"
  ON "agent_mcp_connections"("app_account_id", "status");
CREATE INDEX "agent_mcp_connections_app_account_id_provider_key_idx"
  ON "agent_mcp_connections"("app_account_id", "provider_key");
CREATE INDEX "agent_mcp_connections_endpoint_host_idx"
  ON "agent_mcp_connections"("endpoint_host");
CREATE INDEX "agent_mcp_connections_deleted_at_idx"
  ON "agent_mcp_connections"("deleted_at");
