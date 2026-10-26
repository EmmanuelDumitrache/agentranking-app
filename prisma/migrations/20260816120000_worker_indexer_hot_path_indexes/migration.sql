-- This migration intentionally uses regular index DDL and explicitly wraps the
-- migration in a transaction. Prisma 7 does not add a PostgreSQL transaction
-- around migration.sql automatically. Apply it during the worker maintenance
-- window before starting the optimized queue consumers.
BEGIN;

-- Keep durable outbox claims on ordered partial indexes. These tables can grow
-- far beyond the live batch size, so ready-work discovery must not sort or scan
-- delivered history on every dispatcher wake-up.
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS evm_feedback_source_digest TEXT,
  ADD COLUMN IF NOT EXISTS solana_8004_feedback_source_digest TEXT;

ALTER TABLE evm_feedback_observations
  ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE evm_feedback_observations
  ALTER COLUMN materialized_at DROP DEFAULT;

ALTER TABLE evm_validation_observations
  ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE evm_validation_observations
  ALTER COLUMN materialized_at DROP DEFAULT;

-- Score materialization used to aggregate the complete Feedback history for
-- every dirty Agent. Keep the exact integer inputs incrementally instead, so a
-- score job is O(1) even when one agent has hundreds of thousands of rows.
CREATE TABLE IF NOT EXISTS agent_feedback_score_aggregates (
  agent_id INTEGER PRIMARY KEY REFERENCES "Agent"(id) ON DELETE CASCADE,
  exact_feedback_count BIGINT NOT NULL DEFAULT 0,
  quality_score_sum BIGINT NOT NULL DEFAULT 0,
  quality_score_count BIGINT NOT NULL DEFAULT 0,
  starred_quality_score_sum BIGINT NOT NULL DEFAULT 0,
  starred_quality_score_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION public.agentranking_feedback_display_score(
  target_feedback_index INTEGER,
  target_source_registry TEXT,
  target_value DOUBLE PRECISION
) RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN target_value IN (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    ) THEN 0::bigint
    ELSE GREATEST(0, LEAST(100, ROUND((CASE
      WHEN target_feedback_index IS NULL
        AND NULLIF(BTRIM(target_source_registry), '') IS NULL
        THEN target_value / 5 * 100
      ELSE target_value
    END)::numeric)))::bigint
  END
$function$;

-- Build the initial exact state once. Subsequent writes apply only their
-- statement-local deltas through transition tables.
INSERT INTO agent_feedback_score_aggregates (
  agent_id,
  exact_feedback_count,
  quality_score_sum,
  quality_score_count,
  starred_quality_score_sum,
  starred_quality_score_count,
  updated_at
)
SELECT
  "agentId",
  COUNT(*) FILTER (WHERE revoked = FALSE)::bigint,
  COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
    WHERE revoked = FALSE AND quality_eligible = TRUE
  ), 0)::bigint,
  COUNT(*) FILTER (WHERE revoked = FALSE AND quality_eligible = TRUE)::bigint,
  COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
    WHERE revoked = FALSE
      AND quality_eligible = TRUE
      AND LOWER(BTRIM(tag1)) = 'starred'
  ), 0)::bigint,
  COUNT(*) FILTER (
    WHERE revoked = FALSE
      AND quality_eligible = TRUE
      AND LOWER(BTRIM(tag1)) = 'starred'
  )::bigint,
  CURRENT_TIMESTAMP
FROM "Feedback"
GROUP BY "agentId"
ON CONFLICT (agent_id) DO UPDATE SET
  exact_feedback_count = EXCLUDED.exact_feedback_count,
  quality_score_sum = EXCLUDED.quality_score_sum,
  quality_score_count = EXCLUDED.quality_score_count,
  starred_quality_score_sum = EXCLUDED.starred_quality_score_sum,
  starred_quality_score_count = EXCLUDED.starred_quality_score_count,
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.agentranking_feedback_score_aggregate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  WITH deltas AS (
    SELECT
      "agentId" AS agent_id,
      COUNT(*) FILTER (WHERE revoked = FALSE)::bigint AS exact_delta,
      COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
        WHERE revoked = FALSE AND quality_eligible = TRUE
      ), 0)::bigint AS quality_sum_delta,
      COUNT(*) FILTER (WHERE revoked = FALSE AND quality_eligible = TRUE)::bigint AS quality_count_delta,
      COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
        WHERE revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
      ), 0)::bigint AS starred_sum_delta,
      COUNT(*) FILTER (
        WHERE revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
      )::bigint AS starred_count_delta
    FROM new_feedback_rows
    GROUP BY "agentId"
  ), changed AS (
    INSERT INTO agent_feedback_score_aggregates (
      agent_id,
      exact_feedback_count,
      quality_score_sum,
      quality_score_count,
      starred_quality_score_sum,
      starred_quality_score_count,
      updated_at
    )
    SELECT
      agent_id,
      exact_delta,
      quality_sum_delta,
      quality_count_delta,
      starred_sum_delta,
      starred_count_delta,
      CURRENT_TIMESTAMP
    FROM deltas
    WHERE exact_delta <> 0
       OR quality_count_delta <> 0
       OR starred_count_delta <> 0
    ON CONFLICT (agent_id) DO UPDATE SET
      exact_feedback_count = agent_feedback_score_aggregates.exact_feedback_count + EXCLUDED.exact_feedback_count,
      quality_score_sum = agent_feedback_score_aggregates.quality_score_sum + EXCLUDED.quality_score_sum,
      quality_score_count = agent_feedback_score_aggregates.quality_score_count + EXCLUDED.quality_score_count,
      starred_quality_score_sum = agent_feedback_score_aggregates.starred_quality_score_sum + EXCLUDED.starred_quality_score_sum,
      starred_quality_score_count = agent_feedback_score_aggregates.starred_quality_score_count + EXCLUDED.starred_quality_score_count,
      updated_at = EXCLUDED.updated_at
    RETURNING agent_id
  )
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM changed
  WHERE agent.id = changed.agent_id;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_feedback_score_aggregate_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  WITH deltas AS (
    SELECT
      "agentId" AS agent_id,
      -(COUNT(*) FILTER (WHERE revoked = FALSE)::bigint) AS exact_delta,
      -COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
        WHERE revoked = FALSE AND quality_eligible = TRUE
      ), 0)::bigint AS quality_sum_delta,
      -(COUNT(*) FILTER (WHERE revoked = FALSE AND quality_eligible = TRUE)::bigint) AS quality_count_delta,
      -COALESCE(SUM(agentranking_feedback_display_score("feedbackIndex", source_registry, value)) FILTER (
        WHERE revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
      ), 0)::bigint AS starred_sum_delta,
      -(COUNT(*) FILTER (
        WHERE revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
      )::bigint) AS starred_count_delta
    FROM old_feedback_rows
    -- Agent deletion cascades through Feedback and the aggregate table in the
    -- same statement. Do not recreate a negative aggregate for a parent that
    -- is already being removed.
    WHERE EXISTS (
      SELECT 1
      FROM "Agent" AS surviving_agent
      WHERE surviving_agent.id = old_feedback_rows."agentId"
    )
    GROUP BY "agentId"
  ), changed AS (
    INSERT INTO agent_feedback_score_aggregates (
      agent_id,
      exact_feedback_count,
      quality_score_sum,
      quality_score_count,
      starred_quality_score_sum,
      starred_quality_score_count,
      updated_at
    )
    SELECT
      agent_id,
      exact_delta,
      quality_sum_delta,
      quality_count_delta,
      starred_sum_delta,
      starred_count_delta,
      CURRENT_TIMESTAMP
    FROM deltas
    WHERE exact_delta <> 0
       OR quality_count_delta <> 0
       OR starred_count_delta <> 0
    ON CONFLICT (agent_id) DO UPDATE SET
      exact_feedback_count = agent_feedback_score_aggregates.exact_feedback_count + EXCLUDED.exact_feedback_count,
      quality_score_sum = agent_feedback_score_aggregates.quality_score_sum + EXCLUDED.quality_score_sum,
      quality_score_count = agent_feedback_score_aggregates.quality_score_count + EXCLUDED.quality_score_count,
      starred_quality_score_sum = agent_feedback_score_aggregates.starred_quality_score_sum + EXCLUDED.starred_quality_score_sum,
      starred_quality_score_count = agent_feedback_score_aggregates.starred_quality_score_count + EXCLUDED.starred_quality_score_count,
      updated_at = EXCLUDED.updated_at
    RETURNING agent_id
  )
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM changed
  WHERE agent.id = changed.agent_id;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_feedback_score_aggregate_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  WITH changes AS (
    SELECT
      "agentId" AS agent_id,
      CASE WHEN revoked = FALSE THEN 1::bigint ELSE 0::bigint END AS exact_delta,
      CASE WHEN revoked = FALSE AND quality_eligible = TRUE
        THEN agentranking_feedback_display_score("feedbackIndex", source_registry, value)
        ELSE 0::bigint
      END AS quality_sum_delta,
      CASE WHEN revoked = FALSE AND quality_eligible = TRUE THEN 1::bigint ELSE 0::bigint END AS quality_count_delta,
      CASE WHEN revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
        THEN agentranking_feedback_display_score("feedbackIndex", source_registry, value)
        ELSE 0::bigint
      END AS starred_sum_delta,
      CASE WHEN revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
        THEN 1::bigint ELSE 0::bigint
      END AS starred_count_delta
    FROM new_feedback_rows
    UNION ALL
    SELECT
      "agentId" AS agent_id,
      CASE WHEN revoked = FALSE THEN -1::bigint ELSE 0::bigint END AS exact_delta,
      CASE WHEN revoked = FALSE AND quality_eligible = TRUE
        THEN -agentranking_feedback_display_score("feedbackIndex", source_registry, value)
        ELSE 0::bigint
      END AS quality_sum_delta,
      CASE WHEN revoked = FALSE AND quality_eligible = TRUE THEN -1::bigint ELSE 0::bigint END AS quality_count_delta,
      CASE WHEN revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
        THEN -agentranking_feedback_display_score("feedbackIndex", source_registry, value)
        ELSE 0::bigint
      END AS starred_sum_delta,
      CASE WHEN revoked = FALSE
          AND quality_eligible = TRUE
          AND LOWER(BTRIM(tag1)) = 'starred'
        THEN -1::bigint ELSE 0::bigint
      END AS starred_count_delta
    FROM old_feedback_rows
  ), deltas AS (
    SELECT
      agent_id,
      SUM(exact_delta)::bigint AS exact_delta,
      SUM(quality_sum_delta)::bigint AS quality_sum_delta,
      SUM(quality_count_delta)::bigint AS quality_count_delta,
      SUM(starred_sum_delta)::bigint AS starred_sum_delta,
      SUM(starred_count_delta)::bigint AS starred_count_delta
    FROM changes
    GROUP BY agent_id
  ), changed AS (
    INSERT INTO agent_feedback_score_aggregates (
      agent_id,
      exact_feedback_count,
      quality_score_sum,
      quality_score_count,
      starred_quality_score_sum,
      starred_quality_score_count,
      updated_at
    )
    SELECT
      agent_id,
      exact_delta,
      quality_sum_delta,
      quality_count_delta,
      starred_sum_delta,
      starred_count_delta,
      CURRENT_TIMESTAMP
    FROM deltas
    WHERE exact_delta <> 0
       OR quality_sum_delta <> 0
       OR quality_count_delta <> 0
       OR starred_sum_delta <> 0
       OR starred_count_delta <> 0
    ON CONFLICT (agent_id) DO UPDATE SET
      exact_feedback_count = agent_feedback_score_aggregates.exact_feedback_count + EXCLUDED.exact_feedback_count,
      quality_score_sum = agent_feedback_score_aggregates.quality_score_sum + EXCLUDED.quality_score_sum,
      quality_score_count = agent_feedback_score_aggregates.quality_score_count + EXCLUDED.quality_score_count,
      starred_quality_score_sum = agent_feedback_score_aggregates.starred_quality_score_sum + EXCLUDED.starred_quality_score_sum,
      starred_quality_score_count = agent_feedback_score_aggregates.starred_quality_score_count + EXCLUDED.starred_quality_score_count,
      updated_at = EXCLUDED.updated_at
    RETURNING agent_id
  )
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM changed
  WHERE agent.id = changed.agent_id;
  RETURN NULL;
