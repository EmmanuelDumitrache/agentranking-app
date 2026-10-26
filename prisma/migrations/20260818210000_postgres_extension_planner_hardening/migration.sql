-- Third-stage PostgreSQL extension hardening. The extension-backed indexes are
-- useful only when the planner can accurately estimate the correlated scalar
-- predicates that accompany their trigram terms. Extended statistics model
-- those correlations explicitly, while higher expression statistics targets
-- give the normalized search expressions a larger sample for selectivity work.

-- Public agent discovery commonly combines chain and lifecycle predicates. The
-- two lifecycle flags are intentionally related, so assuming independence can
-- badly underestimate or overestimate the rows flowing into a trigram scan.
CREATE STATISTICS IF NOT EXISTS public.agent_public_search_lifecycle_stats
  (mcv, dependencies)
  ON "chainId", "isActive", publicly_active
  FROM public."Agent";
ALTER STATISTICS public.agent_public_search_lifecycle_stats SET STATISTICS 500;

-- Tool-result retrieval combines conversation, run, and state-changing scope
-- predicates with the btree_gin/trigram artifact index. Preserve both common
-- value combinations and functional dependencies between those dimensions.
CREATE STATISTICS IF NOT EXISTS public.agent_chat_artifact_scope_stats
  (ndistinct, mcv, dependencies)
  ON conversation_id, run_id, state_changing
  FROM public.agent_chat_artifacts;
ALTER STATISTICS public.agent_chat_artifact_scope_stats SET STATISTICS 500;

-- Public partner-job search is a partial GIN over non-sample rows and commonly
-- combines source/status with lexical terms. Model those filter combinations so
-- the planner can compare the GIN path against existing temporal B-tree paths.
CREATE STATISTICS IF NOT EXISTS public.partner_jobs_public_search_scope_stats
  (mcv, dependencies)
  ON is_sample, source, status
  FROM public.partner_jobs;
ALTER STATISTICS public.partner_jobs_public_search_scope_stats SET STATISTICS 300;

-- PostgreSQL can gather statistics directly on expression-index attributes.
-- Raise the target only for the bounded normalized projections whose
-- selectivity determines whether the extension-backed access path is attractive.
ALTER INDEX public.agent_name_unaccent_trgm_idx ALTER COLUMN 1 SET STATISTICS 500;
ALTER INDEX public.agent_name_fuzzy_gist_idx ALTER COLUMN 1 SET STATISTICS 500;
ALTER INDEX public.agent_sap_capabilities_trgm_idx ALTER COLUMN 1 SET STATISTICS 250;
ALTER INDEX public.agent_chat_messages_context_search_gin_idx ALTER COLUMN 2 SET STATISTICS 250;

-- CREATE STATISTICS defines the objects but does not populate them. Seed the
-- planner immediately so a freshly migrated production process does not spend
-- its first autovacuum/analyze interval planning with empty extended stats.
ANALYZE public."Agent";
ANALYZE public.agent_chat_artifacts;
ANALYZE public.partner_jobs;
ANALYZE public.agent_chat_messages;
