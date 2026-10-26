-- JSONB → native relational migration (see JSONB_TO_NATIVE.md).
--
-- 1.  SAP relationalization: Agent.sapCapabilities → AgentSapCapability child
--     table + Agent.sapCapabilityCount; sapStats → native scalar columns;
--     sapPricingTiers → native pricing projections (JSON retained as evidence).
-- 2.  AgentChatMessage: add searchText + attachment flags; index search_text
--     instead of the whole serialized `parts` document.
-- 3.  PartnerJob.tags → text[]; add derived semantic facets text[].
-- 4.  AgentAlertRule.eventTypes → text[] with a GIN array index.
-- 5.  Native array cleanup: AgentService.skills/domains/capabilities,
--     Agent.workReadyReasons, ArTokenHolderSnapshot.eligiblePerks,
--     ArPayoutBatch.txSignatures, MetaplexLaunchAttempt.genesisTxSignatures
--     (+ first-element genesisTxSignature column).
-- 6.  IndexerEndpointState: stable capability/health fields → native columns,
--     residual JSONB retained for learnedLogRanges + protocol extensions.
-- 7.  Pre-existing schema fix: unique (conversationId, sourceMessageId) for the
--     AgentMemoryExtractionOutbox one-to-one relation to AgentChatMessage.

-- Prisma does not automatically wrap PostgreSQL migration.sql files in a
-- transaction. Keep these DDL + backfill + type-conversion steps atomic so a
-- later failure cannot leave a partially converted schema behind.
BEGIN;

-- ===========================================================================
-- 1. SAP relationalization
-- ===========================================================================

ALTER TABLE "Agent"
  ADD COLUMN "sap_capability_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sap_min_price_per_call" DECIMAL(18,8),
  ADD COLUMN "sap_pricing_tier_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sap_primary_tier_id" TEXT,
  ADD COLUMN "sap_identity_name" TEXT,
  ADD COLUMN "sap_identity_is_active" BOOLEAN,
  ADD COLUMN "sap_reputation_score" DOUBLE PRECISION,
  ADD COLUMN "sap_identity_total_calls_served" DECIMAL(20,0),
  ADD COLUMN "sap_identity_total_feedbacks" INTEGER,
  ADD COLUMN "sap_stats_total_calls_served" DECIMAL(20,0),
  ADD COLUMN "sap_stats_active" BOOLEAN,
  ADD COLUMN "sap_stats_updated_at" TIMESTAMPTZ(3);

CREATE INDEX "Agent_sap_leaderboard_idx"
  ON "Agent" ("sap_verified", "isActive", "sap_reputation_score" DESC, "sap_registered_at" DESC);

-- Backfill native stats projections from the canonical sap_stats document.
UPDATE "Agent" SET
  "sap_identity_name" = NULLIF(COALESCE(sap_stats->>'identityName', ''), ''),
  "sap_identity_is_active" = CASE WHEN sap_stats ? 'identityIsActive' THEN (sap_stats->>'identityIsActive')::boolean END,
  "sap_reputation_score" = CASE WHEN sap_stats ? 'identityReputationScore' THEN (sap_stats->>'identityReputationScore')::double precision END,
  "sap_identity_total_calls_served" = CASE WHEN NULLIF(COALESCE(sap_stats->>'identityTotalCallsServed', ''), '') IS NOT NULL THEN (sap_stats->>'identityTotalCallsServed')::numeric END,
  "sap_identity_total_feedbacks" = CASE WHEN sap_stats ? 'identityTotalFeedbacks' THEN (sap_stats->>'identityTotalFeedbacks')::integer END,
  "sap_stats_total_calls_served" = CASE WHEN NULLIF(COALESCE(sap_stats->'agentStatsPda'->>'totalCallsServed', ''), '') IS NOT NULL THEN (sap_stats->'agentStatsPda'->>'totalCallsServed')::numeric END,
  "sap_stats_active" = CASE WHEN sap_stats->'agentStatsPda' ? 'isActive' THEN (sap_stats->'agentStatsPda'->>'isActive')::boolean END,
  "sap_stats_updated_at" = CASE WHEN NULLIF(COALESCE(sap_stats->'agentStatsPda'->>'updatedAt', ''), '') IS NOT NULL THEN to_timestamp((sap_stats->'agentStatsPda'->>'updatedAt')::double precision) END
WHERE sap_stats IS NOT NULL AND sap_stats <> 'null'::jsonb;

