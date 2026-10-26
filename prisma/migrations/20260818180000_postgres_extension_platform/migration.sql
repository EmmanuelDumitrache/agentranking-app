-- PostgreSQL extension platform for AgentRanking search, observability, and
-- range-integrity workloads. Trusted extensions are migration-owned; the one
-- preload/superuser extension is provisioned explicitly by the managed deploy
-- path so every supported environment converges on the same SQL capabilities.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pg_stat_statements is the one non-trusted extension in this platform and is
-- provisioned by scripts/deploy.mjs as the PostgreSQL OS superuser before
-- Prisma migrations run. Local operators can install it once with a database
-- superuser; application migrations deliberately do not require SUPERUSER.
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- unaccent() is STABLE because a text-search dictionary could theoretically be
-- replaced at runtime. AgentRanking pins the extension-provided dictionary and
-- treats that dictionary as database schema, allowing the normalized expression
-- to be indexed. If the unaccent rules are intentionally changed, REINDEX the
-- expression indexes below in the same deployment.
CREATE OR REPLACE FUNCTION public.agentranking_search_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, input))
$function$;

COMMENT ON FUNCTION public.agentranking_search_normalize(text) IS
  'Lowercase, accent-insensitive AgentRanking search normalization. The public.unaccent dictionary is treated as immutable schema; REINDEX dependent indexes after changing its rules.';

