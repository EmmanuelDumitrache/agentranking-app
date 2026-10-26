-- Second-stage PostgreSQL extension integration. This migration builds on the
-- extension platform introduced in 20260818180000_postgres_extension_platform.
-- It adds nearest-neighbour fuzzy lookup and folds scalar retrieval predicates
-- into the existing GIN indexes that already carry trigram search terms.

-- Public/lightweight agent lookup can now perform typo-tolerant nearest-neighbour
-- name search against the same accent-insensitive normalization used elsewhere.
-- `gist_trgm_ops` provides KNN `<->`; the boolean columns come from btree_gist so
-- active/public visibility filters can be applied by the same multicolumn GiST.
CREATE INDEX IF NOT EXISTS agent_name_fuzzy_gist_idx
  ON "Agent" USING GIST (
    public.agentranking_search_normalize(name) gist_trgm_ops(siglen=32),
    "isActive",
    publicly_active
  );

-- Directory searches overwhelmingly combine text predicates with active/public
-- lifecycle filters. btree_gin can carry those scalars alongside pg_trgm text
-- terms, avoiding a separate bitmap input while remaining usable for any subset
-- of indexed columns.
DROP INDEX IF EXISTS agent_directory_search_gin_idx;
CREATE INDEX agent_directory_search_gin_idx
  ON "Agent" USING GIN (
    "isActive" bool_ops,
    publicly_active bool_ops,
    "chainId" int4_ops,
    name gin_trgm_ops,
    description gin_trgm_ops,
    owner gin_trgm_ops,
    "verifiedWallet" gin_trgm_ops,
    "tokenAddress" gin_trgm_ops,
    "supportedTrust" gin_trgm_ops
  );

-- Tool-result retrieval is conversation-scoped, optionally scopes to a run, and
-- separately treats state-changing artifacts as high-value evidence. Keep those
-- scalar predicates in the same GIN structure as lexical terms so PostgreSQL
-- need not bitmap-AND unrelated access methods for the common mixed queries.
DROP INDEX IF EXISTS agent_chat_artifacts_lexical_search_gin_idx;
CREATE INDEX agent_chat_artifacts_lexical_search_gin_idx
  ON agent_chat_artifacts USING GIN (
    conversation_id text_ops,
    run_id text_ops,
    state_changing bool_ops,
    search_text gin_trgm_ops,
    preview_text gin_trgm_ops,
    digest_text gin_trgm_ops,
    tool_name gin_trgm_ops
  );