-- Backfill native pricing projections from the canonical pricing tiers document.
UPDATE "Agent" SET
  "sap_min_price_per_call" = (
    SELECT MIN(NULLIF(t->>'pricePerCall', '')::numeric)
    FROM jsonb_array_elements(COALESCE(sap_pricing_tiers, '[]'::jsonb)) AS t
  ),
  "sap_pricing_tier_count" = jsonb_array_length(COALESCE(sap_pricing_tiers, '[]'::jsonb)),
  "sap_primary_tier_id" = (
    SELECT t->>'tierId'
    FROM jsonb_array_elements(COALESCE(sap_pricing_tiers, '[]'::jsonb)) AS t
    LIMIT 1
  )
WHERE sap_pricing_tiers IS NOT NULL AND sap_pricing_tiers <> 'null'::jsonb;

-- Relational capability rows mirroring the canonical sap_capabilities array.
CREATE TABLE "agent_sap_capabilities" (
  "id" SERIAL NOT NULL,
  "agent_db_id" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "capability_key" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL DEFAULT '',
  "protocol" TEXT NOT NULL DEFAULT '',
  "version" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "agent_sap_capabilities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_sap_capabilities"
  ADD CONSTRAINT "agent_sap_capabilities_agent_fkey"
  FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "agent_sap_capabilities_agent_ordinal_unique"
  ON "agent_sap_capabilities" ("agent_db_id", "ordinal");
CREATE INDEX "agent_sap_capabilities_key_agent_idx"
  ON "agent_sap_capabilities" ("capability_key", "agent_db_id");
CREATE INDEX "agent_sap_capabilities_protocol_agent_idx"
  ON "agent_sap_capabilities" ("protocol", "agent_db_id");
CREATE INDEX "agent_sap_capabilities_agent_ordinal_idx"
  ON "agent_sap_capabilities" ("agent_db_id", "ordinal");

-- Backfill from the existing sap_capabilities JSON array (idempotent: any agent
-- with a non-array/null value simply produces no rows).
INSERT INTO "agent_sap_capabilities"
  ("agent_db_id", "ordinal", "capability_key", "capability_id", "protocol", "version", "description")
SELECT
  a."id",
  e.ordinal,
  COALESCE(
    NULLIF(COALESCE(e.value->>'id', ''), ''),
    CASE
      WHEN NULLIF(COALESCE(e.value->>'protocol', ''), '') IS NOT NULL
        THEN COALESCE(e.value->>'protocol', '') ||
             CASE WHEN NULLIF(COALESCE(e.value->>'version', ''), '') IS NOT NULL
               THEN '@' || COALESCE(e.value->>'version', '')
               ELSE '' END
      ELSE 'unknown'
    END
  ),
  COALESCE(e.value->>'id', ''),
  COALESCE(e.value->>'protocol', ''),
  COALESCE(e.value->>'version', ''),
  COALESCE(e.value->>'description', '')
FROM "Agent" a
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.sap_capabilities, '[]'::jsonb))
  WITH ORDINALITY AS e(value, ordinal)
WHERE a.sap_capabilities IS NOT NULL
  AND a.sap_capabilities <> 'null'::jsonb
  AND jsonb_typeof(a.sap_capabilities) = 'array';

-- Denormalized capability count for cheap leaderboard/count queries.
UPDATE "Agent" a
SET "sap_capability_count" = (
  SELECT count(*)::int FROM "agent_sap_capabilities" c WHERE c.agent_db_id = a.id
)
WHERE a.sap_capabilities IS NOT NULL AND a.sap_capabilities <> 'null'::jsonb;

-- Whole-JSON trigram capability index is superseded by the relational table.
DROP INDEX IF EXISTS agent_sap_capabilities_trgm_idx;

-- ===========================================================================
-- 2. AgentChatMessage search projection
-- ===========================================================================

ALTER TABLE "agent_chat_messages"
  ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "has_file" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_image_file" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "file_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill a bounded normalized projection of `parts` for existing rows. New
-- rows carry a bounded semantic projection computed by the application.
UPDATE "agent_chat_messages"
SET "search_text" = LEFT(COALESCE(public.agentranking_search_normalize_jsonb(parts), ''), 24000)
WHERE "search_text" = '';

UPDATE "agent_chat_messages" m SET
  "has_file" = EXISTS (SELECT 1 FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'file'),
  "has_image_file" = EXISTS (SELECT 1 FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'file' AND p->>'mediaType' LIKE 'image/%'),
  "file_count" = COALESCE((SELECT count(*)::int FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'file'), 0)
