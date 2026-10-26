-- Harden shared Valkey cache invalidation at the PostgreSQL mutation boundary.
-- Exact agent/cluster/SAP domains are generation-fenced by the dispatcher, so
-- loaders that began before a mutation can only publish into obsolete keys.

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_related_agent_payload_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_db_id INTEGER;
  new_db_id INTEGER;
  target_chain_id INTEGER;
  target_agent_id INTEGER;
  target_cluster_key TEXT;
BEGIN
  old_db_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD."agentId" ELSE NULL END;
  new_db_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW."agentId" ELSE NULL END;

  IF old_db_id IS NOT NULL THEN
    SELECT a."chainId", a."agentId", a."cluster_key"
      INTO target_chain_id, target_agent_id, target_cluster_key
    FROM "Agent" a
    WHERE a.id = old_db_id;
    IF FOUND THEN
      PERFORM agentranking_queue_agent_payload_domains(
        target_chain_id,
        target_agent_id,
        target_cluster_key
      );
    END IF;
  END IF;

  IF new_db_id IS NOT NULL AND new_db_id IS DISTINCT FROM old_db_id THEN
    SELECT a."chainId", a."agentId", a."cluster_key"
      INTO target_chain_id, target_agent_id, target_cluster_key
    FROM "Agent" a
    WHERE a.id = new_db_id;
    IF FOUND THEN
      PERFORM agentranking_queue_agent_payload_domains(
        target_chain_id,
        target_agent_id,
        target_cluster_key
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_chain_cache_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  agent_row RECORD;
  relevant_update BOOLEAN;
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  PERFORM agentranking_queue_cache_domain('stats:top-by-chain');
  PERFORM agentranking_queue_cache_domain('powerboost');
  PERFORM agentranking_queue_cache_domain('ranking');
  PERFORM agentranking_queue_cache_domain('agents:list:web');
  PERFORM agentranking_queue_cache_domain('agents:list:v1');
  PERFORM agentranking_queue_cache_domain('agents:list:v2');

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

  IF relevant_update AND TG_OP IN ('UPDATE', 'DELETE') THEN
    FOR agent_row IN
      SELECT a."chainId", a."agentId", a."cluster_key"
      FROM "Agent" a
      WHERE a."chainId" = OLD."chainId"
    LOOP
      PERFORM agentranking_queue_agent_payload_domains(
        agent_row."chainId",
        agent_row."agentId",
        agent_row."cluster_key"
      );
    END LOOP;
  END IF;

  IF relevant_update AND TG_OP = 'INSERT' THEN
    FOR agent_row IN
      SELECT a."chainId", a."agentId", a."cluster_key"
      FROM "Agent" a
      WHERE a."chainId" = NEW."chainId"
    LOOP
      PERFORM agentranking_queue_agent_payload_domains(
        agent_row."chainId",
        agent_row."agentId",
        agent_row."cluster_key"
      );
    END LOOP;
  ELSIF relevant_update AND TG_OP = 'UPDATE' AND NEW."chainId" IS DISTINCT FROM OLD."chainId" THEN
    FOR agent_row IN
      SELECT a."chainId", a."agentId", a."cluster_key"
      FROM "Agent" a
      WHERE a."chainId" = NEW."chainId"
    LOOP
      PERFORM agentranking_queue_agent_payload_domains(
        agent_row."chainId",
        agent_row."agentId",
        agent_row."cluster_key"
      );
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "Chain_public_cache_domains" ON public."Chain";
CREATE TRIGGER "Chain_public_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."Chain"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_chain_cache_domains();

DROP TRIGGER IF EXISTS "AgentMcpOffer_payload_cache_domains" ON public."AgentMcpOffer";
CREATE TRIGGER "AgentMcpOffer_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."AgentMcpOffer"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "Feedback_payload_cache_domains" ON public."Feedback";
CREATE TRIGGER "Feedback_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."Feedback"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentVerificationSignal_payload_cache_domains" ON public.agent_verification_signals;
CREATE TRIGGER "AgentVerificationSignal_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_verification_signals
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentOfficialLink_payload_cache_domains" ON public.agent_official_links;
CREATE TRIGGER "AgentOfficialLink_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_official_links
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentPaidService_payload_cache_domains" ON public.agent_paid_services;
CREATE TRIGGER "AgentPaidService_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_paid_services
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentGithubConnection_payload_cache_domains" ON public.agent_github_connections;
CREATE TRIGGER "AgentGithubConnection_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_github_connections
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentGithubSnapshot_payload_cache_domains" ON public.agent_github_snapshots;
CREATE TRIGGER "AgentGithubSnapshot_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_github_snapshots
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentGithubPushNote_payload_cache_domains" ON public.agent_github_push_notes;
CREATE TRIGGER "AgentGithubPushNote_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public.agent_github_push_notes
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "AgentRankSnapshot_payload_cache_domains" ON public."AgentRankSnapshot";
CREATE TRIGGER "AgentRankSnapshot_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."AgentRankSnapshot"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "ArHolderAgentPerk_payload_cache_domains" ON public."ArHolderAgentPerk";
CREATE TRIGGER "ArHolderAgentPerk_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."ArHolderAgentPerk"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "DaoLeaderboardLive_payload_cache_domains" ON public."DaoLeaderboardLive";
CREATE TRIGGER "DaoLeaderboardLive_payload_cache_domains"
AFTER INSERT OR DELETE OR UPDATE ON public."DaoLeaderboardLive"
FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();

DROP TRIGGER IF EXISTS "DaoLeaderboardLive_public_cache_domains" ON public."DaoLeaderboardLive";
CREATE TRIGGER "DaoLeaderboardLive_public_cache_domains"
AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON public."DaoLeaderboardLive"
FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();