END
$function$;

-- Metadata and service materializers also write in large batches. Collapse all
-- rows for an Agent into one version bump and one score-outbox notification.
CREATE OR REPLACE FUNCTION public.agentranking_mark_inserted_related_agent_scores_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM (SELECT DISTINCT "agentId" AS agent_id FROM new_related_rows) AS affected
  WHERE agent.id = affected.agent_id;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_mark_deleted_related_agent_scores_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM (SELECT DISTINCT "agentId" AS agent_id FROM old_related_rows) AS affected
  WHERE agent.id = affected.agent_id;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_mark_updated_related_agent_scores_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "Agent" AS agent
  SET score_state_version = agent.score_state_version + 1
  FROM (
    SELECT "agentId" AS agent_id FROM new_related_rows
    UNION
    SELECT "agentId" AS agent_id FROM old_related_rows
  ) AS affected
  WHERE agent.id = affected.agent_id;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_inserted_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  agent_row RECORD;
BEGIN
  FOR agent_row IN
    SELECT DISTINCT agent."chainId", agent."agentId", agent.cluster_key
    FROM new_payload_rows AS related
    INNER JOIN "Agent" AS agent ON agent.id = related."agentId"
  LOOP
    PERFORM agentranking_queue_agent_payload_domains(
      agent_row."chainId",
      agent_row."agentId",
      agent_row.cluster_key
    );
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_deleted_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  agent_row RECORD;
BEGIN
  FOR agent_row IN
    SELECT DISTINCT agent."chainId", agent."agentId", agent.cluster_key
    FROM old_payload_rows AS related
    INNER JOIN "Agent" AS agent ON agent.id = related."agentId"
  LOOP
    PERFORM agentranking_queue_agent_payload_domains(
      agent_row."chainId",
      agent_row."agentId",
      agent_row.cluster_key
    );
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_updated_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  agent_row RECORD;
BEGIN
  FOR agent_row IN
    SELECT agent."chainId", agent."agentId", agent.cluster_key
    FROM (
      SELECT "agentId" AS agent_id FROM new_payload_rows
      UNION
      SELECT "agentId" AS agent_id FROM old_payload_rows
    ) AS related
    INNER JOIN "Agent" AS agent ON agent.id = related.agent_id
  LOOP
    PERFORM agentranking_queue_agent_payload_domains(
      agent_row."chainId",
      agent_row."agentId",
      agent_row.cluster_key
    );
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_rank_history()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM agentranking_queue_cache_domain('agent:rank-history');
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS "Feedback_score_dirty" ON "Feedback";
DROP TRIGGER IF EXISTS agent_score_stale_on_feedback_change ON "Feedback";
DROP TRIGGER IF EXISTS "AgentMetadata_score_dirty" ON "AgentMetadata";
DROP TRIGGER IF EXISTS agent_score_stale_on_metadata_change ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentService_score_dirty" ON "AgentService";
DROP TRIGGER IF EXISTS agent_score_stale_on_service_change ON "AgentService";
DROP TRIGGER IF EXISTS agent_score_stale_on_source_change ON "Agent";

-- This BEFORE trigger runs for every Agent UPDATE. Compare typed columns
-- directly so unchanged score materializations do not allocate and compare two
-- large JSONB objects merely to discover that no source input changed.
CREATE OR REPLACE FUNCTION public.agentranking_mark_agent_score_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.image IS DISTINCT FROM NEW.image
     OR OLD."x402Support" IS DISTINCT FROM NEW."x402Support"
     OR OLD."binanceCompatible" IS DISTINCT FROM NEW."binanceCompatible"
     OR OLD.stars IS DISTINCT FROM NEW.stars
     OR OLD."lastActiveAt" IS DISTINCT FROM NEW."lastActiveAt"
     OR OLD.activity_observed_at IS DISTINCT FROM NEW.activity_observed_at
     OR OLD.wallet_hydration_status IS DISTINCT FROM NEW.wallet_hydration_status
     OR OLD.source_quality_score IS DISTINCT FROM NEW.source_quality_score
     OR OLD.source_feedback_count IS DISTINCT FROM NEW.source_feedback_count
     OR OLD.sap_last_synced_at IS DISTINCT FROM NEW.sap_last_synced_at
     OR OLD."isVerified" IS DISTINCT FROM NEW."isVerified"
     OR OLD."isPremiumVerified" IS DISTINCT FROM NEW."isPremiumVerified"
     OR OLD.sap_verified IS DISTINCT FROM NEW.sap_verified
     OR OLD.sap_protocols IS DISTINCT FROM NEW.sap_protocols
     OR OLD.sap_stats IS DISTINCT FROM NEW.sap_stats
     OR OLD."hasDuplicateName" IS DISTINCT FROM NEW."hasDuplicateName"
     OR OLD."voteFireCount" IS DISTINCT FROM NEW."voteFireCount"
     OR OLD."votePooCount" IS DISTINCT FROM NEW."votePooCount"
     OR OLD."isVerifiedRevenue" IS DISTINCT FROM NEW."isVerifiedRevenue"
     OR OLD."verifiedWallet" IS DISTINCT FROM NEW."verifiedWallet"
     OR OLD."perfWinRate" IS DISTINCT FROM NEW."perfWinRate"
     OR OLD."perfMonthlyPnlUsd" IS DISTINCT FROM NEW."perfMonthlyPnlUsd"
     OR OLD."perfBurnToEarnRatio" IS DISTINCT FROM NEW."perfBurnToEarnRatio"
     OR OLD."perfTxCount" IS DISTINCT FROM NEW."perfTxCount"
     OR OLD."activeWinRate30d" IS DISTINCT FROM NEW."activeWinRate30d"
     OR OLD."nativeVolume30d" IS DISTINCT FROM NEW."nativeVolume30d"
  THEN
    NEW.score_state_version := GREATEST(
      NEW.score_state_version,
      OLD.score_state_version + 1
    );
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS "Feedback_payload_cache_domains" ON "Feedback";
DROP TRIGGER IF EXISTS "AgentMetadata_payload_cache_domains" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentService_payload_cache_domains" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentRankSnapshot_payload_cache_domains" ON "AgentRankSnapshot";
-- A previous non-transactional attempt of this migration can have installed
-- these replacement triggers before failing on a later index build. Make the
-- migration retryable after `prisma migrate resolve --rolled-back`.
DROP TRIGGER IF EXISTS "Feedback_score_aggregate_insert" ON "Feedback";
DROP TRIGGER IF EXISTS "Feedback_score_aggregate_delete" ON "Feedback";
DROP TRIGGER IF EXISTS "Feedback_score_aggregate_update" ON "Feedback";
DROP TRIGGER IF EXISTS "AgentMetadata_score_dirty_insert" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentMetadata_score_dirty_delete" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentMetadata_score_dirty_update" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentService_score_dirty_insert" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentService_score_dirty_delete" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentService_score_dirty_update" ON "AgentService";
DROP TRIGGER IF EXISTS "Feedback_payload_cache_domains_insert" ON "Feedback";
DROP TRIGGER IF EXISTS "Feedback_payload_cache_domains_delete" ON "Feedback";
DROP TRIGGER IF EXISTS "Feedback_payload_cache_domains_update" ON "Feedback";
DROP TRIGGER IF EXISTS "AgentMetadata_payload_cache_domains_insert" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentMetadata_payload_cache_domains_delete" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentMetadata_payload_cache_domains_update" ON "AgentMetadata";
DROP TRIGGER IF EXISTS "AgentService_payload_cache_domains_insert" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentService_payload_cache_domains_delete" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentService_payload_cache_domains_update" ON "AgentService";
DROP TRIGGER IF EXISTS "AgentRankSnapshot_rank_history_cache_domain" ON "AgentRankSnapshot";

CREATE TRIGGER "Feedback_score_aggregate_insert"
AFTER INSERT ON "Feedback"
REFERENCING NEW TABLE AS new_feedback_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_feedback_score_aggregate_insert();

CREATE TRIGGER "Feedback_score_aggregate_delete"
AFTER DELETE ON "Feedback"
REFERENCING OLD TABLE AS old_feedback_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_feedback_score_aggregate_delete();