WHERE jsonb_typeof(m.parts) = 'array';

-- Replace the whole-document JSON trigram GIN index with one over search_text.
DROP INDEX IF EXISTS agent_chat_messages_context_search_gin_idx;
CREATE INDEX "agent_chat_messages_search_text_gin_idx"
  ON "agent_chat_messages" USING GIN (
    conversation_id text_ops,
    public.agentranking_search_normalize(search_text) gin_trgm_ops
  );
ALTER INDEX "agent_chat_messages_search_text_gin_idx" ALTER COLUMN 2 SET STATISTICS 250;

-- ===========================================================================
-- 3. PartnerJob.tags → text[] + derived facets
-- ===========================================================================

-- PostgreSQL does not allow subqueries in an ALTER COLUMN TYPE ... USING
-- expression, so jsonb → text[] conversions use this migration-owned helper
-- (same conventions as agentranking_search_normalize).
CREATE OR REPLACE FUNCTION public.agentranking_jsonb_to_text_array(value jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE WHEN jsonb_typeof(value) = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(value))
    ELSE ARRAY[]::text[] END
$function$;

COMMENT ON FUNCTION public.agentranking_jsonb_to_text_array(jsonb) IS
  'Migration-owned jsonb → text[] conversion used by ALTER COLUMN TYPE.';

ALTER TABLE partner_jobs
  ALTER COLUMN tags DROP DEFAULT,
  ALTER COLUMN tags TYPE text[] USING public.agentranking_jsonb_to_text_array(tags),
  ALTER COLUMN tags SET DEFAULT ARRAY[]::text[];

ALTER TABLE partner_jobs
  ADD COLUMN facets text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Backfill facets from the same category/jobType/tags semantics used by
-- matchesCategoryFilter() so category filtering becomes a pure SQL predicate.
UPDATE partner_jobs SET facets = COALESCE((
  SELECT array_agg(f ORDER BY f) FROM (VALUES
    ('social'), ('human_feedback'), ('research'), ('data'),
    ('growth'), ('contests'), ('manual'), ('on_chain')
  ) AS v(f)
  WHERE
    lower(COALESCE(category, '') || ' ' || COALESCE(job_type, '') || ' ' || COALESCE(array_to_string(tags, ' '), '')) ~
      CASE f
        WHEN 'social' THEN 'social|twitter|x_|instagram|telegram|discord'
        WHEN 'human_feedback' THEN 'human|feedback|review|rating'
        WHEN 'research' THEN 'research|survey|analysis'
        WHEN 'data' THEN 'data|scraping|dataset'
        WHEN 'growth' THEN 'growth|marketing|campaign'
        WHEN 'contests' THEN 'contest|competition|winner'
        WHEN 'manual' THEN 'manual|verification|proof'
        WHEN 'on_chain' THEN 'on.?chain|solana|usdc|x402|crypto|web3'
        ELSE '^$'
      END
), ARRAY[]::text[]);

CREATE INDEX "partner_jobs_facets_idx" ON partner_jobs USING GIN (facets);
CREATE INDEX "partner_jobs_tags_idx" ON partner_jobs USING GIN (tags);

-- ===========================================================================
-- 4. AgentAlertRule.eventTypes → text[]
-- ===========================================================================

ALTER TABLE "AgentAlertRule"
  ALTER COLUMN "eventTypes" DROP DEFAULT,
  ALTER COLUMN "eventTypes" TYPE text[] USING public.agentranking_jsonb_to_text_array("eventTypes"),
  ALTER COLUMN "eventTypes" SET DEFAULT ARRAY[]::text[];

CREATE INDEX "AgentAlertRule_eventTypes_idx" ON "AgentAlertRule" USING GIN ("eventTypes");

-- ===========================================================================
-- 5. Native array cleanup
-- ===========================================================================

ALTER TABLE "AgentService"
  ALTER COLUMN skills DROP DEFAULT,
  ALTER COLUMN skills TYPE text[] USING public.agentranking_jsonb_to_text_array(skills),
  ALTER COLUMN skills SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN skills SET NOT NULL;
ALTER TABLE "AgentService"
  ALTER COLUMN domains DROP DEFAULT,
  ALTER COLUMN domains TYPE text[] USING public.agentranking_jsonb_to_text_array(domains),
  ALTER COLUMN domains SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN domains SET NOT NULL;