CREATE OR REPLACE FUNCTION public.agentranking_search_normalize_jsonb(input jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT public.agentranking_search_normalize(input::text)
$function$;

COMMENT ON FUNCTION public.agentranking_search_normalize_jsonb(jsonb) IS
  'Accent-insensitive textual projection used by the agent-chat lexical history GIN index.';

-- Directory and admin search. btree_gin allows chain equality and trigram text
-- predicates to share one GIN index; the index also remains usable when the
-- query only constrains one of its text columns.
CREATE INDEX IF NOT EXISTS agent_directory_search_gin_idx
  ON "Agent" USING GIN (
    "chainId" int4_ops,
    name gin_trgm_ops,
    description gin_trgm_ops,
    owner gin_trgm_ops,
    "verifiedWallet" gin_trgm_ops,
    "tokenAddress" gin_trgm_ops,
    "supportedTrust" gin_trgm_ops
  );

-- URI/endpoint host matching is intentionally separate from normal directory
-- search because these strings can be substantially larger and are primarily
-- exercised by registry twin resolution and social-link discovery.
CREATE INDEX IF NOT EXISTS agent_registry_endpoint_search_gin_idx
  ON "Agent" USING GIN (
    "agentURI" gin_trgm_ops,
    registration_normalized_uri gin_trgm_ops,
    sap_x402_endpoint gin_trgm_ops,
    metaplex_agent_registration_uri gin_trgm_ops
  );

-- Public ranking uses this exact normalized expression for accent-insensitive
-- prefix matching while retaining pg_trgm's index support.
CREATE INDEX IF NOT EXISTS agent_name_unaccent_trgm_idx
  ON "Agent" USING GIN (
    public.agentranking_search_normalize(name) gin_trgm_ops
  );

-- The Covenant dashboard has one raw capability-discovery fallback over JSON.
-- Use the same normalized projection as the query so the fallback does not
-- devolve into a full Agent scan and remains accent/case insensitive.
CREATE INDEX IF NOT EXISTS agent_sap_capabilities_trgm_idx
  ON "Agent" USING GIN (
    public.agentranking_search_normalize_jsonb(sap_capabilities) gin_trgm_ops
  );

-- Supersede the registrations-only index with one index for every metadata key
-- that is searched by substring in the application. key uses btree_gin while
-- value uses pg_trgm.
DROP INDEX IF EXISTS agent_metadata_registrations_trgm_idx;
CREATE INDEX IF NOT EXISTS agent_metadata_search_gin_idx
  ON "AgentMetadata" USING GIN (
    key text_ops,
    value gin_trgm_ops
  )
  WHERE key IN ('registrations', 'tags', 'telegramBotUsername');

-- Service endpoints are searched by hostname for registry reconciliation and
-- social-profile detection. Include source kind for the common agent/source
-- scoped paths without replacing the existing B-tree agent indexes.
CREATE INDEX IF NOT EXISTS agent_service_endpoint_search_gin_idx
  ON "AgentService" USING GIN (
    source_kind text_ops,
    endpoint gin_trgm_ops
  )
  WHERE endpoint <> '';

-- Profile lookup powers social search plus admin identity/account search. The
-- scalar subscription status is a btree_gin column, while user-supplied text is
-- handled by pg_trgm.
CREATE INDEX IF NOT EXISTS user_profile_search_gin_idx
  ON "UserProfile" USING GIN (
    "subscriptionStatus" text_ops,
    email gin_trgm_ops,
    "walletAddress" gin_trgm_ops,
    username gin_trgm_ops,
    "displayName" gin_trgm_ops
  );

-- Creator administration searches both the account projection and linked user
-- profile, and can search custodial public keys by substring. Keep those two
-- physical tables independently indexable so relation filters can bitmap-join.
CREATE INDEX IF NOT EXISTS app_accounts_creator_search_gin_idx
  ON app_accounts USING GIN (
    email gin_trgm_ops,
    display_name gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS custodial_wallets_public_key_trgm_idx
  ON custodial_wallets USING GIN (public_key gin_trgm_ops);

-- Public job search always excludes samples and usually combines source/status
-- filters with one or more substring predicates.
CREATE INDEX IF NOT EXISTS partner_jobs_public_search_gin_idx
  ON partner_jobs USING GIN (
    source text_ops,
    status text_ops,
    title gin_trgm_ops,
    description gin_trgm_ops,
    category gin_trgm_ops,
    job_type gin_trgm_ops
  )
  WHERE is_sample = FALSE;

-- Feedback administration supports substring lookup by client address.
CREATE INDEX IF NOT EXISTS feedback_client_address_trgm_idx
  ON "Feedback" USING GIN ("clientAddress" gin_trgm_ops);

-- Treasury history is always account-scoped and optionally filters merchant by
-- substring. btree_gin keeps the account equality and pg_trgm merchant predicate
-- in the same access method while the temporal B-tree remains available.
CREATE INDEX IF NOT EXISTS treasury_transactions_account_merchant_search_gin_idx
  ON treasury_transactions USING GIN (
    app_account_id text_ops,
    merchant gin_trgm_ops
  );

-- Daily human-readable order allocation uses a pattern containing the date after
-- a wildcarded order type. Trigrams make the date-bearing LIKE probe indexable.
CREATE INDEX IF NOT EXISTS order_number_pattern_trgm_idx
  ON "Order" USING GIN ("orderNumber" gin_trgm_ops);

-- Agent chat lexical recall combines an exact conversation scope with an
-- accent-insensitive trigram predicate over persisted UI-message parts. The
-- normalized expression is the same one emitted by the server query helper.
CREATE INDEX IF NOT EXISTS agent_chat_messages_context_search_gin_idx
  ON agent_chat_messages USING GIN (
    conversation_id text_ops,
    public.agentranking_search_normalize_jsonb(parts) gin_trgm_ops
  );

-- Artifact search is intentionally independent of the existing temporal B-tree
-- indexes so PostgreSQL can bitmap-combine scope/order candidates with lexical
-- candidates. search_text is bounded by the application before persistence.
CREATE INDEX IF NOT EXISTS agent_chat_artifacts_lexical_search_gin_idx
  ON agent_chat_artifacts USING GIN (
    search_text gin_trgm_ops,
    preview_text gin_trgm_ops,
    digest_text gin_trgm_ops,
    tool_name gin_trgm_ops
  );

-- The worker already serializes allocation by source with an advisory lock and
-- computes uncovered ranges in application code. btree_gist turns the same
-- invariant into a database constraint so no two non-invalidated leases for one
-- source can overlap, including writes from future code paths.
DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'indexer_range_leases_non_overlapping_active'
      AND conrelid = 'indexer_range_leases'::regclass
  ) THEN
    ALTER TABLE indexer_range_leases
      ADD CONSTRAINT indexer_range_leases_non_overlapping_active
      EXCLUDE USING GIST (
        source_key WITH =,
        int8range(from_block, to_block, '[]') WITH &&
      )
      WHERE (status <> 'INVALIDATED');
  END IF;
END
$block$;