CREATE TRIGGER "Feedback_score_aggregate_update"
AFTER UPDATE ON "Feedback"
REFERENCING OLD TABLE AS old_feedback_rows NEW TABLE AS new_feedback_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_feedback_score_aggregate_update();

CREATE TRIGGER "AgentMetadata_score_dirty_insert"
AFTER INSERT ON "AgentMetadata"
REFERENCING NEW TABLE AS new_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_inserted_related_agent_scores_dirty();

CREATE TRIGGER "AgentMetadata_score_dirty_delete"
AFTER DELETE ON "AgentMetadata"
REFERENCING OLD TABLE AS old_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_deleted_related_agent_scores_dirty();

CREATE TRIGGER "AgentMetadata_score_dirty_update"
AFTER UPDATE ON "AgentMetadata"
REFERENCING OLD TABLE AS old_related_rows NEW TABLE AS new_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_updated_related_agent_scores_dirty();

CREATE TRIGGER "AgentService_score_dirty_insert"
AFTER INSERT ON "AgentService"
REFERENCING NEW TABLE AS new_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_inserted_related_agent_scores_dirty();

CREATE TRIGGER "AgentService_score_dirty_delete"
AFTER DELETE ON "AgentService"
REFERENCING OLD TABLE AS old_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_deleted_related_agent_scores_dirty();

CREATE TRIGGER "AgentService_score_dirty_update"
AFTER UPDATE ON "AgentService"
REFERENCING OLD TABLE AS old_related_rows NEW TABLE AS new_related_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_mark_updated_related_agent_scores_dirty();

CREATE TRIGGER "Feedback_payload_cache_domains_insert"
AFTER INSERT ON "Feedback"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_inserted_agent_payloads();

CREATE TRIGGER "Feedback_payload_cache_domains_delete"
AFTER DELETE ON "Feedback"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_deleted_agent_payloads();

CREATE TRIGGER "Feedback_payload_cache_domains_update"
AFTER UPDATE ON "Feedback"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentMetadata_payload_cache_domains_insert"
AFTER INSERT ON "AgentMetadata"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_inserted_agent_payloads();

CREATE TRIGGER "AgentMetadata_payload_cache_domains_delete"
AFTER DELETE ON "AgentMetadata"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_deleted_agent_payloads();

CREATE TRIGGER "AgentMetadata_payload_cache_domains_update"
AFTER UPDATE ON "AgentMetadata"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentService_payload_cache_domains_insert"
AFTER INSERT ON "AgentService"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_inserted_agent_payloads();

CREATE TRIGGER "AgentService_payload_cache_domains_delete"
AFTER DELETE ON "AgentService"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_deleted_agent_payloads();

CREATE TRIGGER "AgentService_payload_cache_domains_update"
AFTER UPDATE ON "AgentService"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentRankSnapshot_rank_history_cache_domain"
AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON "AgentRankSnapshot"
FOR EACH STATEMENT
EXECUTE FUNCTION public.agentranking_invalidate_rank_history();

CREATE INDEX IF NOT EXISTS agent_memory_extraction_outbox_ready_idx
  ON agent_memory_extraction_outbox (available_at, created_at)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_memory_extraction_outbox_claim_token_idx
  ON agent_memory_extraction_outbox (claim_token)
  WHERE delivered_at IS NULL AND claim_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_memory_extraction_outbox_delivered_cleanup_idx
  ON agent_memory_extraction_outbox (delivered_at, run_id)
  WHERE delivered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS indexer_outbox_ready_source_idx
  ON indexer_outbox (queue_name, source_key, available_at, created_at)
  WHERE dispatched_at IS NULL;

CREATE INDEX IF NOT EXISTS indexer_outbox_dispatched_cleanup_idx
  ON indexer_outbox (dispatched_at, id)
  WHERE dispatched_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS indexer_idempotency_records_completed_cleanup_idx
  ON indexer_idempotency_records (completed_at, business_key);

-- Meaningful-progress timestamps change on every durable checkpoint. The old
-- all-state index made those updates rewrite a B-tree entry even though only
-- terminal leases are ever searched by progress age during retention cleanup.
CREATE INDEX IF NOT EXISTS indexer_job_leases_terminal_cleanup_idx
  ON indexer_job_leases (state, last_meaningful_progress_at, business_key)
  WHERE state IN ('failed', 'expired', 'cancelled');

CREATE INDEX IF NOT EXISTS indexer_range_leases_completed_cleanup_idx
  ON indexer_range_leases (completed_at, id)
  WHERE status = 'COMPLETE';

CREATE INDEX IF NOT EXISTS indexer_range_leases_invalidated_cleanup_idx
  ON indexer_range_leases (updated_at, id)
  WHERE status = 'INVALIDATED';