ALTER TABLE "AgentService"
  ALTER COLUMN capabilities DROP DEFAULT,
  ALTER COLUMN capabilities TYPE text[] USING public.agentranking_jsonb_to_text_array(capabilities),
  ALTER COLUMN capabilities SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN capabilities SET NOT NULL;

-- The public-cache trigger lists the column in AFTER UPDATE OF, so it must be
-- dropped around the type change and recreated byte-for-byte below.
DROP TRIGGER "Agent_public_cache_domains_update" ON "Agent";

ALTER TABLE "Agent"
  ALTER COLUMN work_ready_reasons DROP DEFAULT,
  ALTER COLUMN work_ready_reasons TYPE text[] USING public.agentranking_jsonb_to_text_array(work_ready_reasons),
  ALTER COLUMN work_ready_reasons SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN work_ready_reasons SET NOT NULL;

CREATE TRIGGER "Agent_public_cache_domains_update"
AFTER UPDATE OF "agentId", "chainId", name, description, image, "agentURI", owner, publicly_active, "isActive", "isVerified", score, "hotScore", rank, "x402Support", "isSmartBatchEnabled", stars, "totalFeedback", "totalMessages", "totalChats", "totalWatches", "scoreQuality", "scorePopularity", "scoreActivity", "scoreWallet", "scoreFreshness", score_verified_revenue, "scoreMetadata", "scoreServices", score_social, score_compliance, "supportedTrust", "isCustomListed", "isPremiumVerified", public_verification_status, "binanceCompatible", "hasDuplicateName", "powerScore", "agentRankScore", discovery_score, "activityScore", "adminPowerAdjust", "activeBoosts", "voteFireCount", "votePooCount", "tokenAddress", archetype, "archetypeAuto", "agentMode", "protocolTrustScore", "executionScore", "verifiedWallet", "verifiedWalletAt", "verifiedWalletChainId", "perfWinRate", "perfAvgPnlPercent", "perfBurnToEarnRatio", "perfTotalVolumeUsd", "perfMonthlyPnlUsd", "perfLastComputedAt", "perfTxCount", "perfProfitableTxCount", "isVerifiedRevenue", "verifiedRevenueAt", "verifiedRevenueExpiresAt", "recentActivity", "activityUpdatedAt", "activeWinRate30d", "nativeVolume30d", listing_registry_source, sap_verified, sap_agent_pda, sap_stats_pda, sap_capabilities, sap_pricing_tiers, sap_protocols, sap_x402_endpoint, sap_registration_tx, sap_last_synced_at, sap_stats, sap_owner_wallet, sap_registered_at, metaplex_verified, metaplex_agent_token_mint, metaplex_asset_address, metaplex_active, metaplex_launch_address, metaplex_launch_type, metaplex_launch_status, metaplex_bonding_progress_pct, metaplex_has_dex_pair, public_referral_code, public_referral_destination, public_referral_info, work_ready_status, work_ready_reasons, featured_work_ready, "listedAt", "lastActiveAt", cluster_key, ar_verification_status, ar_verified_at ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();

ALTER TABLE "ArTokenHolderSnapshot"
  ALTER COLUMN "eligiblePerks" DROP DEFAULT,
  ALTER COLUMN "eligiblePerks" TYPE text[] USING public.agentranking_jsonb_to_text_array("eligiblePerks"),
  ALTER COLUMN "eligiblePerks" SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN "eligiblePerks" SET NOT NULL;

ALTER TABLE "ArPayoutBatch"
  ALTER COLUMN "txSignatures" DROP DEFAULT,
  ALTER COLUMN "txSignatures" TYPE text[] USING public.agentranking_jsonb_to_text_array("txSignatures"),
  ALTER COLUMN "txSignatures" SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN "txSignatures" SET NOT NULL;

ALTER TABLE "metaplex_launch_attempts"
  ALTER COLUMN "genesis_tx_signatures" DROP DEFAULT,
  ALTER COLUMN "genesis_tx_signatures" TYPE text[] USING public.agentranking_jsonb_to_text_array("genesis_tx_signatures"),
  ALTER COLUMN "genesis_tx_signatures" SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN "genesis_tx_signatures" SET NOT NULL;

ALTER TABLE "metaplex_launch_attempts"
  ADD COLUMN "genesis_tx_signature" TEXT;

UPDATE "metaplex_launch_attempts"
SET "genesis_tx_signature" = "genesis_tx_signatures"[1]
WHERE "genesis_tx_signatures" <> ARRAY[]::text[];

-- ===========================================================================
-- 6. IndexerEndpointState: stable capability/health fields → native columns
-- ===========================================================================

ALTER TABLE indexer_endpoint_states
  ADD COLUMN safe_tag BOOLEAN,
  ADD COLUMN finalized_tag BOOLEAN,
  ADD COLUMN eip1898 BOOLEAN,
  ADD COLUMN require_canonical BOOLEAN,
  ADD COLUMN supports_logs BOOLEAN,
  ADD COLUMN supports_calls BOOLEAN,
  ADD COLUMN archive_capable BOOLEAN,
  ADD COLUMN provider TEXT,
  ADD COLUMN selection_weight INTEGER,
  ADD COLUMN static_max_log_range INTEGER,
  ADD COLUMN health_success_count INTEGER,
  ADD COLUMN health_failure_count INTEGER,
  ADD COLUMN health_latency_ewma_ms INTEGER,
  ADD COLUMN health_cooldown_until TIMESTAMPTZ(3),
  ADD COLUMN health_last_success_at TIMESTAMPTZ(3),
  ADD COLUMN health_last_failure_at TIMESTAMPTZ(3),
  ADD COLUMN health_last_probe_at TIMESTAMPTZ(3);

-- Backfill EVM-shaped capability snapshots and strip the moved fields from the
-- residual JSONB (retaining learnedLogRanges + any protocol-specific keys).
UPDATE indexer_endpoint_states SET
  safe_tag = (capabilities->>'safeTag')::boolean,
  finalized_tag = (capabilities->>'finalizedTag')::boolean,
  eip1898 = (capabilities->>'eip1898')::boolean,
  require_canonical = (capabilities->>'requireCanonical')::boolean,
  supports_logs = (capabilities->>'supportsLogs')::boolean,
  supports_calls = (capabilities->>'supportsCalls')::boolean,
  archive_capable = (capabilities->>'archiveCapable')::boolean,
  provider = NULLIF(capabilities->>'provider', ''),
  selection_weight = CASE WHEN (capabilities->>'selectionWeight') IS NOT NULL THEN ROUND((capabilities->>'selectionWeight')::double precision)::int END,
  static_max_log_range = CASE WHEN (capabilities->>'staticMaxLogRange') IS NOT NULL THEN ROUND((capabilities->>'staticMaxLogRange')::double precision)::int END,
  health_success_count = (capabilities->'health'->>'successCount')::int,
  health_failure_count = (capabilities->'health'->>'failureCount')::int,
  health_latency_ewma_ms = CASE WHEN (capabilities->'health'->>'latencyEwmaMs') IS NOT NULL THEN ROUND((capabilities->'health'->>'latencyEwmaMs')::double precision)::int END,
  health_cooldown_until = CASE WHEN (capabilities->'health'->>'cooldownUntil') IS NOT NULL THEN to_timestamp((capabilities->'health'->>'cooldownUntil')::double precision / 1000.0) END,
  health_last_success_at = CASE WHEN (capabilities->'health'->>'lastSuccessAt') IS NOT NULL THEN to_timestamp((capabilities->'health'->>'lastSuccessAt')::double precision / 1000.0) END,
  health_last_failure_at = CASE WHEN (capabilities->'health'->>'lastFailureAt') IS NOT NULL THEN to_timestamp((capabilities->'health'->>'lastFailureAt')::double precision / 1000.0) END,
  health_last_probe_at = CASE WHEN (capabilities->'health'->>'lastProbeAt') IS NOT NULL THEN to_timestamp((capabilities->'health'->>'lastProbeAt')::double precision / 1000.0) END,
  capabilities = capabilities - 'safeTag' - 'finalizedTag' - 'eip1898'
    - 'requireCanonical' - 'supportsLogs' - 'supportsCalls' - 'archiveCapable'
    - 'provider' - 'selectionWeight' - 'staticMaxLogRange' - 'health'
WHERE capabilities IS NOT NULL AND capabilities ? 'safeTag';

-- ===========================================================================
-- 7. Pre-existing one-to-one relation fix
-- ===========================================================================

CREATE UNIQUE INDEX "agent_memory_extraction_outbox_source_message_unique"
  ON "agent_memory_extraction_outbox" ("conversation_id", "source_message_id");

COMMIT;