CREATE INDEX IF NOT EXISTS indexer_bootstrap_epochs_completed_cleanup_idx
  ON indexer_bootstrap_epochs (completed_at, id)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS indexer_bootstrap_epochs_latest_idx
  ON indexer_bootstrap_epochs (started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS cache_invalidation_outbox_ready_idx
  ON cache_invalidation_outbox (id)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS cache_invalidation_outbox_ready_nonscore_idx
  ON cache_invalidation_outbox (id)
  WHERE delivered_at IS NULL
    AND domain NOT LIKE 'derived:agent-score:%';

CREATE INDEX IF NOT EXISTS cache_invalidation_outbox_ready_score_idx
  ON cache_invalidation_outbox (id)
  WHERE delivered_at IS NULL
    AND domain LIKE 'derived:agent-score:%';

CREATE INDEX IF NOT EXISTS cache_invalidation_outbox_delivered_cleanup_idx
  ON cache_invalidation_outbox (delivered_at, id)
  WHERE delivered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS "UserProfile_subscription_expiry_scan_idx"
  ON "UserProfile" ("subscriptionStatus", "subscriptionExpiresAt", id);

CREATE INDEX IF NOT EXISTS "MeshSubscription_fanout_scan_idx"
  ON "MeshSubscription" ("publisherAgentId", id)
  WHERE "isActive" = TRUE
    AND "webhookEndpoint" <> '';

CREATE INDEX IF NOT EXISTS "AgentAlertRule_active_agent_idx"
  ON "AgentAlertRule" ("agentId", id)
  WHERE "isActive" = TRUE;

CREATE INDEX IF NOT EXISTS "AgentAlertRule_active_global_profile_idx"
  ON "AgentAlertRule" ("userProfileId", id)
  WHERE "isActive" = TRUE AND "agentId" IS NULL;

CREATE INDEX IF NOT EXISTS "UserProfile_wallet_address_lower_idx"
  ON "UserProfile" (LOWER("walletAddress"))
  WHERE "walletAddress" IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_launch_fee_scan_idx
  ON agent_launches (network, id)
  WHERE "feeSharingStatus" = 'active'
    AND "launchStatus" = 'indexed'
    AND mint IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_schedules_due_scan_idx
  ON agent_schedules (next_run_at, id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS "ArStakePosition_pool_status_idx"
  ON "ArStakePosition" ("poolAddress", status);

CREATE INDEX IF NOT EXISTS partner_jobs_stale_scan_idx
  ON partner_jobs (source, ingestion_mode, last_seen_at)
  WHERE status IN ('open', 'paused')
    AND is_sample = FALSE;

CREATE INDEX IF NOT EXISTS order_post_activations_stale_claim_idx
  ON order_post_activations (updated_at, order_id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS notification_deliveries_stale_claim_idx
  ON notification_deliveries (updated_at, id)
  WHERE status = 'delivering';

CREATE INDEX IF NOT EXISTS mesh_signal_deliveries_stale_claim_idx
  ON mesh_signal_deliveries (updated_at, id)
  WHERE status = 'delivering';

CREATE INDEX IF NOT EXISTS agent_alert_deliveries_stale_claim_idx
  ON agent_alert_deliveries (updated_at, id)
  WHERE status = 'delivering';

CREATE INDEX IF NOT EXISTS webhook_receipts_github_stale_claim_idx
  ON webhook_receipts (processing_at, id)
  WHERE provider = 'github' AND status = 'processing';

-- Startup recovery walks durable unfinished work in primary-key order. Keep
-- historical terminal rows out of those scans and avoid sorting a large
-- status-filtered result on every worker restart.
CREATE INDEX IF NOT EXISTS "Bounty_deferred_recovery_ready_idx"
  ON "Bounty" (id)
  WHERE status = 'claimed' AND "autoReleaseAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_credit_deposits_recovery_ready_idx
  ON llm_credit_deposits (id)
  WHERE status IN ('CREATED', 'AWAITING_PAYMENT');

CREATE INDEX IF NOT EXISTS "Order_deferred_recovery_ready_idx"
  ON "Order" (id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agent_chat_run_attempts_recovery_ready_idx
  ON agent_chat_run_attempts (id)
  WHERE provider = 'openrouter'
    AND status = 'SUCCEEDED'
    AND reconciliation_status IN ('PENDING', 'RETRYING');

CREATE INDEX IF NOT EXISTS order_post_activations_recovery_ready_idx
  ON order_post_activations (order_id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS notification_deliveries_recovery_ready_idx
  ON notification_deliveries (id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS mesh_signal_deliveries_recovery_ready_idx
  ON mesh_signal_deliveries (id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS agent_alert_deliveries_recovery_ready_idx
  ON agent_alert_deliveries (id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS agent_launch_fee_attempts_recovery_ready_idx
  ON agent_launch_fee_distribution_attempts (id)
  WHERE status IN ('prepared', 'submitted');

CREATE INDEX IF NOT EXISTS "Agent_hot_activity_scan_idx"
  ON "Agent" ("isVerifiedRevenue" DESC, "powerScore" DESC)
  WHERE "isActive" = TRUE AND "verifiedWallet" <> '';

CREATE INDEX IF NOT EXISTS "Agent_chain_id_agent_id_desc_idx"
  ON "Agent" ("chainId", "agentId" DESC);

CREATE INDEX IF NOT EXISTS "Agent_perf_snapshot_scan_idx"
  ON "Agent" ("perfLastComputedAt" ASC NULLS FIRST, id)
  INCLUDE ("verifiedRevenueExpiresAt")
  WHERE "isVerifiedRevenue" = TRUE AND "verifiedWallet" <> '';

CREATE INDEX IF NOT EXISTS "AgentService_endpoint_health_scan_idx"
  ON "AgentService" (id)
  INCLUDE ("agentId")
  WHERE BTRIM(endpoint) <> '';

CREATE INDEX IF NOT EXISTS "Agent_verified_revenue_expiry_idx"
  ON "Agent" ("verifiedRevenueExpiresAt", id)
  WHERE "isVerifiedRevenue" = TRUE
    AND "verifiedRevenueExpiresAt" IS NOT NULL;

-- The mutable-registration scanner walks in primary-key order. Keep its
-- dynamic due timestamps in a narrow covering index so a mostly-not-due
-- 100k-agent directory does not require repeated heap visits every 15 minutes.
CREATE INDEX IF NOT EXISTS "Agent_registration_refresh_scan_idx"
  ON "Agent" (id)
  INCLUDE (registration_next_retry_at, registration_last_success_at)
  WHERE registration_normalized_uri LIKE 'https://%'
    AND source_active = TRUE
    AND registration_status IS DISTINCT FROM 'permanent_invalid'
    AND ("chainId" <> 900001 OR solana_asset_address IS NOT NULL);

CREATE INDEX IF NOT EXISTS "Agent_stale_deactivation_idx"
  ON "Agent" ("lastActiveAt", id)
  WHERE "isActive" = TRUE
    AND "isPremiumVerified" = FALSE
    AND "isVerified" = FALSE;

CREATE INDEX IF NOT EXISTS "AgentRankSnapshot_retention_idx"
  ON "AgentRankSnapshot" ("capturedAt", id);

CREATE INDEX IF NOT EXISTS "Agent_score_recalculation_pending_idx"
  ON "Agent" (id)
  WHERE score_state_version > score_materialized_version;

CREATE INDEX IF NOT EXISTS evm_feedback_finalized_materialization_idx
  ON evm_feedback_observations (
    chain_id,
    registry_address,
    protocol_agent_id,
    block_number,
    transaction_index,
    log_index
  )
  WHERE status = 'finalized'
    AND event_type IN ('NewFeedback', 'FeedbackRevoked');

-- Incremental projection begins from the small unmaterialized frontier and
-- needs the canonical feedback identity without scanning historical events.
CREATE INDEX IF NOT EXISTS evm_feedback_pending_projection_idx
  ON evm_feedback_observations (
    chain_id,
    registry_address,
    protocol_agent_id,
    client_address,
    feedback_index
  )
  INCLUDE (event_type)
  WHERE materialized_at IS NULL;

CREATE INDEX IF NOT EXISTS evm_feedback_finalized_reorg_idx
  ON evm_feedback_observations (
    chain_id,
    registry_address,
    block_number,
    protocol_agent_id
  )
  WHERE status = 'finalized';

CREATE INDEX IF NOT EXISTS evm_event_block_time_lookup_idx
  ON evm_event_observations (chain_id, block_hash)
  INCLUDE (block_time)
  WHERE block_time IS NOT NULL;

-- Replace any definition left behind by the original non-transactional run.
-- IF NOT EXISTS alone would preserve the old wide INCLUDE payload on retry.
DROP INDEX IF EXISTS evm_identity_observations_latest_state_idx;
CREATE INDEX IF NOT EXISTS evm_identity_observations_latest_state_idx
  ON evm_identity_observations (
    chain_id,
    registry_address,
    protocol_agent_id,
    block_number DESC,
    transaction_index DESC,
    last_log_index DESC
  )
  -- agent_uri is deliberately allowed to approach 8 KiB. Keeping it as a
  -- B-tree payload can exceed PostgreSQL's per-index-tuple size while the
  -- ordering keys themselves remain narrow. Heap-fetch that one value instead.
  INCLUDE (registered_owner, current_owner, current_agent_wallet)
  WHERE status = 'finalized';

CREATE INDEX IF NOT EXISTS "Feedback_agent_source_registry_revoked_idx"
  ON "Feedback" ("agentId", source_registry, revoked);

CREATE INDEX IF NOT EXISTS evm_validation_finalized_response_idx
  ON evm_validation_observations (
    chain_id,
    registry_address,
    protocol_agent_id,
    block_number DESC,
    transaction_index DESC,
    log_index DESC
  )
  WHERE status = 'finalized'
    AND event_type = 'ValidationResponse'
    AND has_response = TRUE;

-- Validation ingestion verifies registry-global request hashes and the current
-- projection resolves the first request URI for each response. Keep both paths
-- on the much smaller finalized-request subset and cover their selected fields.
CREATE INDEX IF NOT EXISTS evm_validation_finalized_request_hash_idx
  ON evm_validation_observations (
    chain_id,
    registry_address,
    request_hash,
    block_number,
    transaction_index,
    log_index
  )
  INCLUDE (event_key, request_uri)
  WHERE status = 'finalized'
    AND event_type = 'ValidationRequest';

CREATE INDEX IF NOT EXISTS evm_validation_pending_projection_idx
  ON evm_validation_observations (
    chain_id,
    registry_address,
    protocol_agent_id
  )
  WHERE materialized_at IS NULL;

CREATE INDEX IF NOT EXISTS evm_validation_finalized_reorg_idx
  ON evm_validation_observations (
    chain_id,
    registry_address,
    block_number,
    protocol_agent_id
  )
  WHERE status = 'finalized';

-- Full cluster reconciliation streams only verified deployment coordinates in
-- primary-key order. Cover the scan without sorting or visiting unverified
-- verification history.
CREATE INDEX IF NOT EXISTS agent_chain_verification_verified_scan_idx
  ON "AgentChainVerification" (id)
  INCLUDE ("chainId", "agentId")
  WHERE verified = TRUE;

CREATE INDEX IF NOT EXISTS solana_8004_trust_signatures_status_slot_signature_idx
ON solana_8004_trust_signatures (status, slot, signature);

-- The trust scanner repeatedly drains the oldest retryable signatures across
-- two statuses. A status-leading index can require merging/sorting both ranges;
-- this partial index exposes the requested slot order directly at deep backlog.
CREATE INDEX IF NOT EXISTS solana_8004_trust_signatures_pending_slot_signature_idx
ON solana_8004_trust_signatures (slot, signature)
WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS solana_registry_snapshots_source_status_generation_idx
  ON solana_registry_snapshots (source, status, generation DESC);

CREATE INDEX IF NOT EXISTS solana_8004_trust_observations_unlinked_asset_idx
  ON solana_8004_trust_observations (asset_address)
  WHERE agent_db_id IS NULL;

CREATE INDEX IF NOT EXISTS solana_8004_trust_observations_finalized_asset_kind_slot_idx
  ON solana_8004_trust_observations (asset_address, kind, slot, event_ordinal)
  WHERE status = 'FINALIZED';

CREATE INDEX IF NOT EXISTS agent_metadata_registration_fingerprint_idx
  ON "AgentMetadata" (value, "agentId")
  WHERE key = 'registrationFingerprint';

CREATE INDEX IF NOT EXISTS agent_metadata_metaplex_sync_fingerprint_idx
  ON "AgentMetadata" ("agentId", id)
  INCLUDE (value)
  WHERE key = 'syncFingerprint:metaplex'
    AND source_kind = 'metaplex-registration';

CREATE INDEX IF NOT EXISTS agent_metadata_hatcher_id_value_idx
  ON "AgentMetadata" (value, "agentId")
  WHERE key = 'hatcher_id';

CREATE INDEX IF NOT EXISTS agent_metadata_covenant_verification_due_idx
  ON "AgentMetadata" ("agentId", value)
  WHERE key = 'covenant_verification_checked_at';

CREATE INDEX IF NOT EXISTS agent_metadata_covenant_detected_agent_idx
  ON "AgentMetadata" ("agentId")
  WHERE key = 'covenant_detected_at';

CREATE INDEX IF NOT EXISTS "Agent_covenant_sap_protocols_idx"
  ON "Agent" USING GIN (sap_protocols)
  WHERE "isActive" = TRUE
    AND sap_verified = TRUE
    AND sap_agent_pda IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Agent_covenant_verification_cursor_idx"
  ON "Agent" (id)
  WHERE "isActive" = TRUE
    AND sap_verified = TRUE
    AND sap_agent_pda IS NOT NULL;

CREATE INDEX IF NOT EXISTS registration_document_normalized_latest_idx
  ON registration_document_observations (normalized_uri, fetched_at DESC);

-- source_uri preserves the original registration URI and may be an inline
-- data: URI, which can be tens of KiB. A B-tree cannot safely index that
-- value; PostgreSQL hash indexes retain exact-equality lookup semantics while
-- storing only a fixed-size hash. The small set of matching versions can be
-- sorted by fetched_at after lookup.
DROP INDEX IF EXISTS registration_document_source_latest_idx;
CREATE INDEX IF NOT EXISTS registration_document_source_latest_idx
  ON registration_document_observations USING HASH (source_uri);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS agent_metadata_registrations_trgm_idx
  ON "AgentMetadata" USING GIN (value gin_trgm_ops)
  WHERE key = 'registrations';

-- Replace any definition left behind by the original non-transactional run.
DROP INDEX IF EXISTS agent_owner_uri_cluster_idx;
CREATE INDEX IF NOT EXISTS agent_owner_uri_cluster_idx
  -- agentURI is bounded at 8 KiB by the indexer, which is larger than a B-tree
  -- index tuple can safely store. Index a fixed-width digest for candidate
  -- lookup; the query rechecks the full URI so digest collisions cannot merge
  -- unrelated deployments.
  ON "Agent" (LOWER(owner), md5("agentURI"))
  WHERE "chainId" <> 900001 AND owner <> '' AND "agentURI" <> '';

-- Slot lookup is always by the (resource_key, slot) primary key. Keeping an
-- index on the rapidly changing expiry timestamp prevents HOT updates for every
-- claim, heartbeat, and release.
DROP INDEX IF EXISTS worker_resource_leases_lease_until_idx;

-- These rows are addressed exclusively by resource_key and are mutated on
-- every acquisition/result. Indexing their mutable timestamps and cooldowns
-- turns each state transition into several extra B-tree writes and prevents
-- PostgreSQL from applying heap-only tuple updates.
DROP INDEX IF EXISTS worker_resource_rate_budgets_updated_at_idx;
DROP INDEX IF EXISTS worker_resource_states_updated_at_idx;
DROP INDEX IF EXISTS worker_resource_states_rate_limited_until_idx;
DROP INDEX IF EXISTS worker_resource_states_cooling_until_idx;
DROP INDEX IF EXISTS cache_invalidation_outbox_delivered_at_id_idx;
DROP INDEX IF EXISTS solana_8004_trust_signatures_status_slot_idx;
DROP INDEX IF EXISTS solana_registry_memberships_source_current_generation_idx;
DROP INDEX IF EXISTS solana_registry_snapshots_source_status_idx;
DROP INDEX IF EXISTS agent_memory_extraction_outbox_delivered_at_available_at_idx;
DROP INDEX IF EXISTS agent_memory_extraction_outbox_claimed_at_idx;
DROP INDEX IF EXISTS indexer_outbox_queue_dispatch_idx;
DROP INDEX IF EXISTS indexer_outbox_source_dispatch_idx;
DROP INDEX IF EXISTS indexer_idempotency_records_stage_completed_at_idx;
DROP INDEX IF EXISTS indexer_job_leases_state_progress_idx;
DROP INDEX IF EXISTS indexer_range_leases_lease_until_idx;
DROP INDEX IF EXISTS indexer_range_leases_source_key_requested_generation_status_idx;
DROP INDEX IF EXISTS indexer_range_leases_chain_id_domain_status_idx;
DROP INDEX IF EXISTS "Feedback_agentId_idx";
DROP INDEX IF EXISTS "UserProfile_subscriptionStatus_idx";
DROP INDEX IF EXISTS "MeshSubscription_publisherAgentId_idx";
DROP INDEX IF EXISTS agent_launches_network_idx;
DROP INDEX IF EXISTS "ArStakePosition_poolAddress_idx";
DROP INDEX IF EXISTS partner_jobs_source_status_last_seen_at_idx;
DROP INDEX IF EXISTS "Agent_chainId_idx";
DROP INDEX IF EXISTS "AgentChainVerification_verified_idx";

-- Stable Solana 8004 inventories previously loaded every membership's JSONB
-- evidence into Node and compared it field by field. Persist an exact compact
-- key over the account-byte digest and the Core fields retained by the
-- projection, allowing the 100k-row comparison to stay scalar. Length prefixes
-- preserve exact equality without relying on a collision-prone hash.
ALTER TABLE solana_registry_memberships
  ADD COLUMN IF NOT EXISTS source_evidence_key TEXT;

UPDATE solana_registry_memberships
SET source_evidence_key =
  CASE
    WHEN jsonb_typeof(raw_data -> 'protocolImplementation') = 'string'
      THEN octet_length(raw_data ->> 'protocolImplementation')::text || ':' || (raw_data ->> 'protocolImplementation')
    ELSE '-:'
  END ||
  CASE
    WHEN jsonb_typeof(raw_data -> 'evidenceDigest') = 'string'
      THEN octet_length(raw_data ->> 'evidenceDigest')::text || ':' || (raw_data ->> 'evidenceDigest')
    ELSE '-:'
  END ||
  CASE
    WHEN jsonb_typeof(raw_data -> 'coreOwner') = 'string'
      THEN octet_length(raw_data ->> 'coreOwner')::text || ':' || (raw_data ->> 'coreOwner')
    ELSE '-:'
  END ||
  CASE
    WHEN jsonb_typeof(raw_data -> 'coreUri') = 'string'
      THEN octet_length(raw_data ->> 'coreUri')::text || ':' || (raw_data ->> 'coreUri')
    ELSE '-:'
  END ||
  CASE
    WHEN jsonb_typeof(raw_data -> 'coreUpdateAuthority') = 'string'
      THEN octet_length(raw_data ->> 'coreUpdateAuthority')::text || ':' || (raw_data ->> 'coreUpdateAuthority')
    ELSE '-:'
  END
WHERE source = 'solana-8004'
  AND source_evidence_key IS NULL
  AND raw_data IS NOT NULL;

-- Bulk Agent maintenance (expiry, lifecycle, rank, and cluster work) must not
-- invoke the payload invalidator once per row. Transition-table triggers retain
-- all per-Agent domains while executing the revision/outbox writes set-wise and
-- collapsing a shared cluster domain to one invalidation per statement.
DROP TRIGGER IF EXISTS "Agent_payload_cache_domains" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_payload_cache_domains_insert" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_payload_cache_domains_delete" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_payload_cache_domains_update" ON "Agent";

CREATE OR REPLACE FUNCTION agentranking_queue_agent_payload_domains_inserted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  queued_count integer;
BEGIN
  WITH domains AS MATERIALIZED (
    SELECT DISTINCT candidate.domain
    FROM new_agent_payload_rows AS agent
    CROSS JOIN LATERAL (VALUES
      ('agent:payload:' || agent."chainId"::text || ':' || agent."agentId"::text),
      (CASE
        WHEN agent.cluster_key IS NOT NULL AND trim(agent.cluster_key) <> ''
          THEN 'agent:cluster:key:' || agent.cluster_key
        ELSE NULL
      END)
    ) AS candidate(domain)
    WHERE candidate.domain IS NOT NULL
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  )
  INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
  SELECT domain, revision, now()
  FROM revisions
  ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
    SET revision = EXCLUDED.revision,
        created_at = EXCLUDED.created_at;
  GET DIAGNOSTICS queued_count = ROW_COUNT;
  IF queued_count > 0 THEN
    PERFORM pg_notify('cache_invalidation', 'bulk');
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_queue_agent_payload_domains_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  queued_count integer;
BEGIN
  WITH domains AS MATERIALIZED (
    SELECT DISTINCT candidate.domain
    FROM old_agent_payload_rows AS agent
    CROSS JOIN LATERAL (VALUES
      ('agent:payload:' || agent."chainId"::text || ':' || agent."agentId"::text),
      (CASE
        WHEN agent.cluster_key IS NOT NULL AND trim(agent.cluster_key) <> ''
          THEN 'agent:cluster:key:' || agent.cluster_key
        ELSE NULL
      END)
    ) AS candidate(domain)
    WHERE candidate.domain IS NOT NULL
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  )
  INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
  SELECT domain, revision, now()
  FROM revisions
  ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
    SET revision = EXCLUDED.revision,
        created_at = EXCLUDED.created_at;
  GET DIAGNOSTICS queued_count = ROW_COUNT;
  IF queued_count > 0 THEN
    PERFORM pg_notify('cache_invalidation', 'bulk');
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_queue_agent_payload_domains_updated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  queued_count integer;
BEGIN
  -- Feedback/metadata/service statement triggers already queue the related
  -- payload domains before issuing their nested score-version UPDATE.
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  WITH changed AS MATERIALIZED (
    SELECT
      old_agent."chainId" AS old_chain_id,
      old_agent."agentId" AS old_agent_id,
      old_agent.cluster_key AS old_cluster_key,
      new_agent."chainId" AS new_chain_id,
      new_agent."agentId" AS new_agent_id,
      new_agent.cluster_key AS new_cluster_key
    FROM old_agent_payload_rows AS old_agent
    INNER JOIN new_agent_payload_rows AS new_agent USING (id)
    -- Compare the retained columns in their native types. Building and
    -- subtracting two full JSONB Agent objects for every row made otherwise
    -- cheap 100k-row rank/maintenance updates CPU-bound inside PostgreSQL.
    WHERE ROW(
      old_agent.id, old_agent."agentId", old_agent."chainId",
      old_agent.name, old_agent.description, old_agent.image, old_agent."agentURI", old_agent.owner,
      old_agent."isActive", old_agent."isVerified", old_agent.score, old_agent."hotScore",
      old_agent."x402Support", old_agent.stars, old_agent."totalFeedback", old_agent."totalMessages",
      old_agent."totalChats", old_agent."totalWatches", old_agent."scoreQuality", old_agent."scorePopularity",
      old_agent."scoreActivity", old_agent."scoreWallet", old_agent."scoreFreshness", old_agent."scoreMetadata",
      old_agent."supportedTrust", old_agent."createdAt", old_agent."lastActiveAt", old_agent."scoreServices",
      old_agent."isCustomListed", old_agent."isPremiumVerified", old_agent."binanceCompatible",
      old_agent."hasDuplicateName", old_agent."powerScore", old_agent."activeBoosts",
      old_agent."voteFireCount", old_agent."votePooCount", old_agent."tokenAddress", old_agent."listedAt",
      old_agent.archetype, old_agent."archetypeAuto", old_agent."adminPowerAdjust", old_agent."verifiedWallet",
      old_agent."verifiedWalletAt", old_agent."verifiedWalletChainId", old_agent."perfWinRate",
      old_agent."perfAvgPnlPercent", old_agent."perfBurnToEarnRatio", old_agent."perfTotalVolumeUsd",
      old_agent."perfMonthlyPnlUsd", old_agent."perfLastComputedAt", old_agent."isVerifiedRevenue",
      old_agent."verifiedRevenueAt", old_agent."perfTxCount", old_agent."perfProfitableTxCount",
      old_agent."recentActivity", old_agent."activityUpdatedAt", old_agent."activeWinRate30d",
      old_agent."nativeVolume30d", old_agent."isSmartBatchEnabled", old_agent."agentRankScore",
      old_agent."activityScore", old_agent."agentMode", old_agent."protocolTrustScore",
      old_agent."executionScore", old_agent."verifiedRevenueExpiresAt", old_agent.listing_registry_source,
      old_agent.sap_verified, old_agent.sap_agent_pda, old_agent.sap_stats_pda, old_agent.sap_capabilities,
      old_agent.sap_pricing_tiers, old_agent.sap_protocols, old_agent.sap_x402_endpoint,
      old_agent.sap_registration_tx, old_agent.sap_last_synced_at, old_agent.sap_stats,
      old_agent.sap_owner_wallet, old_agent.sap_registered_at, old_agent.public_referral_code,
      old_agent.public_referral_destination, old_agent.public_referral_info, old_agent.discovery_score,
      old_agent.public_verification_status, old_agent.cluster_key, old_agent.metaplex_source_type,
      old_agent.metaplex_asset_address, old_agent.metaplex_agent_identity_pda,
      old_agent.metaplex_agent_registration_uri, old_agent.metaplex_agent_token_mint,
      old_agent.metaplex_asset_signer_pda, old_agent.metaplex_verified,
      old_agent.metaplex_token_binding_status, old_agent.metaplex_supported_trust,
      old_agent.metaplex_active, old_agent.metaplex_raw_data, old_agent.metaplex_launch_address,
      old_agent.metaplex_launch_type, old_agent.metaplex_launch_status,
      old_agent.metaplex_bonding_progress_pct, old_agent.metaplex_bonding_progress_source,
      old_agent.metaplex_bonding_progress_updated_at, old_agent.metaplex_trade_url,
      old_agent.metaplex_has_dex_pair, old_agent.work_ready_status, old_agent.work_ready_reasons,
      old_agent.featured_work_ready, old_agent.work_ready_updated_at, old_agent.owner_account_id,
      old_agent.agent_wallet_id, old_agent.ar_verification_status, old_agent.ar_verified_at,
      old_agent.ar_verification_tx_signature, old_agent.ar_verification_fee_lamports,
      old_agent.ar_verification_wallet, old_agent.ar_verification_recipient,
      old_agent.evm_wallet_address, old_agent.evm_privy_wallet_id, old_agent.evm_wallet_provider,
      old_agent.evm_wallet_status, old_agent.evm_wallet_created_at, old_agent.agent_evm_wallet_id,
      old_agent.protocol_agent_id, old_agent.registered_owner, old_agent.declared_active,
      old_agent.declared_x402_support, old_agent.source_evidence_type, old_agent.source_finality,
      old_agent.source_block_number, old_agent.source_block_hash, old_agent.source_transaction_hash,
      old_agent.source_transaction_index, old_agent.source_log_index, old_agent.registration_raw_digest,
      old_agent.registration_semantic_fingerprint, old_agent.solana_asset_address,
      old_agent.solana_sequence_id, old_agent.solana_canonical_status, old_agent.solana_commitment,
      old_agent.solana_slot, old_agent.solana_transaction_signature, old_agent.solana_event_ordinal,
      old_agent.solana_official_rank, old_agent.solana_atom_trust_tier, old_agent.solana_block_time,
      old_agent.registration_normalized_uri, old_agent.registration_content_address,
      old_agent.chain_identity_fingerprint, old_agent.chain_relation_fingerprint,
      old_agent.chain_metrics_fingerprint, old_agent.score_social, old_agent.score_compliance,
      old_agent.source_active, old_agent.source_lifecycle_status, old_agent.moderation_status,
      old_agent.administrative_active_override, old_agent.publicly_active, old_agent.identity_updated_at,
      old_agent.metadata_updated_at, old_agent.activity_observed_at, old_agent.registration_status,
      old_agent.registration_last_success_at, old_agent.score_verified_revenue,
      old_agent.source_registry_address, old_agent.source_quality_score, old_agent.source_feedback_count,
      old_agent.wallet_hydration_status, old_agent.wallet_capability_status,
      old_agent.evm_feedback_source_digest, old_agent.solana_8004_feedback_source_digest
    ) IS DISTINCT FROM ROW(
      new_agent.id, new_agent."agentId", new_agent."chainId",
      new_agent.name, new_agent.description, new_agent.image, new_agent."agentURI", new_agent.owner,
      new_agent."isActive", new_agent."isVerified", new_agent.score, new_agent."hotScore",
      new_agent."x402Support", new_agent.stars, new_agent."totalFeedback", new_agent."totalMessages",
      new_agent."totalChats", new_agent."totalWatches", new_agent."scoreQuality", new_agent."scorePopularity",
      new_agent."scoreActivity", new_agent."scoreWallet", new_agent."scoreFreshness", new_agent."scoreMetadata",
      new_agent."supportedTrust", new_agent."createdAt", new_agent."lastActiveAt", new_agent."scoreServices",
      new_agent."isCustomListed", new_agent."isPremiumVerified", new_agent."binanceCompatible",
      new_agent."hasDuplicateName", new_agent."powerScore", new_agent."activeBoosts",
      new_agent."voteFireCount", new_agent."votePooCount", new_agent."tokenAddress", new_agent."listedAt",
      new_agent.archetype, new_agent."archetypeAuto", new_agent."adminPowerAdjust", new_agent."verifiedWallet",
      new_agent."verifiedWalletAt", new_agent."verifiedWalletChainId", new_agent."perfWinRate",
      new_agent."perfAvgPnlPercent", new_agent."perfBurnToEarnRatio", new_agent."perfTotalVolumeUsd",
      new_agent."perfMonthlyPnlUsd", new_agent."perfLastComputedAt", new_agent."isVerifiedRevenue",
      new_agent."verifiedRevenueAt", new_agent."perfTxCount", new_agent."perfProfitableTxCount",
      new_agent."recentActivity", new_agent."activityUpdatedAt", new_agent."activeWinRate30d",
      new_agent."nativeVolume30d", new_agent."isSmartBatchEnabled", new_agent."agentRankScore",
      new_agent."activityScore", new_agent."agentMode", new_agent."protocolTrustScore",
      new_agent."executionScore", new_agent."verifiedRevenueExpiresAt", new_agent.listing_registry_source,
      new_agent.sap_verified, new_agent.sap_agent_pda, new_agent.sap_stats_pda, new_agent.sap_capabilities,
      new_agent.sap_pricing_tiers, new_agent.sap_protocols, new_agent.sap_x402_endpoint,
      new_agent.sap_registration_tx, new_agent.sap_last_synced_at, new_agent.sap_stats,
      new_agent.sap_owner_wallet, new_agent.sap_registered_at, new_agent.public_referral_code,
      new_agent.public_referral_destination, new_agent.public_referral_info, new_agent.discovery_score,
      new_agent.public_verification_status, new_agent.cluster_key, new_agent.metaplex_source_type,
      new_agent.metaplex_asset_address, new_agent.metaplex_agent_identity_pda,
      new_agent.metaplex_agent_registration_uri, new_agent.metaplex_agent_token_mint,
      new_agent.metaplex_asset_signer_pda, new_agent.metaplex_verified,
      new_agent.metaplex_token_binding_status, new_agent.metaplex_supported_trust,
      new_agent.metaplex_active, new_agent.metaplex_raw_data, new_agent.metaplex_launch_address,
      new_agent.metaplex_launch_type, new_agent.metaplex_launch_status,
      new_agent.metaplex_bonding_progress_pct, new_agent.metaplex_bonding_progress_source,
      new_agent.metaplex_bonding_progress_updated_at, new_agent.metaplex_trade_url,
      new_agent.metaplex_has_dex_pair, new_agent.work_ready_status, new_agent.work_ready_reasons,
      new_agent.featured_work_ready, new_agent.work_ready_updated_at, new_agent.owner_account_id,
      new_agent.agent_wallet_id, new_agent.ar_verification_status, new_agent.ar_verified_at,
      new_agent.ar_verification_tx_signature, new_agent.ar_verification_fee_lamports,
      new_agent.ar_verification_wallet, new_agent.ar_verification_recipient,
      new_agent.evm_wallet_address, new_agent.evm_privy_wallet_id, new_agent.evm_wallet_provider,
      new_agent.evm_wallet_status, new_agent.evm_wallet_created_at, new_agent.agent_evm_wallet_id,
      new_agent.protocol_agent_id, new_agent.registered_owner, new_agent.declared_active,
      new_agent.declared_x402_support, new_agent.source_evidence_type, new_agent.source_finality,
      new_agent.source_block_number, new_agent.source_block_hash, new_agent.source_transaction_hash,
      new_agent.source_transaction_index, new_agent.source_log_index, new_agent.registration_raw_digest,
      new_agent.registration_semantic_fingerprint, new_agent.solana_asset_address,
      new_agent.solana_sequence_id, new_agent.solana_canonical_status, new_agent.solana_commitment,
      new_agent.solana_slot, new_agent.solana_transaction_signature, new_agent.solana_event_ordinal,
      new_agent.solana_official_rank, new_agent.solana_atom_trust_tier, new_agent.solana_block_time,
      new_agent.registration_normalized_uri, new_agent.registration_content_address,
      new_agent.chain_identity_fingerprint, new_agent.chain_relation_fingerprint,
      new_agent.chain_metrics_fingerprint, new_agent.score_social, new_agent.score_compliance,
      new_agent.source_active, new_agent.source_lifecycle_status, new_agent.moderation_status,
      new_agent.administrative_active_override, new_agent.publicly_active, new_agent.identity_updated_at,
      new_agent.metadata_updated_at, new_agent.activity_observed_at, new_agent.registration_status,
      new_agent.registration_last_success_at, new_agent.score_verified_revenue,
      new_agent.source_registry_address, new_agent.source_quality_score, new_agent.source_feedback_count,
      new_agent.wallet_hydration_status, new_agent.wallet_capability_status,
      new_agent.evm_feedback_source_digest, new_agent.solana_8004_feedback_source_digest
    )
  ), targets AS MATERIALIZED (
    SELECT new_chain_id AS chain_id, new_agent_id AS agent_id, new_cluster_key AS cluster_key
    FROM changed
    UNION ALL
    SELECT old_chain_id, old_agent_id, old_cluster_key
    FROM changed
    WHERE old_chain_id IS DISTINCT FROM new_chain_id
       OR old_agent_id IS DISTINCT FROM new_agent_id
       OR old_cluster_key IS DISTINCT FROM new_cluster_key
  ), domains AS MATERIALIZED (
    SELECT DISTINCT candidate.domain
    FROM targets AS agent
    CROSS JOIN LATERAL (VALUES
      ('agent:payload:' || agent.chain_id::text || ':' || agent.agent_id::text),
      (CASE
        WHEN agent.cluster_key IS NOT NULL AND trim(agent.cluster_key) <> ''
          THEN 'agent:cluster:key:' || agent.cluster_key
        ELSE NULL
      END)
    ) AS candidate(domain)
    WHERE candidate.domain IS NOT NULL
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  )
  INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
  SELECT domain, revision, now()
  FROM revisions
  ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
    SET revision = EXCLUDED.revision,
        created_at = EXCLUDED.created_at;
  GET DIAGNOSTICS queued_count = ROW_COUNT;
  IF queued_count > 0 THEN
    PERFORM pg_notify('cache_invalidation', 'bulk');
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Agent_payload_cache_domains_insert"
AFTER INSERT ON "Agent"
REFERENCING NEW TABLE AS new_agent_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_queue_agent_payload_domains_inserted();

CREATE TRIGGER "Agent_payload_cache_domains_delete"
AFTER DELETE ON "Agent"
REFERENCING OLD TABLE AS old_agent_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_queue_agent_payload_domains_deleted();

CREATE TRIGGER "Agent_payload_cache_domains_update"
AFTER UPDATE ON "Agent"
REFERENCING OLD TABLE AS old_agent_payload_rows NEW TABLE AS new_agent_payload_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_queue_agent_payload_domains_updated();

-- Duplicate-name maintenance previously ran two unindexed normalized-name
-- scans for every inserted Agent, making a large bootstrap quadratic. Match the
-- trigger expression exactly and refresh all names touched by one statement in
-- a single indexed join.
CREATE INDEX IF NOT EXISTS "Agent_normalized_name_idx"
  ON "Agent" ((lower(trim(name))));

CREATE OR REPLACE FUNCTION agentranking_refresh_duplicate_name_groups(target_names text[])
RETURNS void
LANGUAGE sql
AS $$
  WITH targets AS MATERIALIZED (
    SELECT DISTINCT normalized_name
    FROM unnest(target_names) AS input(normalized_name)
    WHERE normalized_name IS NOT NULL
  ), duplicate_state AS MATERIALIZED (
    SELECT
      target.normalized_name,
      count(agent.id) > 1 AS has_duplicate
    FROM targets AS target
    LEFT JOIN "Agent" AS agent
      ON lower(trim(agent.name)) = target.normalized_name
    GROUP BY target.normalized_name
  )
  UPDATE "Agent" AS agent
  SET "hasDuplicateName" = duplicate_state.has_duplicate
  FROM duplicate_state
  WHERE lower(trim(agent.name)) = duplicate_state.normalized_name
    AND agent."hasDuplicateName" IS DISTINCT FROM duplicate_state.has_duplicate
$$;

CREATE OR REPLACE FUNCTION agentranking_refresh_duplicate_name_group(target_normalized_name text)
RETURNS void
LANGUAGE sql
AS $$
  SELECT agentranking_refresh_duplicate_name_groups(ARRAY[target_normalized_name])
$$;

CREATE OR REPLACE FUNCTION agentranking_refresh_duplicate_names_inserted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_refresh_duplicate_name_groups(ARRAY(
    SELECT DISTINCT lower(trim(name))
    FROM new_agent_name_rows
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_refresh_duplicate_names_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_refresh_duplicate_name_groups(ARRAY(
    SELECT DISTINCT lower(trim(name))
    FROM old_agent_name_rows
  ));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Agent_refresh_duplicate_names_insert_delete" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_refresh_duplicate_names_insert" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_refresh_duplicate_names_delete" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_refresh_duplicate_names_update" ON "Agent";

CREATE TRIGGER "Agent_refresh_duplicate_names_insert"
AFTER INSERT ON "Agent"
REFERENCING NEW TABLE AS new_agent_name_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_refresh_duplicate_names_inserted();

CREATE TRIGGER "Agent_refresh_duplicate_names_delete"
AFTER DELETE ON "Agent"
REFERENCING OLD TABLE AS old_agent_name_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_refresh_duplicate_names_deleted();

CREATE TRIGGER "Agent_refresh_duplicate_names_update"
AFTER UPDATE OF name ON "Agent"
FOR EACH ROW
EXECUTE FUNCTION agentranking_refresh_duplicate_names_for_row();

-- Queue score materialization once per affected Agent and statement. Besides
-- removing row-trigger overhead, comparing transition rows observes version
-- increments made by Agent_mark_score_dirty's BEFORE trigger; UPDATE OF column
-- triggers only observe columns named in the original SET list.
CREATE OR REPLACE FUNCTION agentranking_queue_agent_scores_bulk(target_agent_ids integer[])
RETURNS void
LANGUAGE sql
AS $$
  WITH domains AS MATERIALIZED (
    SELECT DISTINCT 'derived:agent-score:' || agent_id::text AS domain
    FROM unnest(target_agent_ids) AS requested(agent_id)
    WHERE agent_id IS NOT NULL
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  ), queued AS (
    INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
    SELECT domain, revision, now()
    FROM revisions
    ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
      SET revision = EXCLUDED.revision,
          created_at = EXCLUDED.created_at
    RETURNING 1
  )
  SELECT pg_notify('cache_invalidation', 'bulk')
  FROM queued
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION agentranking_queue_inserted_agent_scores()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_agent_scores_bulk(ARRAY(
    SELECT id FROM new_agent_score_rows
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_queue_updated_agent_scores()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_agent_scores_bulk(ARRAY(
    SELECT new_agent.id
    FROM old_agent_score_rows AS old_agent
    INNER JOIN new_agent_score_rows AS new_agent USING (id)
    WHERE old_agent.score_state_version IS DISTINCT FROM new_agent.score_state_version
  ));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Agent_score_enqueue_insert" ON "Agent";
DROP TRIGGER IF EXISTS "Agent_score_enqueue_version" ON "Agent";

CREATE TRIGGER "Agent_score_enqueue_insert"
AFTER INSERT ON "Agent"
REFERENCING NEW TABLE AS new_agent_score_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_queue_inserted_agent_scores();

CREATE TRIGGER "Agent_score_enqueue_version"
AFTER UPDATE ON "Agent"
REFERENCING OLD TABLE AS old_agent_score_rows NEW TABLE AS new_agent_score_rows
FOR EACH STATEMENT
EXECUTE FUNCTION agentranking_queue_updated_agent_scores();

-- A bulk bootstrap should update its first-Agent marker once, not execute the
-- same no-op epoch lookup for every inserted row after the first.
CREATE OR REPLACE FUNCTION record_indexer_bootstrap_first_agents_inserted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  first_inserted_id integer;
BEGIN
  SELECT min(id) INTO first_inserted_id FROM new_bootstrap_agent_rows;
  IF first_inserted_id IS NULL THEN RETURN NULL; END IF;
  UPDATE indexer_bootstrap_epochs
  SET first_agent_materialized_at = CURRENT_TIMESTAMP,
      first_agent_db_id = first_inserted_id
  WHERE id = (
    SELECT id
    FROM indexer_bootstrap_epochs
    WHERE status = 'RUNNING'
      AND phase = 'IDENTITY'
      AND first_agent_materialized_at IS NULL
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "Agent_record_indexer_bootstrap_first_agent" ON "Agent";
CREATE TRIGGER "Agent_record_indexer_bootstrap_first_agent"
AFTER INSERT ON "Agent"
REFERENCING NEW TABLE AS new_bootstrap_agent_rows
FOR EACH STATEMENT
EXECUTE FUNCTION record_indexer_bootstrap_first_agents_inserted();

CREATE OR REPLACE FUNCTION agentranking_queue_related_agent_payloads_bulk(target_agent_ids integer[])
RETURNS void
LANGUAGE sql
AS $$
  WITH agents AS MATERIALIZED (
    SELECT DISTINCT agent."chainId", agent."agentId", agent.cluster_key
    FROM "Agent" AS agent
    INNER JOIN unnest(target_agent_ids) AS requested(id) ON requested.id = agent.id
  ), domains AS MATERIALIZED (
    SELECT DISTINCT candidate.domain
    FROM agents AS agent
    CROSS JOIN LATERAL (VALUES
      ('agent:payload:' || agent."chainId"::text || ':' || agent."agentId"::text),
      (CASE
        WHEN agent.cluster_key IS NOT NULL AND trim(agent.cluster_key) <> ''
          THEN 'agent:cluster:key:' || agent.cluster_key
        ELSE NULL
      END)
    ) AS candidate(domain)
    WHERE candidate.domain IS NOT NULL
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  ), queued AS (
    INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
    SELECT domain, revision, now()
    FROM revisions
    ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
      SET revision = EXCLUDED.revision,
          created_at = EXCLUDED.created_at
    RETURNING 1
  )
  SELECT pg_notify('cache_invalidation', 'bulk')
  FROM queued
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_inserted_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_related_agent_payloads_bulk(ARRAY(
    SELECT DISTINCT "agentId" FROM new_payload_rows
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_deleted_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_related_agent_payloads_bulk(ARRAY(
    SELECT DISTINCT "agentId" FROM old_payload_rows
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_updated_agent_payloads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_related_agent_payloads_bulk(ARRAY(
    SELECT "agentId" FROM new_payload_rows
    UNION
    SELECT "agentId" FROM old_payload_rows
  ));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "AgentMcpOffer_payload_cache_domains" ON "AgentMcpOffer";
DROP TRIGGER IF EXISTS "AgentVerificationSignal_payload_cache_domains" ON agent_verification_signals;
DROP TRIGGER IF EXISTS "AgentOfficialLink_payload_cache_domains" ON agent_official_links;
DROP TRIGGER IF EXISTS "AgentPaidService_payload_cache_domains" ON agent_paid_services;
DROP TRIGGER IF EXISTS "AgentGithubConnection_payload_cache_domains" ON agent_github_connections;
DROP TRIGGER IF EXISTS "AgentGithubSnapshot_payload_cache_domains" ON agent_github_snapshots;
DROP TRIGGER IF EXISTS "AgentGithubPushNote_payload_cache_domains" ON agent_github_push_notes;
DROP TRIGGER IF EXISTS "ArHolderAgentPerk_payload_cache_domains" ON "ArHolderAgentPerk";
DROP TRIGGER IF EXISTS "DaoLeaderboardLive_payload_cache_domains" ON "DaoLeaderboardLive";
DROP TRIGGER IF EXISTS "AgentMcpOffer_payload_cache_domains_insert" ON "AgentMcpOffer";
DROP TRIGGER IF EXISTS "AgentMcpOffer_payload_cache_domains_delete" ON "AgentMcpOffer";
DROP TRIGGER IF EXISTS "AgentMcpOffer_payload_cache_domains_update" ON "AgentMcpOffer";
DROP TRIGGER IF EXISTS "AgentVerificationSignal_payload_cache_domains_insert" ON agent_verification_signals;
DROP TRIGGER IF EXISTS "AgentVerificationSignal_payload_cache_domains_delete" ON agent_verification_signals;
DROP TRIGGER IF EXISTS "AgentVerificationSignal_payload_cache_domains_update" ON agent_verification_signals;
DROP TRIGGER IF EXISTS "AgentOfficialLink_payload_cache_domains_insert" ON agent_official_links;
DROP TRIGGER IF EXISTS "AgentOfficialLink_payload_cache_domains_delete" ON agent_official_links;
DROP TRIGGER IF EXISTS "AgentOfficialLink_payload_cache_domains_update" ON agent_official_links;
DROP TRIGGER IF EXISTS "AgentPaidService_payload_cache_domains_insert" ON agent_paid_services;
DROP TRIGGER IF EXISTS "AgentPaidService_payload_cache_domains_delete" ON agent_paid_services;
DROP TRIGGER IF EXISTS "AgentPaidService_payload_cache_domains_update" ON agent_paid_services;
DROP TRIGGER IF EXISTS "AgentGithubConnection_payload_cache_domains_insert" ON agent_github_connections;
DROP TRIGGER IF EXISTS "AgentGithubConnection_payload_cache_domains_delete" ON agent_github_connections;
DROP TRIGGER IF EXISTS "AgentGithubConnection_payload_cache_domains_update" ON agent_github_connections;
DROP TRIGGER IF EXISTS "AgentGithubSnapshot_payload_cache_domains_insert" ON agent_github_snapshots;
DROP TRIGGER IF EXISTS "AgentGithubSnapshot_payload_cache_domains_delete" ON agent_github_snapshots;
DROP TRIGGER IF EXISTS "AgentGithubSnapshot_payload_cache_domains_update" ON agent_github_snapshots;
DROP TRIGGER IF EXISTS "AgentGithubPushNote_payload_cache_domains_insert" ON agent_github_push_notes;
DROP TRIGGER IF EXISTS "AgentGithubPushNote_payload_cache_domains_delete" ON agent_github_push_notes;
DROP TRIGGER IF EXISTS "AgentGithubPushNote_payload_cache_domains_update" ON agent_github_push_notes;
DROP TRIGGER IF EXISTS "ArHolderAgentPerk_payload_cache_domains_insert" ON "ArHolderAgentPerk";
DROP TRIGGER IF EXISTS "ArHolderAgentPerk_payload_cache_domains_delete" ON "ArHolderAgentPerk";
DROP TRIGGER IF EXISTS "ArHolderAgentPerk_payload_cache_domains_update" ON "ArHolderAgentPerk";
DROP TRIGGER IF EXISTS "DaoLeaderboardLive_payload_cache_domains_insert" ON "DaoLeaderboardLive";
DROP TRIGGER IF EXISTS "DaoLeaderboardLive_payload_cache_domains_delete" ON "DaoLeaderboardLive";
DROP TRIGGER IF EXISTS "DaoLeaderboardLive_payload_cache_domains_update" ON "DaoLeaderboardLive";

CREATE TRIGGER "AgentMcpOffer_payload_cache_domains_insert"
AFTER INSERT ON "AgentMcpOffer"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentMcpOffer_payload_cache_domains_delete"
AFTER DELETE ON "AgentMcpOffer"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentMcpOffer_payload_cache_domains_update"
AFTER UPDATE ON "AgentMcpOffer"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentVerificationSignal_payload_cache_domains_insert"
AFTER INSERT ON agent_verification_signals
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentVerificationSignal_payload_cache_domains_delete"
AFTER DELETE ON agent_verification_signals
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentVerificationSignal_payload_cache_domains_update"
AFTER UPDATE ON agent_verification_signals
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentOfficialLink_payload_cache_domains_insert"
AFTER INSERT ON agent_official_links
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentOfficialLink_payload_cache_domains_delete"
AFTER DELETE ON agent_official_links
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentOfficialLink_payload_cache_domains_update"
AFTER UPDATE ON agent_official_links
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentPaidService_payload_cache_domains_insert"
AFTER INSERT ON agent_paid_services
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentPaidService_payload_cache_domains_delete"
AFTER DELETE ON agent_paid_services
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentPaidService_payload_cache_domains_update"
AFTER UPDATE ON agent_paid_services
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentGithubConnection_payload_cache_domains_insert"
AFTER INSERT ON agent_github_connections
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentGithubConnection_payload_cache_domains_delete"
AFTER DELETE ON agent_github_connections
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentGithubConnection_payload_cache_domains_update"
AFTER UPDATE ON agent_github_connections
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentGithubSnapshot_payload_cache_domains_insert"
AFTER INSERT ON agent_github_snapshots
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentGithubSnapshot_payload_cache_domains_delete"
AFTER DELETE ON agent_github_snapshots
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentGithubSnapshot_payload_cache_domains_update"
AFTER UPDATE ON agent_github_snapshots
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "AgentGithubPushNote_payload_cache_domains_insert"
AFTER INSERT ON agent_github_push_notes
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "AgentGithubPushNote_payload_cache_domains_delete"
AFTER DELETE ON agent_github_push_notes
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "AgentGithubPushNote_payload_cache_domains_update"
AFTER UPDATE ON agent_github_push_notes
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "ArHolderAgentPerk_payload_cache_domains_insert"
AFTER INSERT ON "ArHolderAgentPerk"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "ArHolderAgentPerk_payload_cache_domains_delete"
AFTER DELETE ON "ArHolderAgentPerk"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "ArHolderAgentPerk_payload_cache_domains_update"
AFTER UPDATE ON "ArHolderAgentPerk"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE TRIGGER "DaoLeaderboardLive_payload_cache_domains_insert"
AFTER INSERT ON "DaoLeaderboardLive"
REFERENCING NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_inserted_agent_payloads();
CREATE TRIGGER "DaoLeaderboardLive_payload_cache_domains_delete"
AFTER DELETE ON "DaoLeaderboardLive"
REFERENCING OLD TABLE AS old_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_deleted_agent_payloads();
CREATE TRIGGER "DaoLeaderboardLive_payload_cache_domains_update"
AFTER UPDATE ON "DaoLeaderboardLive"
REFERENCING OLD TABLE AS old_payload_rows NEW TABLE AS new_payload_rows
FOR EACH STATEMENT EXECUTE FUNCTION agentranking_invalidate_updated_agent_payloads();

CREATE OR REPLACE FUNCTION agentranking_queue_cache_domains_bulk(target_domains text[])
RETURNS void
LANGUAGE sql
AS $$
  WITH domains AS MATERIALIZED (
    SELECT DISTINCT domain
    FROM unnest(target_domains) AS requested(domain)
    WHERE domain IS NOT NULL AND domain <> ''
  ), revisions AS (
    INSERT INTO cache_domain_revisions (domain, revision, changed_at)
    SELECT domain, 1, now()
    FROM domains
    ON CONFLICT (domain) DO UPDATE
      SET revision = cache_domain_revisions.revision + 1,
          changed_at = now()
    RETURNING domain, revision
  ), queued AS (
    INSERT INTO cache_invalidation_outbox (domain, revision, created_at)
    SELECT domain, revision, now()
    FROM revisions
    ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
      SET revision = EXCLUDED.revision,
          created_at = EXCLUDED.created_at
    RETURNING 1
  )
  SELECT pg_notify('cache_invalidation', 'bulk')
  FROM queued
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_agent_public_domains()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('agent:public-content');
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_feedback_domains()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('agent:public-content');
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_invalidate_chain_cache_domains()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relevant_update boolean;
  affected_agent_ids integer[];
BEGIN
  PERFORM agentranking_queue_cache_domains_bulk(ARRAY[
    'agent:public-content',
    'ranking'
  ]);

  IF TG_OP = 'UPDATE' THEN
    relevant_update :=
      OLD."chainId" IS DISTINCT FROM NEW."chainId" OR
      OLD.name IS DISTINCT FROM NEW.name OR
      OLD."shortName" IS DISTINCT FROM NEW."shortName" OR
      OLD.icon IS DISTINCT FROM NEW.icon OR
      OLD.color IS DISTINCT FROM NEW.color OR
      OLD."identityRegistry" IS DISTINCT FROM NEW."identityRegistry" OR
      OLD."reputationRegistry" IS DISTINCT FROM NEW."reputationRegistry" OR
      OLD."validationRegistry" IS DISTINCT FROM NEW."validationRegistry" OR
      OLD."isActive" IS DISTINCT FROM NEW."isActive";
  ELSE
    relevant_update := TRUE;
  END IF;

  IF relevant_update THEN
    IF TG_OP = 'INSERT' THEN
      SELECT ARRAY(SELECT id FROM "Agent" WHERE "chainId" = NEW."chainId")
      INTO affected_agent_ids;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT ARRAY(SELECT id FROM "Agent" WHERE "chainId" = OLD."chainId")
      INTO affected_agent_ids;
    ELSE
      SELECT ARRAY(
        SELECT id
        FROM "Agent"
        WHERE "chainId" = OLD."chainId"
           OR "chainId" = NEW."chainId"
      ) INTO affected_agent_ids;
    END IF;
    PERFORM agentranking_queue_related_agent_payloads_bulk(affected_agent_ids);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_queue_agent_payload_domains(
  target_chain_id integer,
  target_agent_id integer,
  target_cluster_key text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain(
    'agent:payload:' || target_chain_id::text || ':' || target_agent_id::text
  );
  IF target_cluster_key IS NOT NULL AND trim(target_cluster_key) <> '' THEN
    PERFORM agentranking_queue_cache_domain('agent:cluster:key:' || target_cluster_key);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION agentranking_refresh_duplicate_name_groups(target_names text[])
RETURNS void
LANGUAGE sql
AS $$
  WITH targets AS MATERIALIZED (
    SELECT DISTINCT normalized_name
    FROM unnest(target_names) AS input(normalized_name)
    WHERE normalized_name IS NOT NULL
  ), duplicate_state AS MATERIALIZED (
    SELECT
      target.normalized_name,
      count(agent.id) > 1 AS has_duplicate
    FROM targets AS target
    LEFT JOIN "Agent" AS agent
      ON lower(trim(agent.name)) = target.normalized_name
    GROUP BY target.normalized_name
  ), updated AS (
    UPDATE "Agent" AS agent
    SET "hasDuplicateName" = duplicate_state.has_duplicate
    FROM duplicate_state
    WHERE lower(trim(agent.name)) = duplicate_state.normalized_name
      AND agent."hasDuplicateName" IS DISTINCT FROM duplicate_state.has_duplicate
    RETURNING agent.id
  )
  SELECT agentranking_queue_related_agent_payloads_bulk(
    COALESCE(array_agg(id), ARRAY[]::integer[])
  )
  FROM updated
$$;

COMMIT;
