--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4 (Ubuntu 18.4-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: AccountCreditType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountCreditType" AS ENUM (
    'PLATFORM',
    'LLM'
);


--
-- Name: AgentChatConversationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatConversationStatus" AS ENUM (
    'ACTIVE',
    'ARCHIVED',
    'DELETED'
);


--
-- Name: AgentChatMessageRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatMessageRole" AS ENUM (
    'USER',
    'ASSISTANT',
    'SYSTEM'
);


--
-- Name: AgentChatMessageStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatMessageStatus" AS ENUM (
    'PENDING',
    'STREAMING',
    'COMPLETE',
    'FAILED',
    'CANCELLED'
);


--
-- Name: AgentChatRouteReason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatRouteReason" AS ENUM (
    'REQUESTED_MODEL_COMPATIBLE',
    'REQUESTED_MODEL_LACKS_TOOLS',
    'REQUESTED_MODEL_LACKS_VISION',
    'REQUESTED_MODEL_LACKS_WEB_SEARCH',
    'INSUFFICIENT_CONTEXT'
);


--
-- Name: AgentChatRunAttemptReason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatRunAttemptReason" AS ENUM (
    'INITIAL',
    'TOOL_LOOP',
    'ESCALATION'
);


--
-- Name: AgentChatRunAttemptStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatRunAttemptStatus" AS ENUM (
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: AgentChatRunLifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatRunLifecycle" AS ENUM (
    'PREPARING',
    'RESERVED',
    'STREAMING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: AgentChatSettlementStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatSettlementStatus" AS ENUM (
    'PENDING',
    'SETTLED'
);


--
-- Name: AgentChatTitleSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatTitleSource" AS ENUM (
    'USER',
    'GENERATED',
    'DEFAULT'
);


--
-- Name: AgentChatToolState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatToolState" AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT'
);


--
-- Name: AgentChatToolVisibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentChatToolVisibility" AS ENUM (
    'SUMMARY',
    'DEBUG',
    'HIDDEN'
);


--
-- Name: CommerceEventType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CommerceEventType" AS ENUM (
    'swap',
    'm2m_payment',
    'yield_deposit'
);


--
-- Name: CustodialWalletScope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CustodialWalletScope" AS ENUM (
    'ACCOUNT',
    'AGENT'
);


--
-- Name: IndexerBootstrapPhase; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."IndexerBootstrapPhase" AS ENUM (
    'IDENTITY',
    'METADATA',
    'TRUST',
    'DERIVED',
    'STEADY'
);


--
-- Name: IndexerBootstrapStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."IndexerBootstrapStatus" AS ENUM (
    'RUNNING',
    'COMPLETE',
    'DEGRADED',
    'FAILED'
);


--
-- Name: IndexerBootstrapWorkStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."IndexerBootstrapWorkStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETE',
    'TERMINAL_DEFERRED',
    'DEGRADED',
    'FAILED'
);


--
-- Name: LlmCreditDepositAsset; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LlmCreditDepositAsset" AS ENUM (
    'SOL',
    'USDC'
);


--
-- Name: LlmCreditDepositStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LlmCreditDepositStatus" AS ENUM (
    'CREATED',
    'AWAITING_PAYMENT',
    'CONFIRMING',
    'SETTLED',
    'UNDERPAID',
    'OVERPAID',
    'EXPIRED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: LlmReconciliationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LlmReconciliationStatus" AS ENUM (
    'NOT_APPLICABLE',
    'PENDING',
    'RETRYING',
    'RECONCILED',
    'ADJUSTED',
    'FAILED'
);


--
-- Name: LlmRunUsageStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LlmRunUsageStatus" AS ENUM (
    'PENDING',
    'COMPLETE',
    'FAILED',
    'CANCELLED'
);


--
-- Name: agentranking_bump_related_agent_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_bump_related_agent_score() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  affected_agent_id INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_agent_id := OLD."agentId";
  ELSE
    affected_agent_id := NEW."agentId";
  END IF;
  UPDATE "Agent"
  SET "score_state_version" = "score_state_version" + 1
  WHERE id = affected_agent_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: agentranking_enqueue_agent_score_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_enqueue_agent_score_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_agent_score(NEW.id);
  RETURN NEW;
END
$$;


--
-- Name: agentranking_guard_derived_score_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_guard_derived_score_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."score_materialized_version" IS NOT DISTINCT FROM OLD."score_materialized_version" THEN
    NEW."score_materialized_version" := 0;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: agentranking_invalidate_agent_payload_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_agent_payload_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_product_state JSONB;
  new_product_state JSONB;
  ignored_columns CONSTANT TEXT[] := ARRAY[
    'rank',
    'last_indexed_at',
    'registration_last_attempt_at',
    'registration_error_class',
    'registration_error_message',
    'registration_next_retry_at',
    'wallet_observed_block',
    'score_state_version',
    'score_materialized_version',
    'score_recalculated_at',
    'materialized_relation_fingerprint',
    'relation_materialization_generation',
    'feedback_source_digest',
    'feedback_observed_block',
    'solana_indexer_updated_at',
    'metaplex_last_indexed_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM agentranking_queue_agent_payload_domains(OLD."chainId", OLD."agentId", OLD."cluster_key");
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM agentranking_queue_agent_payload_domains(NEW."chainId", NEW."agentId", NEW."cluster_key");
    RETURN NEW;
  END IF;

  old_product_state := to_jsonb(OLD) - ignored_columns;
  new_product_state := to_jsonb(NEW) - ignored_columns;
  IF old_product_state IS NOT DISTINCT FROM new_product_state THEN
    RETURN NEW;
  END IF;

  IF OLD."chainId" IS DISTINCT FROM NEW."chainId"
     OR OLD."agentId" IS DISTINCT FROM NEW."agentId"
     OR OLD."cluster_key" IS DISTINCT FROM NEW."cluster_key" THEN
    PERFORM agentranking_queue_agent_payload_domains(OLD."chainId", OLD."agentId", OLD."cluster_key");
  END IF;
  PERFORM agentranking_queue_agent_payload_domains(NEW."chainId", NEW."agentId", NEW."cluster_key");
  RETURN NEW;
END
$$;


--
-- Name: agentranking_invalidate_agent_public_domains(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_agent_public_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  PERFORM agentranking_queue_cache_domain('stats:top-by-chain');
  PERFORM agentranking_queue_cache_domain('powerboost');
  PERFORM agentranking_queue_cache_domain('agents:list:web');
  PERFORM agentranking_queue_cache_domain('agents:list:v1');
  PERFORM agentranking_queue_cache_domain('agents:list:v2');
  RETURN NULL;
END
$$;


--
-- Name: agentranking_invalidate_feedback_domains(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_feedback_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  PERFORM agentranking_queue_cache_domain('stats:top-by-chain');
  PERFORM agentranking_queue_cache_domain('powerboost');
  PERFORM agentranking_queue_cache_domain('agents:list:web');
  PERFORM agentranking_queue_cache_domain('agents:list:v1');
  PERFORM agentranking_queue_cache_domain('agents:list:v2');
  RETURN NULL;
END
$$;


--
-- Name: agentranking_invalidate_global_ranks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_global_ranks() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('derived:global-ranks');
  RETURN NULL;
END
$$;


--
-- Name: agentranking_invalidate_promotion_domains(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_promotion_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  RETURN NULL;
END
$$;


--
-- Name: agentranking_invalidate_related_agent_payload_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_related_agent_payload_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_db_id INTEGER;
  target_chain_id INTEGER;
  target_agent_id INTEGER;
  target_cluster_key TEXT;
BEGIN
  target_db_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."agentId" ELSE NEW."agentId" END;
  SELECT a."chainId", a."agentId", a."cluster_key"
    INTO target_chain_id, target_agent_id, target_cluster_key
  FROM "Agent" a
  WHERE a.id = target_db_id;
  IF FOUND THEN
    PERFORM agentranking_queue_agent_payload_domains(target_chain_id, target_agent_id, target_cluster_key);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: agentranking_invalidate_sap_twin_index(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_invalidate_sap_twin_index() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('sap:twin-index');
  RETURN NULL;
END
$$;


--
-- Name: agentranking_mark_agent_score_dirty(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_mark_agent_score_dirty() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF jsonb_build_object(
      'name', OLD.name,
      'description', OLD.description,
      'image', OLD.image,
      'x402Support', OLD."x402Support",
      'binanceCompatible', OLD."binanceCompatible",
      'stars', OLD.stars,
      'lastActiveAt', OLD."lastActiveAt",
      'activityObservedAt', OLD."activity_observed_at",
      'walletHydrationStatus', OLD."wallet_hydration_status",
      'sourceQualityScore', OLD."source_quality_score",
      'sourceFeedbackCount', OLD."source_feedback_count",
      'sapLastSyncedAt', OLD."sap_last_synced_at",
      'isVerified', OLD."isVerified",
      'isPremiumVerified', OLD."isPremiumVerified",
      'sapVerified', OLD."sap_verified",
      'sapProtocols', OLD."sap_protocols",
      'sapStats', OLD."sap_stats",
      'hasDuplicateName', OLD."hasDuplicateName",
      'voteFireCount', OLD."voteFireCount",
      'votePooCount', OLD."votePooCount",
      'isVerifiedRevenue', OLD."isVerifiedRevenue",
      'verifiedWallet', OLD."verifiedWallet",
      'perfWinRate', OLD."perfWinRate",
      'perfMonthlyPnlUsd', OLD."perfMonthlyPnlUsd",
      'perfBurnToEarnRatio', OLD."perfBurnToEarnRatio",
      'perfTxCount', OLD."perfTxCount",
      'activeWinRate30d', OLD."activeWinRate30d",
      'nativeVolume30d', OLD."nativeVolume30d"
    ) IS DISTINCT FROM jsonb_build_object(
      'name', NEW.name,
      'description', NEW.description,
      'image', NEW.image,
      'x402Support', NEW."x402Support",
      'binanceCompatible', NEW."binanceCompatible",
      'stars', NEW.stars,
      'lastActiveAt', NEW."lastActiveAt",
      'activityObservedAt', NEW."activity_observed_at",
      'walletHydrationStatus', NEW."wallet_hydration_status",
      'sourceQualityScore', NEW."source_quality_score",
      'sourceFeedbackCount', NEW."source_feedback_count",
      'sapLastSyncedAt', NEW."sap_last_synced_at",
      'isVerified', NEW."isVerified",
      'isPremiumVerified', NEW."isPremiumVerified",
      'sapVerified', NEW."sap_verified",
      'sapProtocols', NEW."sap_protocols",
      'sapStats', NEW."sap_stats",
      'hasDuplicateName', NEW."hasDuplicateName",
      'voteFireCount', NEW."voteFireCount",
      'votePooCount', NEW."votePooCount",
      'isVerifiedRevenue', NEW."isVerifiedRevenue",
      'verifiedWallet', NEW."verifiedWallet",
      'perfWinRate', NEW."perfWinRate",
      'perfMonthlyPnlUsd', NEW."perfMonthlyPnlUsd",
      'perfBurnToEarnRatio', NEW."perfBurnToEarnRatio",
      'perfTxCount', NEW."perfTxCount",
      'activeWinRate30d', NEW."activeWinRate30d",
      'nativeVolume30d', NEW."nativeVolume30d"
    ) THEN
    NEW."score_state_version" := GREATEST(
      NEW."score_state_version",
      OLD."score_state_version" + 1
    );
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: agentranking_mark_agent_score_stale(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_mark_agent_score_stale() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW."score_state_version" := OLD."score_state_version" + 1;
  RETURN NEW;
END;
$$;


--
-- Name: agentranking_mark_related_agent_score_dirty(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_mark_related_agent_score_dirty() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_agent_id INTEGER;
  new_agent_id INTEGER;
BEGIN
  old_agent_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD."agentId" ELSE NULL END;
  new_agent_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW."agentId" ELSE NULL END;

  IF old_agent_id IS NOT NULL THEN
    UPDATE "Agent"
    SET "score_state_version" = "score_state_version" + 1
    WHERE id = old_agent_id;
  END IF;
  IF new_agent_id IS NOT NULL AND new_agent_id IS DISTINCT FROM old_agent_id THEN
    UPDATE "Agent"
    SET "score_state_version" = "score_state_version" + 1
    WHERE id = new_agent_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;


--
-- Name: agentranking_queue_agent_payload_domains(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_queue_agent_payload_domains(target_chain_id integer, target_agent_id integer, target_cluster_key text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain(
    'agent:detail:' || target_chain_id::text || ':' || target_agent_id::text
  );
  PERFORM agentranking_queue_cache_domain(
    'agent:cluster:handle:' || target_chain_id::text || ':' || target_agent_id::text
  );
  IF target_cluster_key IS NOT NULL AND trim(target_cluster_key) <> '' THEN
    PERFORM agentranking_queue_cache_domain('agent:cluster:key:' || target_cluster_key);
  END IF;
END
$$;


--
-- Name: agentranking_queue_agent_score(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_queue_agent_score(target_agent_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF target_agent_id IS NOT NULL THEN
    PERFORM agentranking_queue_cache_domain('derived:agent-score:' || target_agent_id::text);
  END IF;
END
$$;


--
-- Name: agentranking_queue_cache_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_queue_cache_domain(target_domain text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_revision BIGINT;
BEGIN
  INSERT INTO "cache_domain_revisions" (domain, revision, changed_at)
  VALUES (target_domain, 1, now())
  ON CONFLICT (domain) DO UPDATE
    SET revision = "cache_domain_revisions".revision + 1,
        changed_at = now()
  RETURNING revision INTO next_revision;

  INSERT INTO "cache_invalidation_outbox" (domain, revision, created_at)
  VALUES (target_domain, next_revision, now())
  ON CONFLICT (domain) WHERE delivered_at IS NULL DO UPDATE
    SET revision = EXCLUDED.revision,
        created_at = EXCLUDED.created_at;

  PERFORM pg_notify('cache_invalidation', target_domain || ':' || next_revision::text);
  RETURN next_revision;
END
$$;


--
-- Name: agentranking_refresh_duplicate_name_group(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_refresh_duplicate_name_group(target_normalized_name text) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE "Agent" a
  SET "hasDuplicateName" = (
    SELECT COUNT(*) > 1
    FROM "Agent" peer
    WHERE lower(trim(peer.name)) = target_normalized_name
  )
  WHERE lower(trim(a.name)) = target_normalized_name
    AND a."hasDuplicateName" IS DISTINCT FROM (
      SELECT COUNT(*) > 1
      FROM "Agent" peer
      WHERE lower(trim(peer.name)) = target_normalized_name
    )
$$;


--
-- Name: agentranking_refresh_duplicate_names_for_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agentranking_refresh_duplicate_names_for_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM agentranking_refresh_duplicate_name_group(lower(trim(OLD.name)));
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND lower(trim(OLD.name)) IS DISTINCT FROM lower(trim(NEW.name)) THEN
    PERFORM agentranking_refresh_duplicate_name_group(lower(trim(OLD.name)));
  END IF;

  PERFORM agentranking_refresh_duplicate_name_group(lower(trim(NEW.name)));
  RETURN NEW;
END
$$;


--
-- Name: record_indexer_bootstrap_first_agent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_indexer_bootstrap_first_agent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE "indexer_bootstrap_epochs"
  SET "first_agent_materialized_at" = CURRENT_TIMESTAMP,
      "first_agent_db_id" = NEW."id"
  WHERE "id" = (
    SELECT "id"
    FROM "indexer_bootstrap_epochs"
    WHERE "status" = 'RUNNING'
      AND "phase" = 'IDENTITY'
      AND "first_agent_materialized_at" IS NULL
    ORDER BY "started_at" DESC, "id" DESC
    LIMIT 1
  );
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: AdOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdOrder" (
    id integer NOT NULL,
    "bannerUrl" text NOT NULL,
    "linkUrl" text DEFAULT ''::text NOT NULL,
    days integer NOT NULL,
    "txHash" text NOT NULL,
    "paidAmount" text NOT NULL,
    currency text DEFAULT 'ETH'::text NOT NULL,
    "paymentToken" text DEFAULT 'ETH'::text NOT NULL,
    wallet text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "orderNumber" text
);


--
-- Name: AdOrderSquare; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdOrderSquare" (
    id integer NOT NULL,
    "bannerUrl" text DEFAULT ''::text NOT NULL,
    "linkUrl" text DEFAULT ''::text NOT NULL,
    days integer NOT NULL,
    "txHash" text NOT NULL,
    "paidAmount" text NOT NULL,
    currency text DEFAULT 'ETH'::text NOT NULL,
    "paymentToken" text DEFAULT 'ETH'::text NOT NULL,
    wallet text NOT NULL,
    "orderNumber" text,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "adIconKey" text DEFAULT 'shield'::text NOT NULL,
    "adAccentColor" text DEFAULT '#22c55e'::text NOT NULL
);


--
-- Name: AdOrderSquare_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AdOrderSquare_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AdOrderSquare_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AdOrderSquare_id_seq" OWNED BY public."AdOrderSquare".id;


--
-- Name: AdOrderStrip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdOrderStrip" (
    id integer NOT NULL,
    "adText" text DEFAULT ''::text NOT NULL,
    "bannerUrl" text DEFAULT ''::text NOT NULL,
    "linkUrl" text DEFAULT ''::text NOT NULL,
    days integer NOT NULL,
    "txHash" text NOT NULL,
    "paidAmount" text NOT NULL,
    currency text DEFAULT 'ETH'::text NOT NULL,
    "paymentToken" text DEFAULT 'ETH'::text NOT NULL,
    wallet text NOT NULL,
    "orderNumber" text,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "adIconKey" text DEFAULT 'shield'::text NOT NULL,
    "adAccentColor" text DEFAULT '#22c55e'::text NOT NULL
);


--
-- Name: AdOrderStrip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AdOrderStrip_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AdOrderStrip_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AdOrderStrip_id_seq" OWNED BY public."AdOrderStrip".id;


--
-- Name: AdOrder_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AdOrder_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AdOrder_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AdOrder_id_seq" OWNED BY public."AdOrder".id;


--
-- Name: AdPackage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdPackage" (
    id integer NOT NULL,
    "orderId" text NOT NULL,
    tier text NOT NULL,
    "bannerUrl" text DEFAULT ''::text NOT NULL,
    "linkUrl" text DEFAULT ''::text NOT NULL,
    "adText" text DEFAULT ''::text NOT NULL,
    "tweetCount" integer DEFAULT 0 NOT NULL,
    "durationDays" integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "stripAdvertiserName" text DEFAULT ''::text NOT NULL,
    "vipAd" boolean DEFAULT false NOT NULL,
    "adIconKey" text DEFAULT 'shield'::text NOT NULL,
    "adAccentColor" text DEFAULT '#22c55e'::text NOT NULL
);


--
-- Name: AdPackage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AdPackage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AdPackage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AdPackage_id_seq" OWNED BY public."AdPackage".id;


--
-- Name: AdminLoginChallenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminLoginChallenge" (
    id text NOT NULL,
    "tokenHash" text NOT NULL,
    "codeHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "requestIp" text
);


--
-- Name: Agent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Agent" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "chainId" integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image text DEFAULT ''::text NOT NULL,
    "agentURI" text DEFAULT ''::text NOT NULL,
    owner text DEFAULT ''::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "isVerified" boolean DEFAULT false NOT NULL,
    score double precision DEFAULT 0 NOT NULL,
    "hotScore" double precision DEFAULT 0 NOT NULL,
    rank integer DEFAULT 0 NOT NULL,
    "x402Support" boolean DEFAULT false NOT NULL,
    stars integer DEFAULT 0 NOT NULL,
    "totalFeedback" integer DEFAULT 0 NOT NULL,
    "totalMessages" integer DEFAULT 0 NOT NULL,
    "totalChats" integer DEFAULT 0 NOT NULL,
    "totalWatches" integer DEFAULT 0 NOT NULL,
    "scoreQuality" double precision DEFAULT 0 NOT NULL,
    "scorePopularity" double precision DEFAULT 0 NOT NULL,
    "scoreActivity" double precision DEFAULT 0 NOT NULL,
    "scoreWallet" double precision DEFAULT 0 NOT NULL,
    "scoreFreshness" double precision DEFAULT 0 NOT NULL,
    "scoreMetadata" double precision DEFAULT 0 NOT NULL,
    "supportedTrust" text DEFAULT 'reputation'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastActiveAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "scoreServices" double precision DEFAULT 0 NOT NULL,
    "isCustomListed" boolean DEFAULT false NOT NULL,
    "isPremiumVerified" boolean DEFAULT false NOT NULL,
    "binanceCompatible" boolean DEFAULT false NOT NULL,
    "hasDuplicateName" boolean DEFAULT false NOT NULL,
    "powerScore" double precision DEFAULT 0 NOT NULL,
    "activeBoosts" integer DEFAULT 0 NOT NULL,
    "voteFireCount" integer DEFAULT 0 NOT NULL,
    "votePooCount" integer DEFAULT 0 NOT NULL,
    "tokenAddress" text DEFAULT ''::text NOT NULL,
    "listedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    archetype text DEFAULT ''::text NOT NULL,
    "archetypeAuto" boolean DEFAULT false NOT NULL,
    "adminPowerAdjust" integer DEFAULT 0 NOT NULL,
    "verifiedWallet" text DEFAULT ''::text NOT NULL,
    "verifiedWalletAt" timestamp(3) without time zone,
    "verifiedWalletChainId" integer,
    "perfWinRate" double precision,
    "perfAvgPnlPercent" double precision,
    "perfBurnToEarnRatio" double precision,
    "perfTotalVolumeUsd" double precision,
    "perfMonthlyPnlUsd" double precision,
    "perfLastComputedAt" timestamp(3) without time zone,
    "isVerifiedRevenue" boolean DEFAULT false NOT NULL,
    "verifiedRevenueAt" timestamp(3) without time zone,
    "perfTxCount" integer,
    "perfProfitableTxCount" integer,
    "recentActivity" jsonb,
    "activityUpdatedAt" timestamp(3) without time zone,
    "activeWinRate30d" double precision,
    "nativeVolume30d" double precision,
    "isSmartBatchEnabled" boolean DEFAULT false NOT NULL,
    "agentRankScore" double precision DEFAULT 0 NOT NULL,
    "activityScore" double precision DEFAULT 0 NOT NULL,
    "agentMode" text DEFAULT 'unknown'::text NOT NULL,
    "protocolTrustScore" integer DEFAULT 0 NOT NULL,
    "executionScore" integer DEFAULT 0 NOT NULL,
    "verifiedRevenueExpiresAt" timestamp(3) without time zone,
    listing_registry_source text DEFAULT 'default'::text NOT NULL,
    sap_verified boolean DEFAULT false NOT NULL,
    sap_agent_pda text,
    sap_stats_pda text,
    sap_capabilities jsonb,
    sap_pricing_tiers jsonb,
    sap_protocols text[] DEFAULT ARRAY[]::text[] NOT NULL,
    sap_x402_endpoint text,
    sap_registration_tx text,
    sap_last_synced_at timestamp(3) without time zone,
    sap_stats jsonb,
    sap_owner_wallet text,
    sap_registered_at timestamp(3) without time zone,
    public_referral_code text,
    public_referral_destination text DEFAULT ''::text NOT NULL,
    public_referral_info text DEFAULT ''::text NOT NULL,
    discovery_score double precision DEFAULT 0 NOT NULL,
    public_verification_status text DEFAULT 'unverified'::text NOT NULL,
    cluster_key text,
    metaplex_source_type text DEFAULT 'agent-registry'::text NOT NULL,
    metaplex_asset_address text,
    metaplex_agent_identity_pda text,
    metaplex_agent_registration_uri text,
    metaplex_agent_token_mint text,
    metaplex_asset_signer_pda text,
    metaplex_verified boolean DEFAULT false NOT NULL,
    metaplex_token_binding_status text DEFAULT 'unbound'::text NOT NULL,
    metaplex_supported_trust text[] DEFAULT ARRAY[]::text[] NOT NULL,
    metaplex_active boolean,
    metaplex_raw_data jsonb,
    metaplex_last_indexed_at timestamp(3) without time zone,
    metaplex_launch_address text,
    metaplex_launch_type text,
    metaplex_launch_status text,
    metaplex_bonding_progress_pct double precision,
    metaplex_bonding_progress_source text,
    metaplex_bonding_progress_updated_at timestamp(3) without time zone,
    metaplex_trade_url text,
    metaplex_has_dex_pair boolean,
    work_ready_status text DEFAULT 'none'::text NOT NULL,
    work_ready_reasons jsonb,
    featured_work_ready boolean DEFAULT false NOT NULL,
    work_ready_updated_at timestamp(3) without time zone,
    owner_account_id text,
    agent_wallet_id text,
    ar_verification_status text DEFAULT 'unverified'::text NOT NULL,
    ar_verified_at timestamp(3) without time zone,
    ar_verification_tx_signature text,
    ar_verification_fee_lamports bigint,
    ar_verification_wallet text,
    ar_verification_recipient text,
    evm_wallet_address text,
    evm_privy_wallet_id text,
    evm_wallet_provider text DEFAULT 'custodial'::text NOT NULL,
    evm_wallet_status text DEFAULT 'not_configured'::text NOT NULL,
    evm_wallet_created_at timestamp(3) without time zone,
    agent_evm_wallet_id text,
    protocol_agent_id text,
    registered_owner text DEFAULT ''::text NOT NULL,
    declared_active boolean,
    declared_x402_support boolean,
    source_evidence_type text,
    source_finality text,
    source_block_number bigint,
    source_block_hash text,
    source_transaction_hash text,
    source_transaction_index integer,
    source_log_index integer,
    registration_raw_digest text,
    registration_semantic_fingerprint text,
    solana_asset_address text,
    solana_sequence_id bigint,
    solana_canonical_status text,
    solana_commitment text,
    solana_slot bigint,
    solana_transaction_signature text,
    solana_event_ordinal integer,
    solana_official_rank bigint,
    solana_atom_trust_tier text,
    solana_indexer_updated_at timestamp(3) with time zone,
    solana_block_time timestamp(3) with time zone,
    registration_normalized_uri text,
    registration_content_address text,
    chain_identity_fingerprint text,
    chain_relation_fingerprint text,
    chain_metrics_fingerprint text,
    score_social double precision DEFAULT 0 NOT NULL,
    score_compliance double precision DEFAULT 0 NOT NULL,
    source_active boolean,
    source_lifecycle_status text,
    moderation_status text DEFAULT 'inherit'::text NOT NULL,
    administrative_active_override boolean,
    publicly_active boolean DEFAULT true NOT NULL,
    identity_updated_at timestamp(3) with time zone,
    metadata_updated_at timestamp(3) with time zone,
    activity_observed_at timestamp(3) with time zone,
    last_indexed_at timestamp(3) with time zone,
    registration_status text,
    registration_last_success_at timestamp(3) with time zone,
    registration_last_attempt_at timestamp(3) with time zone,
    registration_error_class text,
    registration_error_message text,
    registration_next_retry_at timestamp(3) with time zone,
    feedback_source_digest text,
    feedback_observed_block bigint,
    score_verified_revenue double precision DEFAULT 0 NOT NULL,
    source_registry_address text,
    source_quality_score double precision,
    source_feedback_count integer,
    wallet_hydration_status text DEFAULT 'pending'::text NOT NULL,
    wallet_capability_status text,
    wallet_observed_block bigint,
    score_state_version bigint DEFAULT 1 NOT NULL,
    score_materialized_version bigint DEFAULT 0 NOT NULL,
    score_recalculated_at timestamp(3) with time zone,
    materialized_relation_fingerprint text,
    relation_materialization_generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT "Agent_relation_materialization_generation_check" CHECK ((relation_materialization_generation >= 0)),
    CONSTRAINT "Agent_source_feedback_count_domain_check" CHECK (((source_feedback_count IS NULL) OR (source_feedback_count >= 0))),
    CONSTRAINT "Agent_source_quality_score_domain_check" CHECK (((source_quality_score IS NULL) OR ((source_quality_score >= (0)::double precision) AND (source_quality_score <= (100)::double precision)))),
    CONSTRAINT "Agent_wallet_hydration_status_check" CHECK ((wallet_hydration_status = ANY (ARRAY['present'::text, 'absent'::text, 'unsupported'::text, 'pending'::text, 'transient_error'::text, 'contract_error'::text, 'malformed'::text])))
);


--
-- Name: AgentAlertRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentAlertRule" (
    id integer NOT NULL,
    "userProfileId" integer NOT NULL,
    "agentId" integer,
    "webhookUrl" text NOT NULL,
    secret text,
    "eventTypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AgentAlertRule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentAlertRule_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentAlertRule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentAlertRule_id_seq" OWNED BY public."AgentAlertRule".id;


--
-- Name: AgentAnalyticsEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentAnalyticsEvent" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "eventType" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "serviceId" integer
);


--
-- Name: AgentAnalyticsEvent_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentAnalyticsEvent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentAnalyticsEvent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentAnalyticsEvent_id_seq" OWNED BY public."AgentAnalyticsEvent".id;


--
-- Name: AgentBlocklistRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentBlocklistRule" (
    id text NOT NULL,
    "matchType" text NOT NULL,
    value text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AgentBoost; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentBoost" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "boostUnits" integer NOT NULL,
    "paidUsd" double precision DEFAULT 0 NOT NULL,
    "txHash" text NOT NULL,
    wallet text DEFAULT ''::text NOT NULL,
    "orderNumber" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "orderId" text
);


--
-- Name: AgentBoost_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentBoost_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentBoost_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentBoost_id_seq" OWNED BY public."AgentBoost".id;


--
-- Name: AgentChainVerification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentChainVerification" (
    id integer NOT NULL,
    "chainId" integer NOT NULL,
    "agentId" integer NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    score integer,
    validator text DEFAULT ''::text NOT NULL,
    tag text DEFAULT ''::text NOT NULL,
    "attestedAt" timestamp(3) without time zone,
    "txHash" text DEFAULT ''::text NOT NULL,
    protocol_agent_id text,
    request_hash text,
    request_uri text,
    response_uri text,
    response_hash text,
    has_response boolean,
    source_block_number bigint,
    source_block_hash text,
    source_transaction_index integer,
    source_log_index integer,
    source_finality text,
    source_registry text
);


--
-- Name: AgentChainVerification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentChainVerification_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentChainVerification_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentChainVerification_id_seq" OWNED BY public."AgentChainVerification".id;


--
-- Name: AgentMcpOffer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentMcpOffer" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    title text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    "priceLabel" text DEFAULT ''::text NOT NULL,
    "ctaUrl" text DEFAULT ''::text NOT NULL,
    "linkedServiceId" integer,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isPublished" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AgentMcpOffer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentMcpOffer_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentMcpOffer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentMcpOffer_id_seq" OWNED BY public."AgentMcpOffer".id;


--
-- Name: AgentMetadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentMetadata" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    source_kind text,
    source_digest text,
    chain_controlled boolean DEFAULT false NOT NULL
);


--
-- Name: AgentMetadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentMetadata_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentMetadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentMetadata_id_seq" OWNED BY public."AgentMetadata".id;


--
-- Name: AgentPerfSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentPerfSnapshot" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "capturedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "txCount" integer DEFAULT 0 NOT NULL,
    "profitableTxCount" integer DEFAULT 0 NOT NULL,
    "grossProfitUsd" double precision DEFAULT 0 NOT NULL,
    "totalFeesUsd" double precision DEFAULT 0 NOT NULL,
    "totalGasUsd" double precision DEFAULT 0 NOT NULL,
    "netPnlUsd" double precision DEFAULT 0 NOT NULL,
    "volumeUsd" double precision DEFAULT 0 NOT NULL,
    "winRate" double precision DEFAULT 0 NOT NULL,
    "burnToEarnRatio" double precision DEFAULT 0 NOT NULL,
    "avgPnlPercent" double precision DEFAULT 0 NOT NULL,
    "rawStatsJson" jsonb
);


--
-- Name: AgentPerfSnapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentPerfSnapshot_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentPerfSnapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentPerfSnapshot_id_seq" OWNED BY public."AgentPerfSnapshot".id;


--
-- Name: AgentRankSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentRankSnapshot" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    rank integer NOT NULL,
    score double precision NOT NULL,
    "capturedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "archetypeRank" integer,
    "agentRankScore" integer DEFAULT 0 NOT NULL
);


--
-- Name: AgentRankSnapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentRankSnapshot_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentRankSnapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentRankSnapshot_id_seq" OWNED BY public."AgentRankSnapshot".id;


--
-- Name: AgentReport; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentReport" (
    id text NOT NULL,
    "agentDbId" integer NOT NULL,
    "chainId" integer NOT NULL,
    "onChainAgentId" integer NOT NULL,
    "pageUrl" text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    details text NOT NULL,
    "reporterIpHash" text DEFAULT ''::text NOT NULL,
    "reporterWallet" text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    "adminNotes" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AgentService; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentService" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    name text NOT NULL,
    endpoint text DEFAULT ''::text NOT NULL,
    version text DEFAULT ''::text NOT NULL,
    source_name text,
    normalized_type text,
    source_endpoint text,
    endpoint_kind text,
    endpoint_valid boolean,
    source_version text,
    source_digest text,
    source_kind text,
    skills jsonb,
    domains jsonb,
    capabilities jsonb,
    extensions jsonb
);


--
-- Name: AgentService_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentService_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentService_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentService_id_seq" OWNED BY public."AgentService".id;


--
-- Name: AgentStar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentStar" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "walletAddress" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AgentStar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentStar_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentStar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentStar_id_seq" OWNED BY public."AgentStar".id;


--
-- Name: AgentVerificationRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentVerificationRequest" (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    "agentName" text NOT NULL,
    "xHandle" text NOT NULL,
    "xUserId" text,
    "walletAddress" text NOT NULL,
    website text DEFAULT ''::text NOT NULL,
    "tokenAddress" text DEFAULT ''::text NOT NULL,
    "proofNotes" text DEFAULT ''::text NOT NULL,
    "paymentStatus" text DEFAULT 'pending'::text NOT NULL,
    "verificationStatus" text DEFAULT 'submitted'::text NOT NULL,
    "submittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "reviewedAt" timestamp(3) without time zone,
    "reviewerNote" text DEFAULT ''::text NOT NULL,
    "userProfileId" integer,
    "reviewedByAdmin" text
);


--
-- Name: AgentVote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AgentVote" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "ipHash" text NOT NULL,
    "voteType" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AgentVote_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgentVote_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgentVote_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgentVote_id_seq" OWNED BY public."AgentVote".id;


--
-- Name: Agent_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Agent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Agent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Agent_id_seq" OWNED BY public."Agent".id;


--
-- Name: ArHolderAgentPerk; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArHolderAgentPerk" (
    id text NOT NULL,
    wallet text NOT NULL,
    "agentId" integer NOT NULL,
    "perkType" text NOT NULL,
    "tierId" text NOT NULL,
    "boostUnits" integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "periodKey" text DEFAULT ''::text NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ArPayoutBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArPayoutBatch" (
    id text NOT NULL,
    title text NOT NULL,
    "perkSlug" text DEFAULT ''::text NOT NULL,
    asset text DEFAULT 'AR'::text NOT NULL,
    "amountMode" text DEFAULT 'fixed'::text NOT NULL,
    "amountValue" text DEFAULT '0'::text NOT NULL,
    "totalAmount" text DEFAULT '0'::text NOT NULL,
    "recipientCount" integer DEFAULT 0 NOT NULL,
    recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "txSignatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "adminNotes" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArPayoutWallet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArPayoutWallet" (
    id text NOT NULL,
    label text NOT NULL,
    wallet text NOT NULL,
    asset text DEFAULT 'SOL'::text NOT NULL,
    purpose text DEFAULT 'rewards'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArReferralAdjustment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArReferralAdjustment" (
    id text NOT NULL,
    "referralCodeId" text NOT NULL,
    amount integer NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    "adminNote" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ArReferralCode; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArReferralCode" (
    id text NOT NULL,
    code text NOT NULL,
    "ownerWallet" text NOT NULL,
    "userProfileId" integer,
    destination text DEFAULT 'https://stake.agentranking.io'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArReferralCommission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArReferralCommission" (
    id text NOT NULL,
    "referralCodeId" text NOT NULL,
    "referrerWallet" text NOT NULL,
    "referredWallet" text DEFAULT ''::text NOT NULL,
    "referredEmail" text DEFAULT ''::text NOT NULL,
    "orderId" text,
    "orderNumber" text DEFAULT ''::text NOT NULL,
    "productType" text NOT NULL,
    "productLabel" text DEFAULT ''::text NOT NULL,
    "orderUsd" double precision NOT NULL,
    "commissionPct" double precision NOT NULL,
    "commissionUsd" double precision NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "paidAt" timestamp(3) without time zone,
    "adminNote" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    idempotency_key text NOT NULL
);


--
-- Name: ArReferralEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArReferralEvent" (
    id text NOT NULL,
    "referralCodeId" text NOT NULL,
    "referrerWallet" text NOT NULL,
    "referredWallet" text DEFAULT ''::text NOT NULL,
    "referredUserProfileId" integer,
    "eventType" text DEFAULT 'visit'::text NOT NULL,
    "conversionStatus" text DEFAULT 'pending'::text NOT NULL,
    "ipHash" text DEFAULT ''::text NOT NULL,
    "userAgentHash" text DEFAULT ''::text NOT NULL,
    "spamReason" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ArStakePerkOverride; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArStakePerkOverride" (
    id text NOT NULL,
    wallet text NOT NULL,
    "perkSlug" text NOT NULL,
    "overrideType" text DEFAULT 'force_unlock'::text NOT NULL,
    "adminNote" text DEFAULT ''::text NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArStakePerkRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArStakePerkRule" (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    "perkSlug" text NOT NULL,
    "minStakeRaw" text DEFAULT '0'::text NOT NULL,
    "minLockDays" integer DEFAULT 0 NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArStakePosition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArStakePosition" (
    id text NOT NULL,
    wallet text NOT NULL,
    "poolAddress" text DEFAULT ''::text NOT NULL,
    "stakeAccount" text DEFAULT ''::text NOT NULL,
    "mintAddress" text DEFAULT ''::text NOT NULL,
    "amountRaw" text DEFAULT '0'::text NOT NULL,
    "amountUi" text DEFAULT '0'::text NOT NULL,
    nonce integer DEFAULT 0 NOT NULL,
    "durationSec" integer DEFAULT 0 NOT NULL,
    "lockStartAt" timestamp(3) without time zone,
    "lockEndAt" timestamp(3) without time zone,
    "txSignature" text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'client_report'::text NOT NULL,
    "adminNote" text DEFAULT ''::text NOT NULL,
    "lastSyncedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArTokenHolderSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArTokenHolderSnapshot" (
    id text NOT NULL,
    wallet text NOT NULL,
    "tokenBalanceRaw" text DEFAULT '0'::text NOT NULL,
    "tokenBalanceUi" text DEFAULT '0'::text NOT NULL,
    "achievedTier" text DEFAULT ''::text NOT NULL,
    "eligiblePerks" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "referralCount" integer DEFAULT 0 NOT NULL,
    "manualReferralAdjust" integer DEFAULT 0 NOT NULL,
    "paidVerifiedAgentCount" integer DEFAULT 0 NOT NULL,
    "claimedAgentCount" integer DEFAULT 0 NOT NULL,
    "profilePath" text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "lastSyncedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArTokenMetricEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArTokenMetricEvent" (
    id text NOT NULL,
    "eventType" text NOT NULL,
    "amountToken" text DEFAULT ''::text NOT NULL,
    "amountUsd" text DEFAULT ''::text NOT NULL,
    wallet text DEFAULT ''::text NOT NULL,
    "txHash" text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "occurredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArTokenPerkConfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArTokenPerkConfig" (
    id text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    "shortTitle" text DEFAULT ''::text NOT NULL,
    description text NOT NULL,
    "rewardSummary" text DEFAULT ''::text NOT NULL,
    "minBalanceRaw" text DEFAULT '0'::text NOT NULL,
    "maxBalanceRaw" text DEFAULT '0'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "displayOrder" integer DEFAULT 0 NOT NULL,
    "ctaLabel" text DEFAULT ''::text NOT NULL,
    "ctaHref" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ArTokenSettings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ArTokenSettings" (
    id integer DEFAULT 1 NOT NULL,
    "launchStatus" text DEFAULT 'prelaunch'::text NOT NULL,
    "tokenAddress" text DEFAULT ''::text NOT NULL,
    "pairAddress" text DEFAULT ''::text NOT NULL,
    "dexScreenerUrl" text DEFAULT ''::text NOT NULL,
    "pumpFunUrl" text DEFAULT ''::text NOT NULL,
    "buyUrl" text DEFAULT ''::text NOT NULL,
    "treasuryWallet" text DEFAULT ''::text NOT NULL,
    "rewardsWallet" text DEFAULT ''::text NOT NULL,
    "buybackWallet" text DEFAULT ''::text NOT NULL,
    "burnWallet" text DEFAULT ''::text NOT NULL,
    "liquidityWallet" text DEFAULT ''::text NOT NULL,
    "holderAccessThreshold" text DEFAULT ''::text NOT NULL,
    "stakingEnabled" boolean DEFAULT false NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "tokenChainId" integer DEFAULT 0 NOT NULL,
    "tokenDecimals" integer DEFAULT 18 NOT NULL,
    "tokenLedger" text DEFAULT 'evm'::text NOT NULL,
    "solanaCluster" text DEFAULT 'mainnet-beta'::text NOT NULL
);


--
-- Name: Bounty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Bounty" (
    id text NOT NULL,
    "posterWallet" text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text NOT NULL,
    "usdcAmount" double precision NOT NULL,
    "escrowTx" text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    "claimedByAgentId" integer,
    "completionEvidence" jsonb,
    deadline timestamp(3) without time zone NOT NULL,
    "verificationCriteria" text DEFAULT ''::text NOT NULL,
    "contactInfo" text DEFAULT ''::text NOT NULL,
    "taskType" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "posterEmail" text DEFAULT ''::text NOT NULL,
    "claimedAt" timestamp(3) without time zone,
    "autoReleaseAt" timestamp(3) without time zone
);


--
-- Name: BountyDispute; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BountyDispute" (
    id text NOT NULL,
    "bountyId" text NOT NULL,
    "raisedBy" text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Chain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Chain" (
    id integer NOT NULL,
    "chainId" integer NOT NULL,
    name text NOT NULL,
    "shortName" text NOT NULL,
    icon text DEFAULT ''::text NOT NULL,
    color text DEFAULT '#888'::text NOT NULL,
    "identityRegistry" text DEFAULT ''::text NOT NULL,
    "reputationRegistry" text DEFAULT ''::text NOT NULL,
    "agentCount" integer DEFAULT 0 NOT NULL,
    "feedbackCount" integer DEFAULT 0 NOT NULL,
    "lastSyncedBlock" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    last_synced_block_hash text,
    last_finalized_block bigint,
    last_finalized_block_hash text,
    finality_policy text,
    indexing_enabled boolean DEFAULT true NOT NULL,
    "validationRegistry" text DEFAULT ''::text NOT NULL,
    onchain_feedback_count integer DEFAULT 0 NOT NULL,
    site_feedback_count integer DEFAULT 0 NOT NULL,
    source_config_digest text
);


--
-- Name: Chain_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Chain_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Chain_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Chain_id_seq" OWNED BY public."Chain".id;


--
-- Name: ContactInquiry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ContactInquiry" (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    message text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    "userId" integer
);


--
-- Name: ContactInquiryReply; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ContactInquiryReply" (
    id integer NOT NULL,
    "inquiryId" integer NOT NULL,
    body text NOT NULL,
    "authorRole" text DEFAULT 'admin'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "readByAdmin" boolean DEFAULT false NOT NULL,
    "readByUser" boolean DEFAULT false NOT NULL
);


--
-- Name: ContactInquiryReply_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ContactInquiryReply_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ContactInquiryReply_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ContactInquiryReply_id_seq" OWNED BY public."ContactInquiryReply".id;


--
-- Name: ContactInquiry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ContactInquiry_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ContactInquiry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ContactInquiry_id_seq" OWNED BY public."ContactInquiry".id;


--
-- Name: ConversionEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ConversionEvent" (
    id integer NOT NULL,
    "eventType" text NOT NULL,
    path text DEFAULT ''::text,
    "productType" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    idempotency_key text
);


--
-- Name: ConversionEvent_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ConversionEvent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ConversionEvent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ConversionEvent_id_seq" OWNED BY public."ConversionEvent".id;


--
-- Name: DaoLeaderboardLive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DaoLeaderboardLive" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "daoVotes" integer DEFAULT 0 NOT NULL,
    "stakingVotes" integer DEFAULT 0 NOT NULL,
    "adminVotes" integer DEFAULT 0 NOT NULL,
    "paidBoostVotes" integer DEFAULT 0 NOT NULL,
    rank integer DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'aggregated'::text NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL
);


--
-- Name: DaoLeaderboardLive_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DaoLeaderboardLive_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DaoLeaderboardLive_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DaoLeaderboardLive_id_seq" OWNED BY public."DaoLeaderboardLive".id;


--
-- Name: DaoLeaderboardSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DaoLeaderboardSnapshot" (
    id integer NOT NULL,
    "capturedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "periodKey" text DEFAULT 'day'::text NOT NULL,
    "agentId" integer NOT NULL,
    "daoVotes" integer DEFAULT 0 NOT NULL,
    "stakingVotes" integer DEFAULT 0 NOT NULL,
    "adminVotes" integer DEFAULT 0 NOT NULL,
    rank integer DEFAULT 0 NOT NULL
);


--
-- Name: DaoLeaderboardSnapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DaoLeaderboardSnapshot_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DaoLeaderboardSnapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DaoLeaderboardSnapshot_id_seq" OWNED BY public."DaoLeaderboardSnapshot".id;


--
-- Name: Feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Feedback" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "clientAddress" text NOT NULL,
    "feedbackIndex" integer,
    value double precision DEFAULT 5 NOT NULL,
    "valueDecimals" integer DEFAULT 0 NOT NULL,
    tag1 text DEFAULT ''::text NOT NULL,
    tag2 text DEFAULT ''::text NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    raw_value text,
    exact_value text,
    revoked boolean DEFAULT false NOT NULL,
    source_registry text,
    source_tx_hash text,
    source_block_number bigint,
    source_block_hash text,
    source_transaction_index integer,
    source_log_index integer,
    source_finality text,
    chain_submitted_at timestamp(3) with time zone,
    document_declared_at timestamp(3) with time zone,
    document_fetched_at timestamp(3) with time zone,
    quality_eligible boolean DEFAULT true NOT NULL
);


--
-- Name: Feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Feedback_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Feedback_id_seq" OWNED BY public."Feedback".id;


--
-- Name: MeshSignal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MeshSignal" (
    id text NOT NULL,
    "publisherAgentId" integer NOT NULL,
    payload jsonb NOT NULL,
    "signalType" text DEFAULT ''::text NOT NULL,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: MeshSubscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MeshSubscription" (
    id text NOT NULL,
    "subscriberAgentId" integer NOT NULL,
    "publisherAgentId" integer NOT NULL,
    "webhookEndpoint" text DEFAULT ''::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Order" (
    id text NOT NULL,
    "orderNumber" text NOT NULL,
    "productType" text NOT NULL,
    tier text NOT NULL,
    "usdPrice" double precision NOT NULL,
    "paymentAsset" text DEFAULT 'USDC'::text NOT NULL,
    "chainId" integer DEFAULT 8453 NOT NULL,
    "cryptoAmount" text NOT NULL,
    wallet text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    "txHash" text,
    status text DEFAULT 'pending'::text NOT NULL,
    "agentId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paidAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "bannerUrl" text DEFAULT ''::text NOT NULL,
    "linkUrl" text DEFAULT ''::text NOT NULL,
    "adText" text DEFAULT ''::text NOT NULL,
    "imageUrl" text DEFAULT ''::text NOT NULL,
    "tokenAddress" text DEFAULT ''::text NOT NULL,
    "kyaDescription" text DEFAULT ''::text NOT NULL,
    "kyaMetadata" text DEFAULT '{}'::text NOT NULL,
    "kyaServices" text DEFAULT '[]'::text NOT NULL,
    "referralCode" text DEFAULT ''::text NOT NULL,
    "stripAdvertiserName" text DEFAULT ''::text NOT NULL,
    "adIconKey" text DEFAULT 'shield'::text NOT NULL,
    "adAccentColor" text DEFAULT '#22c55e'::text NOT NULL
);


--
-- Name: ProfileFollow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProfileFollow" (
    id integer NOT NULL,
    "followerAddress" text NOT NULL,
    "followingAddress" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ProfileFollow_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ProfileFollow_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ProfileFollow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ProfileFollow_id_seq" OWNED BY public."ProfileFollow".id;


--
-- Name: Promotion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Promotion" (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "slotType" text NOT NULL,
    "txHash" text NOT NULL,
    "paidAmount" text NOT NULL,
    currency text DEFAULT 'ETH'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paymentToken" text DEFAULT 'ETH'::text NOT NULL,
    "durationDays" integer DEFAULT 7 NOT NULL,
    wallet text DEFAULT ''::text NOT NULL,
    "orderNumber" text
);


--
-- Name: PromotionPrice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PromotionPrice" (
    id integer NOT NULL,
    "slotType" text NOT NULL,
    amount text NOT NULL,
    currency text DEFAULT 'ETH'::text NOT NULL,
    "durationDays" integer DEFAULT 7 NOT NULL
);


--
-- Name: PromotionPrice_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PromotionPrice_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PromotionPrice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PromotionPrice_id_seq" OWNED BY public."PromotionPrice".id;


--
-- Name: Promotion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Promotion_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Promotion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Promotion_id_seq" OWNED BY public."Promotion".id;


--
-- Name: SyncState; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyncState" (
    id integer NOT NULL,
    key text NOT NULL,
    "lastSyncedAt" timestamp(3) without time zone NOT NULL,
    "lastChainId" integer,
    last_attempt_at timestamp(3) with time zone,
    last_successful_observation_at timestamp(3) with time zone,
    last_mutation_at timestamp(3) with time zone,
    last_cursor_advanced_at timestamp(3) with time zone,
    last_complete_reconciliation_at timestamp(3) with time zone,
    last_error_at timestamp(3) with time zone,
    last_outcome_status text,
    last_outcome_reason text,
    last_coverage jsonb
);


--
-- Name: SyncState_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SyncState_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SyncState_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SyncState_id_seq" OWNED BY public."SyncState".id;


--
-- Name: TrustEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TrustEvent" (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    "eventType" text NOT NULL,
    "scoreDelta" double precision DEFAULT 0 NOT NULL,
    "evidenceUrl" text DEFAULT ''::text NOT NULL,
    "onChainTx" text DEFAULT ''::text NOT NULL,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    event_key text
);


--
-- Name: UserProfile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserProfile" (
    id integer NOT NULL,
    "walletAddress" text,
    username text,
    "displayName" text,
    bio text DEFAULT ''::text NOT NULL,
    "avatarUrl" text DEFAULT ''::text NOT NULL,
    "twitterUrl" text DEFAULT ''::text NOT NULL,
    "githubUrl" text DEFAULT ''::text NOT NULL,
    "websiteUrl" text DEFAULT ''::text NOT NULL,
    "followersCount" integer DEFAULT 0 NOT NULL,
    "followingCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    email text,
    "subscriptionStatus" text DEFAULT 'none'::text NOT NULL,
    "subscriptionPlan" text DEFAULT ''::text NOT NULL,
    "subscriptionExpiresAt" timestamp(3) without time zone,
    "subscriptionStartedAt" timestamp(3) without time zone,
    "helioSubscriptionId" text,
    "claimToken" text,
    "claimTokenExpiresAt" timestamp(3) without time zone,
    "isClaimed" boolean DEFAULT false NOT NULL,
    "claimedAt" timestamp(3) without time zone,
    "passwordHash" text,
    "adminNotes" text DEFAULT ''::text NOT NULL,
    solana_wallet text,
    email_verified_at timestamp(3) without time zone,
    last_login_at timestamp(3) without time zone
);


--
-- Name: UserProfile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."UserProfile_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: UserProfile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."UserProfile_id_seq" OWNED BY public."UserProfile".id;


--
-- Name: WalletLinkChallenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WalletLinkChallenge" (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    wallet text NOT NULL,
    nonce text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: account_credit_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_credit_ledger (
    id text NOT NULL,
    app_account_id text NOT NULL,
    credit_type public."AccountCreditType" NOT NULL,
    delta integer NOT NULL,
    balance_after integer NOT NULL,
    reason text NOT NULL,
    reference_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    idempotency_key text
);


--
-- Name: agent_alert_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_alert_deliveries (
    id text NOT NULL,
    event_id text NOT NULL,
    rule_id integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_http_status integer,
    last_error text,
    response_preview text,
    delivered_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_alert_events (
    id text NOT NULL,
    agent_id integer,
    event_type text NOT NULL,
    event_key text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_analytics_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_analytics_daily (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    date date NOT NULL,
    profile_views integer DEFAULT 0 NOT NULL,
    search_impressions integer DEFAULT 0 NOT NULL,
    link_clicks integer DEFAULT 0 NOT NULL,
    service_clicks integer DEFAULT 0 NOT NULL,
    x402_clicks integer DEFAULT 0 NOT NULL,
    paid_service_views integer DEFAULT 0 NOT NULL,
    paid_service_clicks integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_analytics_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_analytics_daily_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_analytics_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_analytics_daily_id_seq OWNED BY public.agent_analytics_daily.id;


--
-- Name: agent_chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_conversations (
    id text NOT NULL,
    agent_db_id integer NOT NULL,
    app_account_id text NOT NULL,
    created_by_user_profile_id integer NOT NULL,
    title text NOT NULL,
    "titleSource" public."AgentChatTitleSource" DEFAULT 'DEFAULT'::public."AgentChatTitleSource" NOT NULL,
    status public."AgentChatConversationStatus" DEFAULT 'ACTIVE'::public."AgentChatConversationStatus" NOT NULL,
    default_model_key text DEFAULT ''::text NOT NULL,
    next_message_sequence integer DEFAULT 1 NOT NULL,
    last_message_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at timestamp(3) with time zone,
    CONSTRAINT agent_chat_conversations_deleted_state_check CHECK (((status = 'DELETED'::public."AgentChatConversationStatus") = (deleted_at IS NOT NULL))),
    CONSTRAINT agent_chat_conversations_next_sequence_check CHECK ((next_message_sequence >= 1))
);


--
-- Name: agent_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_messages (
    id text NOT NULL,
    conversation_id text NOT NULL,
    sequence integer NOT NULL,
    ui_message_id text NOT NULL,
    role public."AgentChatMessageRole" NOT NULL,
    status public."AgentChatMessageStatus" DEFAULT 'COMPLETE'::public."AgentChatMessageStatus" NOT NULL,
    content_text text DEFAULT ''::text NOT NULL,
    parts_json jsonb NOT NULL,
    finish_reason text,
    error_code text,
    error_message text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone,
    CONSTRAINT agent_chat_messages_sequence_check CHECK ((sequence >= 1)),
    CONSTRAINT agent_chat_messages_status_completed_check CHECK ((((status = ANY (ARRAY['COMPLETE'::public."AgentChatMessageStatus", 'FAILED'::public."AgentChatMessageStatus", 'CANCELLED'::public."AgentChatMessageStatus"])) AND (completed_at IS NOT NULL)) OR ((status = ANY (ARRAY['PENDING'::public."AgentChatMessageStatus", 'STREAMING'::public."AgentChatMessageStatus"])) AND (completed_at IS NULL))))
);


--
-- Name: agent_chat_run_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_run_attempts (
    id text NOT NULL,
    run_id text NOT NULL,
    sequence smallint NOT NULL,
    reason public."AgentChatRunAttemptReason" NOT NULL,
    status public."AgentChatRunAttemptStatus" DEFAULT 'RUNNING'::public."AgentChatRunAttemptStatus" NOT NULL,
    model_key text NOT NULL,
    provider text NOT NULL,
    provider_model_id text NOT NULL,
    adapter text NOT NULL,
    sdk_call_id text NOT NULL,
    sdk_provider text NOT NULL,
    sdk_model_id text NOT NULL,
    input_price_usd_micros_per_million bigint CONSTRAINT agent_chat_run_attempts_input_price_usd_micros_per_mil_not_null NOT NULL,
    output_price_usd_micros_per_million bigint CONSTRAINT agent_chat_run_attempts_output_price_usd_micros_per_mi_not_null NOT NULL,
    cached_input_price_usd_micros_per_million bigint,
    cache_write_price_usd_micros_per_million bigint,
    reasoning_price_usd_micros_per_million bigint,
    input_tokens integer,
    output_tokens integer,
    reasoning_tokens integer,
    cached_input_tokens integer,
    cache_write_tokens integer,
    total_tokens integer,
    provider_request_id text,
    local_cost_usd_micros bigint,
    provider_cost_usd_micros bigint,
    provider_latency_ms integer,
    duration_ms integer,
    first_token_at timestamp(3) with time zone,
    finish_reason text,
    raw_finish_reason text,
    error_code text,
    error_message text,
    error_json jsonb,
    reconciliation_status public."LlmReconciliationStatus" DEFAULT 'NOT_APPLICABLE'::public."LlmReconciliationStatus" NOT NULL,
    reconciliation_attempts smallint DEFAULT 0 NOT NULL,
    reconciled_cost_usd_micros bigint,
    started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT agent_chat_run_attempts_cost_duration_check CHECK ((((local_cost_usd_micros IS NULL) OR (local_cost_usd_micros >= 0)) AND ((provider_cost_usd_micros IS NULL) OR (provider_cost_usd_micros >= 0)) AND ((reconciled_cost_usd_micros IS NULL) OR (reconciled_cost_usd_micros >= 0)) AND ((provider_latency_ms IS NULL) OR (provider_latency_ms >= 0)) AND ((duration_ms IS NULL) OR (duration_ms >= 0)))),
    CONSTRAINT agent_chat_run_attempts_price_check CHECK (((input_price_usd_micros_per_million >= 0) AND (output_price_usd_micros_per_million >= 0) AND ((cached_input_price_usd_micros_per_million IS NULL) OR (cached_input_price_usd_micros_per_million >= 0)) AND ((cache_write_price_usd_micros_per_million IS NULL) OR (cache_write_price_usd_micros_per_million >= 0)) AND ((reasoning_price_usd_micros_per_million IS NULL) OR (reasoning_price_usd_micros_per_million >= 0)))),
    CONSTRAINT agent_chat_run_attempts_reconciliation_attempts_check CHECK ((reconciliation_attempts >= 0)),
    CONSTRAINT agent_chat_run_attempts_sequence_check CHECK ((sequence >= 0)),
    CONSTRAINT agent_chat_run_attempts_terminal_completed_check CHECK ((((status = ANY (ARRAY['SUCCEEDED'::public."AgentChatRunAttemptStatus", 'FAILED'::public."AgentChatRunAttemptStatus", 'CANCELLED'::public."AgentChatRunAttemptStatus"])) AND (completed_at IS NOT NULL)) OR ((status = 'RUNNING'::public."AgentChatRunAttemptStatus") AND (completed_at IS NULL)))),
    CONSTRAINT agent_chat_run_attempts_usage_check CHECK ((((input_tokens IS NULL) OR (input_tokens >= 0)) AND ((output_tokens IS NULL) OR (output_tokens >= 0)) AND ((reasoning_tokens IS NULL) OR (reasoning_tokens >= 0)) AND ((cached_input_tokens IS NULL) OR (cached_input_tokens >= 0)) AND ((cache_write_tokens IS NULL) OR (cache_write_tokens >= 0)) AND ((total_tokens IS NULL) OR (total_tokens >= 0))))
);


--
-- Name: agent_chat_run_runtime; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_run_runtime (
    run_id text NOT NULL,
    worker_id text NOT NULL,
    heartbeat_at timestamp(3) with time zone NOT NULL,
    lease_expires_at timestamp(3) with time zone NOT NULL,
    abort_requested_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT agent_chat_run_runtime_lease_order_check CHECK ((lease_expires_at >= heartbeat_at))
);


--
-- Name: agent_chat_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_runs (
    id text NOT NULL,
    request_id text NOT NULL,
    conversation_id text NOT NULL,
    app_account_id text NOT NULL,
    agent_db_id integer NOT NULL,
    user_message_id text NOT NULL,
    assistant_message_id text NOT NULL,
    settings_revision_id text NOT NULL,
    status public."AgentChatRunLifecycle" DEFAULT 'PREPARING'::public."AgentChatRunLifecycle" NOT NULL,
    settlement_status public."AgentChatSettlementStatus" DEFAULT 'PENDING'::public."AgentChatSettlementStatus" NOT NULL,
    requested_model_key text NOT NULL,
    initial_model_key text NOT NULL,
    final_model_key text,
    final_provider text,
    final_provider_model_id text,
    final_adapter text,
    routing_policy text NOT NULL,
    routing_reason public."AgentChatRouteReason" NOT NULL,
    routing_json jsonb,
    pricing_revision text NOT NULL,
    reservation_input_tokens integer NOT NULL,
    reservation_output_tokens integer NOT NULL,
    max_tool_steps integer NOT NULL,
    reserved_cents integer NOT NULL,
    final_charge_cents integer,
    refund_cents integer,
    reservation_ledger_id text,
    settlement_ledger_id text,
    input_tokens integer,
    output_tokens integer,
    reasoning_tokens integer,
    cached_input_tokens integer,
    cache_write_tokens integer,
    total_tokens integer,
    local_cost_usd_micros bigint,
    provider_cost_usd_micros bigint,
    duration_ms integer,
    first_token_at timestamp(3) with time zone,
    error_code text,
    error_message text,
    error_json jsonb,
    billing_anomaly_json jsonb,
    started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    settled_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT agent_chat_runs_costs_check CHECK ((((local_cost_usd_micros IS NULL) OR (local_cost_usd_micros >= 0)) AND ((provider_cost_usd_micros IS NULL) OR (provider_cost_usd_micros >= 0)) AND ((duration_ms IS NULL) OR (duration_ms >= 0)))),
    CONSTRAINT agent_chat_runs_final_charge_check CHECK (((final_charge_cents IS NULL) OR (final_charge_cents >= 0))),
    CONSTRAINT agent_chat_runs_max_tool_steps_check CHECK ((max_tool_steps >= 0)),
    CONSTRAINT agent_chat_runs_refund_check CHECK (((refund_cents IS NULL) OR (refund_cents >= 0))),
    CONSTRAINT agent_chat_runs_reservation_input_check CHECK ((reservation_input_tokens > 0)),
    CONSTRAINT agent_chat_runs_reservation_output_check CHECK ((reservation_output_tokens > 0)),
    CONSTRAINT agent_chat_runs_reserved_cents_check CHECK ((reserved_cents >= 0)),
    CONSTRAINT agent_chat_runs_settlement_check CHECK (((settlement_status <> 'SETTLED'::public."AgentChatSettlementStatus") OR ((settled_at IS NOT NULL) AND (final_charge_cents IS NOT NULL) AND (refund_cents IS NOT NULL)))),
    CONSTRAINT agent_chat_runs_terminal_completed_check CHECK ((((status = ANY (ARRAY['COMPLETED'::public."AgentChatRunLifecycle", 'FAILED'::public."AgentChatRunLifecycle", 'CANCELLED'::public."AgentChatRunLifecycle"])) AND (completed_at IS NOT NULL)) OR ((status = ANY (ARRAY['PREPARING'::public."AgentChatRunLifecycle", 'RESERVED'::public."AgentChatRunLifecycle", 'STREAMING'::public."AgentChatRunLifecycle"])) AND (completed_at IS NULL)))),
    CONSTRAINT agent_chat_runs_token_counts_check CHECK ((((input_tokens IS NULL) OR (input_tokens >= 0)) AND ((output_tokens IS NULL) OR (output_tokens >= 0)) AND ((reasoning_tokens IS NULL) OR (reasoning_tokens >= 0)) AND ((cached_input_tokens IS NULL) OR (cached_input_tokens >= 0)) AND ((cache_write_tokens IS NULL) OR (cache_write_tokens >= 0)) AND ((total_tokens IS NULL) OR (total_tokens >= 0))))
);


--
-- Name: agent_chat_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_settings (
    id text NOT NULL,
    agent_db_id integer NOT NULL,
    current_revision_id text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: agent_chat_settings_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_settings_revisions (
    id text NOT NULL,
    settings_id text NOT NULL,
    agent_db_id integer NOT NULL,
    revision integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    persona text,
    system_instructions text,
    greeting text,
    created_by_user_profile_id integer,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT agent_chat_settings_revisions_revision_check CHECK ((revision >= 1))
);


--
-- Name: agent_chat_tool_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_chat_tool_events (
    id text NOT NULL,
    run_id text NOT NULL,
    assistant_message_id text NOT NULL,
    step_index smallint NOT NULL,
    tool_call_id text NOT NULL,
    tool_name text NOT NULL,
    state public."AgentChatToolState" DEFAULT 'PENDING'::public."AgentChatToolState" NOT NULL,
    input_json jsonb,
    output_json jsonb,
    summary_json jsonb,
    error_json jsonb,
    visibility public."AgentChatToolVisibility" DEFAULT 'SUMMARY'::public."AgentChatToolVisibility" NOT NULL,
    duration_ms integer,
    started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT agent_chat_tool_events_duration_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT agent_chat_tool_events_step_index_check CHECK ((step_index >= 0))
);


--
-- Name: agent_github_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_github_connections (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    github_installation_id text DEFAULT ''::text NOT NULL,
    repo_id text DEFAULT ''::text NOT NULL,
    repo_full_name text DEFAULT ''::text NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    connected_by_user_id integer,
    status text DEFAULT 'pending'::text NOT NULL,
    last_synced_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_github_push_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_github_push_notes (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    commit_sha text NOT NULL,
    dev_note text DEFAULT ''::text NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_github_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_github_snapshots (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    connection_id text NOT NULL,
    commit_count_30d integer DEFAULT 0 NOT NULL,
    release_count integer DEFAULT 0 NOT NULL,
    contributor_count integer DEFAULT 0 NOT NULL,
    last_commit_at timestamp(3) without time zone,
    payload_json jsonb,
    captured_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_launch_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_launch_events (
    id text NOT NULL,
    launch_id text NOT NULL,
    type text NOT NULL,
    tx_signature text,
    payload_json jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_launch_fee_distribution_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_launch_fee_distribution_attempts (
    id text NOT NULL,
    launch_id text NOT NULL,
    network text DEFAULT 'devnet'::text NOT NULL,
    mint text NOT NULL,
    status text DEFAULT 'prepared'::text NOT NULL,
    mode text DEFAULT 'standard'::text NOT NULL,
    tx_signature text NOT NULL,
    raw_transaction_base64 text CONSTRAINT agent_launch_fee_distribution_a_raw_transaction_base64_not_null NOT NULL,
    recent_blockhash text CONSTRAINT agent_launch_fee_distribution_attempt_recent_blockhash_not_null NOT NULL,
    last_valid_block_height bigint CONSTRAINT agent_launch_fee_distribution__last_valid_block_height_not_null NOT NULL,
    quote_symbol text DEFAULT 'SOL'::text NOT NULL,
    total_amount bigint NOT NULL,
    ar_amount bigint NOT NULL,
    creator_amount bigint NOT NULL,
    payload_json jsonb,
    submitted_at timestamp(3) without time zone,
    confirmed_at timestamp(3) without time zone,
    last_error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_launch_fee_distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_launch_fee_distributions (
    id text NOT NULL,
    launch_id text NOT NULL,
    network text DEFAULT 'devnet'::text NOT NULL,
    mint text NOT NULL,
    tx_signature text NOT NULL,
    quote_symbol text DEFAULT 'SOL'::text NOT NULL,
    total_amount bigint NOT NULL,
    ar_amount bigint NOT NULL,
    creator_amount bigint NOT NULL,
    payload_json jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_launches (
    id text NOT NULL,
    "agentId" text,
    network text DEFAULT 'devnet'::text NOT NULL,
    mint text,
    "creatorWallet" text,
    "arTreasuryWallet" text,
    "creationFeeLamports" bigint,
    "creatorShareBps" integer DEFAULT 7000 NOT NULL,
    "arShareBps" integer DEFAULT 3000 NOT NULL,
    "tokenName" text,
    "tokenSymbol" text,
    "tokenDescription" text,
    "tokenImageUrl" text,
    "metadataUri" text,
    "passportUri" text,
    "passportJson" jsonb,
    "quoteMint" text,
    "quoteSymbol" text DEFAULT 'SOL'::text NOT NULL,
    "creationTx" text,
    "feeShareTx" text,
    "feeSharingConfig" text,
    "feeSharingStatus" text DEFAULT 'pending'::text NOT NULL,
    "launchStatus" text DEFAULT 'draft'::text NOT NULL,
    "totalFeesDistributedLamports" bigint DEFAULT 0 NOT NULL,
    "totalArFeesLamports" bigint DEFAULT 0 NOT NULL,
    "totalCreatorFeesLamports" bigint DEFAULT 0 NOT NULL,
    "lastDistributionAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "metadataJson" jsonb,
    launch_kind text DEFAULT 'agentranking'::text NOT NULL,
    launch_lifecycle_status text DEFAULT 'unknown'::text NOT NULL,
    market_source text DEFAULT 'unavailable'::text NOT NULL,
    profile_display_name text,
    profile_short_description text,
    profile_long_description text,
    profile_avatar_url text,
    profile_banner_url text,
    profile_website text,
    profile_twitter text,
    profile_telegram text,
    profile_github text,
    profile_tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    agent_db_id integer,
    ar_token_verification_status text DEFAULT 'unverified'::text NOT NULL,
    ar_token_verified_at timestamp(3) without time zone,
    ar_token_verification_source text
);


--
-- Name: agent_official_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_official_links (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    link_type text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    source text DEFAULT 'user_submission'::text NOT NULL,
    locked_by_verified_owner boolean DEFAULT false NOT NULL,
    last_checked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_official_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_official_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_official_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_official_links_id_seq OWNED BY public.agent_official_links.id;


--
-- Name: agent_paid_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_paid_services (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    service_type text DEFAULT 'x402'::text NOT NULL,
    endpoint_url text DEFAULT ''::text NOT NULL,
    price_usd double precision,
    price_label text DEFAULT ''::text NOT NULL,
    payment_wallet text DEFAULT ''::text NOT NULL,
    sample_response text DEFAULT ''::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_paid_services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_paid_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_paid_services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_paid_services_id_seq OWNED BY public.agent_paid_services.id;


--
-- Name: agent_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_summaries (
    "walletAddress" text NOT NULL,
    "chainId" integer NOT NULL,
    "totalVolumeUsd" numeric(24,8) NOT NULL,
    "netPnlUsd" numeric(24,8) NOT NULL,
    "winRate" double precision NOT NULL,
    "tradeCount" integer NOT NULL,
    "lastComputedAt" timestamp(3) without time zone NOT NULL,
    "displayName" text,
    "isRegistered" boolean DEFAULT false NOT NULL
);


--
-- Name: agent_verification_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_verification_signals (
    id text NOT NULL,
    "agentId" integer NOT NULL,
    signal_type text NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    source text DEFAULT 'user_submission'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    payload_json jsonb,
    evidence_url text DEFAULT ''::text NOT NULL,
    evidence_ref text DEFAULT ''::text NOT NULL,
    last_checked_at timestamp(3) without time zone,
    verified_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: app_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_accounts (
    id text NOT NULL,
    user_profile_id integer NOT NULL,
    display_name text,
    email text,
    image_url text,
    account_wallet_id text,
    max_agents integer DEFAULT 3 NOT NULL,
    platform_credits integer DEFAULT 0 NOT NULL,
    llm_credits integer DEFAULT 0 NOT NULL,
    cached_sol_balance_lamports bigint,
    last_balance_sync_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    onboarding_completed_at timestamp(3) without time zone,
    llm_balance_cents integer DEFAULT 0 NOT NULL
);


--
-- Name: auth_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_accounts (
    id text NOT NULL,
    "userId" text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id text NOT NULL,
    "sessionToken" text NOT NULL,
    "userId" text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);


--
-- Name: auth_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_users (
    id text NOT NULL,
    name text,
    email text,
    "emailVerified" timestamp(3) without time zone,
    image text
);


--
-- Name: auth_verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_verification_tokens (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);


--
-- Name: cache_domain_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_domain_revisions (
    domain text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    changed_at timestamp(3) with time zone DEFAULT now() NOT NULL
);


--
-- Name: cache_invalidation_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_invalidation_outbox (
    id bigint NOT NULL,
    domain text NOT NULL,
    revision bigint NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp(3) with time zone
);


--
-- Name: cache_invalidation_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cache_invalidation_outbox ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cache_invalidation_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: custodial_wallet_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custodial_wallet_audit (
    id text NOT NULL,
    wallet_id text NOT NULL,
    action text NOT NULL,
    actor_profile_id integer,
    metadata_json jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: custodial_wallet_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custodial_wallet_transfers (
    id text NOT NULL,
    wallet_id text NOT NULL,
    agent_db_id integer,
    network text NOT NULL,
    token text DEFAULT 'SOL'::text NOT NULL,
    from_public_key text NOT NULL,
    to_public_key text NOT NULL,
    amount_lamports bigint NOT NULL,
    signature text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confirmed_at timestamp(3) without time zone
);


--
-- Name: custodial_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custodial_wallets (
    id text NOT NULL,
    scope public."CustodialWalletScope" NOT NULL,
    chain text DEFAULT 'solana'::text NOT NULL,
    public_key text NOT NULL,
    encrypted_secret text NOT NULL,
    encryption_key_id text DEFAULT 'env:v1'::text NOT NULL,
    encryption_version integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: dashboard_auth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_auth_tokens (
    id text NOT NULL,
    email text NOT NULL,
    type text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: evm_contract_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_contract_generations (
    id text NOT NULL,
    chain_id integer NOT NULL,
    proxy_address text NOT NULL,
    implementation_address text NOT NULL,
    implementation_code_hash text NOT NULL,
    beacon_address text,
    reported_version text,
    decoder_version text NOT NULL,
    capabilities jsonb,
    effective_from_block bigint NOT NULL,
    effective_from_tx_index integer DEFAULT 0 NOT NULL,
    effective_from_log_index integer DEFAULT 0 NOT NULL,
    effective_until_block bigint,
    effective_until_tx_index integer,
    effective_until_log_index integer,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: evm_event_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_event_observations (
    id text NOT NULL,
    event_key text NOT NULL,
    business_key text NOT NULL,
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    contract_generation_id text,
    event_name text NOT NULL,
    topic0 text,
    topics text[] DEFAULT ARRAY[]::text[] NOT NULL,
    data bytea NOT NULL,
    block_number bigint,
    block_hash text,
    block_time timestamp(3) with time zone,
    transaction_hash text,
    transaction_index integer,
    log_index integer,
    removed boolean DEFAULT false NOT NULL,
    status text NOT NULL,
    finality_policy text,
    decoder_version text NOT NULL,
    decoded jsonb,
    rejection_reason text,
    indexed_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: evm_feedback_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_feedback_observations (
    id text NOT NULL,
    event_key text NOT NULL,
    chain_id integer NOT NULL,
    registry_address text NOT NULL,
    registry_generation text NOT NULL,
    protocol_agent_id text NOT NULL,
    event_type text NOT NULL,
    client_address text NOT NULL,
    feedback_index bigint NOT NULL,
    raw_value text,
    value_decimals integer,
    exact_value text,
    tag1 text,
    tag2 text,
    endpoint text,
    feedback_uri text,
    feedback_hash text,
    document_raw_bytes bytea,
    document_raw_digest text,
    document_commitment_digest text,
    document_hash_valid boolean,
    document_declared_at timestamp(3) with time zone,
    document_fetched_at timestamp(3) with time zone,
    document_error text,
    revoked boolean DEFAULT false NOT NULL,
    responder text,
    response_uri text,
    response_hash text,
    responder_classification text,
    classification_evidence jsonb,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    block_time timestamp(3) with time zone,
    transaction_hash text NOT NULL,
    transaction_index integer NOT NULL,
    log_index integer NOT NULL,
    status text NOT NULL,
    decoder_version text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    normalization_evidence jsonb,
    document_parsed jsonb,
    document_normalized jsonb,
    document_diagnostics jsonb
);


--
-- Name: evm_identity_metadata_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_identity_metadata_observations (
    id text NOT NULL,
    event_key text NOT NULL,
    chain_id integer NOT NULL,
    registry_address text NOT NULL,
    registry_generation text NOT NULL,
    protocol_agent_id text NOT NULL,
    metadata_key text NOT NULL,
    metadata_key_hash text NOT NULL,
    raw_value bytea NOT NULL,
    hex_value text NOT NULL,
    decoded_type text,
    decoded_text text,
    decoded_address text,
    decoder_version text NOT NULL,
    operation_context text,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    transaction_hash text NOT NULL,
    transaction_index integer NOT NULL,
    log_index integer NOT NULL,
    status text NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    superseded_by_event_key text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    decoded_boolean boolean,
    decoded_integer text,
    decoded_uri text,
    decoded_bytes32 text,
    decoded_json jsonb,
    semantic_type text,
    normalization_evidence jsonb
);


--
-- Name: evm_identity_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_identity_observations (
    id text NOT NULL,
    business_key text NOT NULL,
    chain_id integer NOT NULL,
    registry_address text NOT NULL,
    registry_generation text NOT NULL,
    protocol_agent_id text NOT NULL,
    registered_owner text,
    current_owner text,
    current_agent_wallet text,
    agent_uri text,
    registered_at_event_position jsonb,
    current_owner_event_position jsonb,
    current_wallet_event_position jsonb,
    hydration_reason text,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    transaction_hash text NOT NULL,
    transaction_index integer NOT NULL,
    last_log_index integer NOT NULL,
    block_time timestamp(3) with time zone,
    status text NOT NULL,
    decoder_version text NOT NULL,
    materialization_generation bigint DEFAULT 0 NOT NULL,
    materialized_agent_id integer,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: evm_validation_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evm_validation_observations (
    id text NOT NULL,
    event_key text NOT NULL,
    chain_id integer NOT NULL,
    registry_address text NOT NULL,
    registry_generation text NOT NULL,
    request_hash text NOT NULL,
    event_type text NOT NULL,
    validator_address text NOT NULL,
    protocol_agent_id text NOT NULL,
    request_uri text,
    response integer,
    response_uri text,
    response_hash text,
    tag text,
    has_response boolean DEFAULT false NOT NULL,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    block_time timestamp(3) with time zone,
    transaction_hash text NOT NULL,
    transaction_index integer NOT NULL,
    log_index integer NOT NULL,
    status text NOT NULL,
    decoder_version text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    normalization_evidence jsonb,
    document_role text,
    document_uri text,
    document_raw_bytes bytea,
    document_raw_digest text,
    document_commitment_digest text,
    document_hash_valid boolean,
    document_parsed jsonb,
    document_normalized jsonb,
    document_diagnostics jsonb,
    document_fetched_at timestamp(3) with time zone,
    document_error text
);


--
-- Name: fairscale_agent_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fairscale_agent_assessments (
    id text NOT NULL,
    agent_id integer NOT NULL,
    wallet_address text,
    wallet_source text,
    status text DEFAULT 'pending'::text NOT NULL,
    score integer,
    tier text,
    recommendation_tier text,
    recommendation_label text,
    pillars jsonb,
    signals jsonb,
    red_flags jsonb,
    badges jsonb,
    verifications jsonb,
    description_alignment jsonb,
    provider text,
    scored_at timestamp(3) without time zone,
    fetched_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone,
    last_error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    last_attempt_at timestamp(3) with time zone
);


--
-- Name: indexer_bootstrap_epochs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_bootstrap_epochs (
    id text NOT NULL,
    semantic_generation text NOT NULL,
    topology_hash text NOT NULL,
    phase public."IndexerBootstrapPhase" NOT NULL,
    status public."IndexerBootstrapStatus" DEFAULT 'RUNNING'::public."IndexerBootstrapStatus" NOT NULL,
    strict boolean DEFAULT false NOT NULL,
    started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    phase_started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    publication_generation text,
    published_at timestamp(3) with time zone,
    first_agent_materialized_at timestamp(3) with time zone,
    first_agent_db_id integer,
    CONSTRAINT indexer_bootstrap_epochs_first_agent_pair_check CHECK (((first_agent_materialized_at IS NULL) = (first_agent_db_id IS NULL))),
    CONSTRAINT indexer_bootstrap_epochs_timestamps_check CHECK (((phase_started_at >= started_at) AND ((completed_at IS NULL) OR (completed_at >= started_at)) AND ((published_at IS NULL) OR (published_at >= started_at)) AND ((first_agent_materialized_at IS NULL) OR (first_agent_materialized_at >= started_at))))
);


--
-- Name: indexer_bootstrap_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_bootstrap_sources (
    id text NOT NULL,
    epoch_id text NOT NULL,
    source_key text NOT NULL,
    phase public."IndexerBootstrapPhase" NOT NULL,
    domain text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    status public."IndexerBootstrapWorkStatus" DEFAULT 'PENDING'::public."IndexerBootstrapWorkStatus" NOT NULL,
    target_block bigint,
    target_slot bigint,
    target_generation bigint,
    observed_block bigint,
    observed_slot bigint,
    observed_generation bigint,
    discovered_count integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    degraded_reason text,
    last_error text,
    started_at timestamp(3) with time zone,
    completed_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT indexer_bootstrap_sources_completion_time_check CHECK (((completed_at IS NULL) OR (started_at IS NULL) OR (completed_at >= started_at))),
    CONSTRAINT indexer_bootstrap_sources_counts_nonnegative_check CHECK (((discovered_count >= 0) AND (completed_count >= 0) AND (rejected_count >= 0)))
);


--
-- Name: indexer_bootstrap_work_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_bootstrap_work_items (
    epoch_id text NOT NULL,
    work_key text NOT NULL,
    phase public."IndexerBootstrapPhase" NOT NULL,
    source_key text,
    agent_db_id integer,
    status public."IndexerBootstrapWorkStatus" DEFAULT 'PENDING'::public."IndexerBootstrapWorkStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    terminal_reason text,
    last_error text,
    started_at timestamp(3) with time zone,
    completed_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT indexer_bootstrap_work_items_attempts_nonnegative_check CHECK ((attempts >= 0)),
    CONSTRAINT indexer_bootstrap_work_items_completion_time_check CHECK (((completed_at IS NULL) OR (started_at IS NULL) OR (completed_at >= started_at)))
);


--
-- Name: indexer_dead_letter_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_dead_letter_records (
    id text NOT NULL,
    dead_letter_job_id text NOT NULL,
    original_queue text NOT NULL,
    original_job_id text,
    original_payload jsonb NOT NULL,
    payload_generation integer,
    first_attempt_at timestamp(3) with time zone,
    last_attempt_at timestamp(3) with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    error_history jsonb,
    source_network text,
    source_coordinates jsonb,
    decoder_generation text,
    configuration_generation text,
    replay_generation integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: indexer_endpoint_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_endpoint_states (
    id text NOT NULL,
    endpoint_key text NOT NULL,
    protocol text NOT NULL,
    endpoint_url text NOT NULL,
    configured_network text,
    observed_network text,
    configuration_generation text NOT NULL,
    capabilities jsonb,
    latest_head bigint,
    safe_head bigint,
    finalized_head bigint,
    boundary_hash text,
    history_floor bigint,
    disabled_reason text,
    verified_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    credential_key_hash text,
    credential_disabled_reason text,
    credential_cooldown_until timestamp(3) with time zone,
    credential_failure_count integer DEFAULT 0 NOT NULL
);


--
-- Name: indexer_idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_idempotency_records (
    id text NOT NULL,
    business_key text NOT NULL,
    stage text NOT NULL,
    source_observation_key text,
    materialization_generation bigint DEFAULT 0 NOT NULL,
    result_digest text,
    result jsonb,
    completed_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: indexer_job_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_job_leases (
    id text NOT NULL,
    business_key text NOT NULL,
    queue_name text NOT NULL,
    job_id text,
    payload_generation integer NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    source_snapshot jsonb,
    decoder_generation text,
    configuration_generation text,
    deadline_at timestamp(3) with time zone NOT NULL,
    last_progress_at timestamp(3) with time zone NOT NULL,
    progress jsonb,
    state text NOT NULL,
    error_history jsonb,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    execution_token text,
    lease_version bigint DEFAULT 0 NOT NULL,
    last_meaningful_progress_at timestamp(3) with time zone NOT NULL
);


--
-- Name: indexer_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_outbox (
    id text NOT NULL,
    business_key text NOT NULL,
    queue_name text NOT NULL,
    payload jsonb NOT NULL,
    source_key text,
    source_position jsonb,
    available_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    dispatched_at timestamp(3) with time zone,
    last_error text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: indexer_range_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_range_leases (
    id text NOT NULL,
    source_key text NOT NULL,
    from_block bigint NOT NULL,
    to_block bigint NOT NULL,
    status text NOT NULL,
    holder text,
    lease_until timestamp(3) with time zone,
    completed_at timestamp(3) with time zone,
    error text,
    chain_id integer NOT NULL,
    domain text NOT NULL,
    registry_address text,
    registry_generation text,
    requested_generation bigint,
    revision integer DEFAULT 0 NOT NULL,
    target_block bigint NOT NULL,
    finality_policy text,
    source_head bigint,
    canonical_head bigint,
    end_block_hash text,
    discovered_count integer DEFAULT 0 NOT NULL,
    decoded_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT indexer_range_leases_block_order_check CHECK (((from_block >= 0) AND (to_block >= from_block) AND (target_block >= to_block))),
    CONSTRAINT indexer_range_leases_counts_check CHECK (((discovered_count >= 0) AND (decoded_count >= 0) AND (rejected_count >= 0))),
    CONSTRAINT indexer_range_leases_revision_check CHECK ((revision >= 0)),
    CONSTRAINT indexer_range_leases_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETE'::text, 'FAILED'::text, 'INVALIDATED'::text]))),
    CONSTRAINT indexer_range_leases_valid_range CHECK (((from_block >= 0) AND (to_block >= from_block)))
);


--
-- Name: indexer_scan_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_scan_intents (
    id text NOT NULL,
    source_key text NOT NULL,
    chain_id integer,
    domain text NOT NULL,
    registry_address text,
    registry_generation text,
    desired_generation bigint DEFAULT 0 NOT NULL,
    acknowledged_generation bigint DEFAULT 0 NOT NULL,
    requested_finalized_target bigint,
    minimum_rescan_boundary bigint,
    force_reconciliation boolean DEFAULT false NOT NULL,
    requested_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: indexer_scheduler_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_scheduler_leases (
    lease_key text NOT NULL,
    owner_id text NOT NULL,
    semantic_generation text NOT NULL,
    lease_version bigint DEFAULT 0 NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    acquired_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: indexer_source_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indexer_source_cursors (
    id text NOT NULL,
    source_key text NOT NULL,
    chain_id integer,
    domain text NOT NULL,
    registry_address text,
    registry_generation text,
    block_number bigint,
    block_hash text,
    slot bigint,
    signature text,
    opaque_cursor text,
    finality_policy text,
    source_head bigint,
    canonical_head bigint,
    oldest_unresolved_gap bigint,
    reconciliation_generation bigint DEFAULT 0 NOT NULL,
    last_advanced_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: job_interaction_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_interaction_events (
    id integer NOT NULL,
    event_type text NOT NULL,
    job_id text,
    agent_id integer,
    source text,
    metadata jsonb,
    ip_hash text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: job_interaction_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_interaction_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_interaction_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_interaction_events_id_seq OWNED BY public.job_interaction_events.id;


--
-- Name: job_partner_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_partner_sources (
    id text NOT NULL,
    source text NOT NULL,
    display_name text NOT NULL,
    website_url text DEFAULT ''::text NOT NULL,
    docs_url text,
    enabled boolean DEFAULT true NOT NULL,
    last_sync_at timestamp(3) without time zone,
    last_sync_status text,
    last_sync_error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    last_ingestion_mode text,
    auth_mode_used text,
    last_http_status integer,
    endpoint_used text,
    last_successful_sync_at timestamp(3) without time zone
);


--
-- Name: llm_credit_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_credit_deposits (
    id text NOT NULL,
    app_account_id text NOT NULL,
    recipient_public_key text NOT NULL,
    network text NOT NULL,
    asset public."LlmCreditDepositAsset" NOT NULL,
    mint text,
    decimals integer NOT NULL,
    reference_public_key text NOT NULL,
    payment_url text NOT NULL,
    expected_amount_atomic bigint NOT NULL,
    minimum_amount_atomic bigint,
    maximum_amount_atomic bigint,
    received_amount_atomic bigint,
    quoted_cents integer NOT NULL,
    credited_cents integer,
    sol_usd_price_micros bigint,
    quote_expires_at timestamp(3) without time zone NOT NULL,
    status public."LlmCreditDepositStatus" DEFAULT 'CREATED'::public."LlmCreditDepositStatus" NOT NULL,
    confirmation_status text,
    last_sync_attempt_at timestamp(3) without time zone,
    sync_attempt_count integer DEFAULT 0 NOT NULL,
    validation_json jsonb,
    signature text,
    slot bigint,
    failure_reason text,
    confirmed_at timestamp(3) without time zone,
    settled_at timestamp(3) without time zone,
    credit_ledger_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: llm_provider_balance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_provider_balance_snapshots (
    id text NOT NULL,
    provider text NOT NULL,
    balance_usd_micros bigint NOT NULL,
    raw_response jsonb,
    captured_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT llm_provider_balance_snapshots_balance_check CHECK ((balance_usd_micros >= 0))
);


--
-- Name: llm_run_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_run_usage (
    id text NOT NULL,
    run_id text NOT NULL,
    app_account_id text NOT NULL,
    agent_db_id integer NOT NULL,
    status public."LlmRunUsageStatus" DEFAULT 'PENDING'::public."LlmRunUsageStatus" NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    reasoning_tokens integer DEFAULT 0 NOT NULL,
    cached_input_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    charge_cents integer DEFAULT 0 NOT NULL,
    local_cost_usd_micros bigint DEFAULT 0 NOT NULL,
    provider_cost_usd_micros bigint DEFAULT 0 NOT NULL,
    reconciled_cost_usd_micros bigint,
    reconciliation_status public."LlmReconciliationStatus" DEFAULT 'NOT_APPLICABLE'::public."LlmReconciliationStatus" NOT NULL,
    error_message text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT llm_run_usage_nonnegative_check CHECK (((input_tokens >= 0) AND (output_tokens >= 0) AND (reasoning_tokens >= 0) AND (cached_input_tokens >= 0) AND (cache_write_tokens >= 0) AND (total_tokens >= 0) AND (charge_cents >= 0) AND (local_cost_usd_micros >= 0) AND (provider_cost_usd_micros >= 0) AND ((reconciled_cost_usd_micros IS NULL) OR (reconciled_cost_usd_micros >= 0)))),
    CONSTRAINT llm_run_usage_terminal_completed_check CHECK ((((status = ANY (ARRAY['COMPLETE'::public."LlmRunUsageStatus", 'FAILED'::public."LlmRunUsageStatus", 'CANCELLED'::public."LlmRunUsageStatus"])) AND (completed_at IS NOT NULL)) OR ((status = 'PENDING'::public."LlmRunUsageStatus") AND (completed_at IS NULL))))
);


--
-- Name: mesh_signal_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mesh_signal_deliveries (
    id text NOT NULL,
    signal_id text NOT NULL,
    subscription_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_http_status integer,
    delivered_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: metaplex_launch_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metaplex_launch_attempts (
    id text NOT NULL,
    public_attribution_id text NOT NULL,
    agent_db_id integer NOT NULL,
    user_profile_id integer,
    wallet_address text NOT NULL,
    network text DEFAULT 'devnet'::text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    input_snapshot jsonb,
    image_uri text,
    metadata_uri text,
    asset_address text,
    identity_pda text,
    token_mint text,
    genesis_address text,
    metaplex_launch_url text,
    agent_tx_signature text,
    genesis_tx_signatures jsonb DEFAULT '[]'::jsonb NOT NULL,
    ar_agent_id integer,
    error_code text,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    permanent_bind_confirmed boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    completed_at timestamp(3) without time zone,
    processing_lease_token text,
    processing_lease_expires_at timestamp(3) with time zone,
    public_creator_wallet text
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id text NOT NULL,
    idempotency_key text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    kind text NOT NULL,
    recipient text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    delivered_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    last_http_status integer,
    response_preview text
);


--
-- Name: order_post_activations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_post_activations (
    order_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    completed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: partner_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_jobs (
    id text NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    job_type text DEFAULT ''::text NOT NULL,
    reward_amount numeric(18,8),
    reward_currency text DEFAULT ''::text NOT NULL,
    chain text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    apply_url text DEFAULT ''::text NOT NULL,
    source_job_url text DEFAULT ''::text NOT NULL,
    source_status_url text,
    source_secret text,
    requirements jsonb,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    first_seen_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    ingestion_mode text DEFAULT 'api'::text NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    curated_by text,
    is_sample boolean DEFAULT false NOT NULL
);


--
-- Name: raw_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_events (
    id text NOT NULL,
    "walletAddress" text NOT NULL,
    "chainId" integer NOT NULL,
    "linkedAgentDbId" integer,
    "eventType" public."CommerceEventType" NOT NULL,
    "volumeUsd" numeric(24,8) NOT NULL,
    "feeUsd" numeric(24,8) NOT NULL,
    "txHash" text NOT NULL,
    "eventIndex" integer DEFAULT 0 NOT NULL,
    "occurredAt" timestamp(3) without time zone NOT NULL,
    "ingestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "classificationSource" text
);


--
-- Name: registration_document_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registration_document_observations (
    id text NOT NULL,
    source_uri text NOT NULL,
    normalized_uri text NOT NULL,
    source_content_address text,
    cid_version integer,
    cid_codec text,
    cid_multihash_code text,
    cid_digest text,
    ipfs_path text,
    retrieval_method text NOT NULL,
    availability_status text NOT NULL,
    byte_integrity_status text CONSTRAINT registration_document_observatio_byte_integrity_status_not_null NOT NULL,
    json_validity_status text CONSTRAINT registration_document_observation_json_validity_status_not_null NOT NULL,
    schema_validity_status text CONSTRAINT registration_document_observati_schema_validity_status_not_null NOT NULL,
    raw_document_digest text NOT NULL,
    normalized_fingerprint text,
    raw_bytes bytea NOT NULL,
    parsed_core jsonb,
    extensions jsonb,
    decoder_version text NOT NULL,
    immutable boolean DEFAULT false NOT NULL,
    fetched_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: robinhood_chain_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robinhood_chain_launches (
    id text NOT NULL,
    token_address text NOT NULL,
    creator_wallet text NOT NULL,
    pool_address text,
    pair_token text,
    dex_factory text,
    dex_id integer,
    launch_config_id integer,
    position_id text,
    restrictions_end_block text,
    initial_buy_amount text,
    tx_hash text NOT NULL,
    block_number text NOT NULL,
    block_timestamp timestamp(3) without time zone NOT NULL,
    chain_id integer DEFAULT 4663 NOT NULL,
    source text DEFAULT 'quiver'::text NOT NULL,
    frontend_source_label text DEFAULT 'AgentRanking Launch'::text NOT NULL,
    launched_via_agent_ranking boolean DEFAULT true NOT NULL,
    source_verified boolean DEFAULT false NOT NULL,
    fee_splitter_address text,
    creator_fee_bps integer,
    protocol_fee_bps integer,
    token_name text,
    token_symbol text,
    token_description text,
    token_image_url text,
    website text,
    twitter text,
    telegram text,
    discord text,
    farcaster text,
    agent_db_id integer,
    decimals integer,
    total_supply text,
    on_chain_pool_fee integer,
    max_wallet_limit text,
    max_tx_limit text,
    on_chain_restriction_end_block text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    token_image_original_url text,
    token_logo_ipfs_cid text,
    token_logo_ipfs_uri text,
    token_logo_gateway_url text,
    on_chain_logo_url text
);


--
-- Name: robinhood_fee_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robinhood_fee_claims (
    id text NOT NULL,
    launch_id text NOT NULL,
    agent_db_id integer NOT NULL,
    token_address text NOT NULL,
    position_id text NOT NULL,
    creator_wallet text NOT NULL,
    locker_address text NOT NULL,
    claim_tx_hash text NOT NULL,
    claimed_asset text NOT NULL,
    claimed_raw_amount text NOT NULL,
    chain_id integer DEFAULT 4663 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    failure_reason text,
    confirmed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: robinhood_launch_preparations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robinhood_launch_preparations (
    id text NOT NULL,
    agent_db_id integer,
    creator_wallet text NOT NULL,
    token_name text NOT NULL,
    token_symbol text NOT NULL,
    token_description text,
    token_image_original_url text NOT NULL,
    token_logo_ipfs_cid text NOT NULL,
    token_logo_ipfs_uri text NOT NULL,
    token_logo_gateway_url text NOT NULL,
    logo_mime_type text NOT NULL,
    logo_size_bytes integer NOT NULL,
    logo_width integer NOT NULL,
    logo_height integer NOT NULL,
    website text,
    twitter text,
    telegram text,
    discord text,
    farcaster text,
    prepared_to text NOT NULL,
    prepared_data text NOT NULL,
    prepared_value text NOT NULL,
    launch_config_id integer NOT NULL,
    dex_id integer NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consumed_tx_hash text
);


--
-- Name: sap_agent_operator_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sap_agent_operator_claims (
    id text NOT NULL,
    agent_id integer NOT NULL,
    user_profile_id integer NOT NULL,
    solana_wallet text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sap_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sap_sync_logs (
    id text NOT NULL,
    synced_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    agents_found integer DEFAULT 0 NOT NULL,
    agents_upserted integer DEFAULT 0 NOT NULL,
    errors jsonb,
    duration_ms integer DEFAULT 0 NOT NULL,
    new_agents jsonb
);


--
-- Name: site_news_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_news_articles (
    id integer NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    excerpt text NOT NULL,
    content text,
    content_before_list text,
    content_after_list text,
    image text NOT NULL,
    published_at timestamp(3) without time zone NOT NULL,
    author text DEFAULT 'AgentRanking'::text NOT NULL,
    category text,
    agent_list jsonb,
    how_to_steps jsonb,
    faq jsonb,
    news_embeds jsonb,
    published boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: site_news_articles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_news_articles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_news_articles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_news_articles_id_seq OWNED BY public.site_news_articles.id;


--
-- Name: solana_8004_trust_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_8004_trust_observations (
    id text NOT NULL,
    event_key text NOT NULL,
    parent_key text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    integrity_status text NOT NULL,
    program_id text NOT NULL,
    agent_account_pda text,
    asset_address text NOT NULL,
    client_address text NOT NULL,
    responder_address text,
    feedback_index bigint NOT NULL,
    raw_value text,
    value_decimals integer,
    exact_value text,
    score integer,
    feedback_file_hash text,
    tag1 text,
    tag2 text,
    endpoint text,
    feedback_uri text,
    response_uri text,
    response_hash text,
    seal_hash text NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    signature text NOT NULL,
    slot bigint NOT NULL,
    block_time timestamp(3) with time zone,
    event_ordinal integer NOT NULL,
    outer_instruction_index integer,
    inner_instruction_ordinal integer,
    decoder_version text NOT NULL,
    raw_data jsonb,
    agent_db_id integer,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT solana_8004_trust_observations_event_ordinal_check CHECK ((event_ordinal >= 0)),
    CONSTRAINT solana_8004_trust_observations_feedback_index_check CHECK ((feedback_index >= 0)),
    CONSTRAINT solana_8004_trust_observations_inner_instruction_check CHECK (((inner_instruction_ordinal IS NULL) OR (inner_instruction_ordinal >= 0))),
    CONSTRAINT solana_8004_trust_observations_integrity_check CHECK ((integrity_status = ANY (ARRAY['SELF'::text, 'MATCH'::text, 'MISMATCH'::text, 'PARENT_MISSING'::text]))),
    CONSTRAINT solana_8004_trust_observations_kind_check CHECK ((kind = ANY (ARRAY['FEEDBACK'::text, 'RESPONSE'::text, 'REVOCATION'::text]))),
    CONSTRAINT solana_8004_trust_observations_outer_instruction_check CHECK (((outer_instruction_index IS NULL) OR (outer_instruction_index >= 0))),
    CONSTRAINT solana_8004_trust_observations_score_check CHECK (((score IS NULL) OR ((score >= 0) AND (score <= 100)))),
    CONSTRAINT solana_8004_trust_observations_slot_check CHECK ((slot >= 0)),
    CONSTRAINT solana_8004_trust_observations_status_check CHECK ((status = ANY (ARRAY['FINALIZED'::text, 'ORPHANED'::text, 'INVALID'::text]))),
    CONSTRAINT solana_8004_trust_observations_value_decimals_check CHECK (((value_decimals IS NULL) OR ((value_decimals >= 0) AND (value_decimals <= 18))))
);


--
-- Name: solana_8004_trust_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_8004_trust_signatures (
    signature text NOT NULL,
    slot bigint NOT NULL,
    block_time timestamp(3) with time zone,
    status text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    endpoint_key text,
    first_seen_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT solana_8004_trust_signatures_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT solana_8004_trust_signatures_slot_check CHECK ((slot >= 0)),
    CONSTRAINT solana_8004_trust_signatures_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETE'::text, 'NO_TRUST'::text, 'PRUNED'::text, 'FAILED'::text])))
);


--
-- Name: solana_agent_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_agent_observations (
    id text NOT NULL,
    business_key text NOT NULL,
    asset text NOT NULL,
    sequence_id bigint,
    owner text,
    creator text,
    operational_wallet text,
    agent_uri text,
    canonical_status text NOT NULL,
    commitment text NOT NULL,
    slot bigint,
    transaction_signature text,
    transaction_index integer,
    event_ordinal integer,
    block_hash text,
    parent_slot bigint,
    block_time timestamp(3) with time zone,
    indexer_updated_at timestamp(3) with time zone,
    official_rank bigint,
    atom_trust_tier text,
    raw_feedback_value text,
    feedback_decimals integer,
    exact_feedback_value text,
    parent_entity_key text,
    materialization_eligible boolean DEFAULT false NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    source_version text,
    raw_data jsonb,
    observed_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: solana_registry_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_registry_memberships (
    id text NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    registry_address text NOT NULL,
    agent_db_id integer NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    source_active boolean,
    last_seen_generation bigint NOT NULL,
    source_slot bigint,
    source_updated_at timestamp(3) with time zone,
    raw_data jsonb,
    first_seen_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT solana_registry_memberships_generation_check CHECK ((last_seen_generation >= 0)),
    CONSTRAINT solana_registry_memberships_identity_check CHECK (((length(btrim(external_id)) > 0) AND (length(btrim(registry_address)) > 0))),
    CONSTRAINT solana_registry_memberships_source_check CHECK ((source = ANY (ARRAY['solana-8004'::text, 'metaplex-agent-registry'::text]))),
    CONSTRAINT solana_registry_memberships_source_slot_check CHECK (((source_slot IS NULL) OR (source_slot >= 0)))
);


--
-- Name: solana_registry_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_registry_snapshots (
    id text NOT NULL,
    source text NOT NULL,
    generation bigint NOT NULL,
    status text NOT NULL,
    registry_address text NOT NULL,
    source_slot bigint,
    reported_count integer,
    discovered_count integer DEFAULT 0 NOT NULL,
    indexed_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    started_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) with time zone,
    error_message text,
    source_offset integer DEFAULT 0 NOT NULL,
    inventory_count integer,
    inventory_digest text,
    proof_count integer DEFAULT 0 NOT NULL,
    terminal_reject_count integer DEFAULT 0 NOT NULL,
    rpc_endpoint_key text,
    genesis_hash text,
    program_id text,
    idl_hash text,
    inventory_start_slot bigint,
    inventory_end_slot bigint,
    configuration_fingerprint text,
    base_collection text,
    root_config_pda text,
    registry_config_pda text,
    CONSTRAINT solana_registry_snapshots_complete_coverage_check CHECK (((status <> 'complete'::text) OR ((rejected_count = 0) AND (indexed_count = discovered_count) AND ((reported_count IS NULL) OR (reported_count = discovered_count))))),
    CONSTRAINT solana_registry_snapshots_completion_time_check CHECK ((((status = 'running'::text) AND (completed_at IS NULL)) OR ((status = ANY (ARRAY['complete'::text, 'failed'::text])) AND (completed_at IS NOT NULL)))),
    CONSTRAINT solana_registry_snapshots_counts_check CHECK ((((reported_count IS NULL) OR (reported_count >= 0)) AND (source_offset >= 0) AND (discovered_count >= 0) AND (indexed_count >= 0) AND (rejected_count >= 0) AND ((indexed_count + rejected_count) <= discovered_count))),
    CONSTRAINT solana_registry_snapshots_generation_check CHECK ((generation > 0)),
    CONSTRAINT solana_registry_snapshots_registry_address_check CHECK ((length(btrim(registry_address)) > 0)),
    CONSTRAINT solana_registry_snapshots_source_check CHECK ((source = ANY (ARRAY['solana-8004'::text, 'metaplex-agent-registry'::text]))),
    CONSTRAINT solana_registry_snapshots_source_slot_check CHECK (((source_slot IS NULL) OR (source_slot >= 0))),
    CONSTRAINT solana_registry_snapshots_status_check CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'failed'::text])))
);


--
-- Name: solana_transaction_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solana_transaction_observations (
    signature text NOT NULL,
    slot bigint,
    transaction_version text,
    status text NOT NULL,
    commitment text NOT NULL,
    meta_available boolean DEFAULT false NOT NULL,
    execution_error jsonb,
    expected_program_id text,
    expected_program_executed boolean DEFAULT false CONSTRAINT solana_transaction_observati_expected_program_executed_not_null NOT NULL,
    static_account_keys jsonb,
    loaded_writable_keys jsonb,
    loaded_readonly_keys jsonb,
    resolved_account_keys jsonb,
    outer_instructions jsonb,
    inner_instructions jsonb,
    genesis_hash text,
    rpc_version text,
    first_available_block bigint,
    minimum_ledger_slot bigint,
    endpoint_key text,
    verified_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    decoded_instructions jsonb,
    instruction_decoder_version text,
    block_time timestamp(3) with time zone,
    log_messages jsonb
);


--
-- Name: webhook_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_receipts (
    id text NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    payload_hash text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    last_error text,
    processing_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: worker_resource_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_resource_leases (
    resource_key text NOT NULL,
    slot integer NOT NULL,
    holder text NOT NULL,
    lease_until timestamp(3) with time zone NOT NULL,
    heartbeat_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT worker_resource_leases_nonnegative_slot CHECK ((slot >= 0)),
    CONSTRAINT worker_resource_leases_time_order_check CHECK ((lease_until >= heartbeat_at))
);


--
-- Name: worker_resource_rate_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_resource_rate_budgets (
    resource_key text NOT NULL,
    capacity integer NOT NULL,
    interval_ms integer NOT NULL,
    theoretical_arrival_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT worker_resource_rate_budgets_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT worker_resource_rate_budgets_interval_check CHECK ((interval_ms > 0))
);


--
-- Name: worker_resource_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_resource_states (
    resource_key text NOT NULL,
    capacity integer NOT NULL,
    min_capacity integer NOT NULL,
    max_capacity integer NOT NULL,
    success_window_target integer NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_streak integer DEFAULT 0 NOT NULL,
    decrease_factor double precision NOT NULL,
    latency_ewma_ms double precision DEFAULT 0 NOT NULL,
    rate_limited_until timestamp(6) with time zone,
    cooling_until timestamp(6) with time zone,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT worker_resource_states_capacity_check CHECK (((min_capacity > 0) AND (max_capacity >= min_capacity) AND ((capacity >= min_capacity) AND (capacity <= max_capacity)))),
    CONSTRAINT worker_resource_states_decrease_check CHECK (((decrease_factor > (0)::double precision) AND (decrease_factor < (1)::double precision))),
    CONSTRAINT worker_resource_states_failure_check CHECK ((failure_streak >= 0)),
    CONSTRAINT worker_resource_states_latency_check CHECK ((latency_ewma_ms >= (0)::double precision)),
    CONSTRAINT worker_resource_states_success_check CHECK (((success_window_target > 0) AND (success_count >= 0) AND (success_count < success_window_target)))
);


--
-- Name: AdOrder id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrder" ALTER COLUMN id SET DEFAULT nextval('public."AdOrder_id_seq"'::regclass);


--
-- Name: AdOrderSquare id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrderSquare" ALTER COLUMN id SET DEFAULT nextval('public."AdOrderSquare_id_seq"'::regclass);


--
-- Name: AdOrderStrip id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrderStrip" ALTER COLUMN id SET DEFAULT nextval('public."AdOrderStrip_id_seq"'::regclass);


--
-- Name: AdPackage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdPackage" ALTER COLUMN id SET DEFAULT nextval('public."AdPackage_id_seq"'::regclass);


--
-- Name: Agent id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent" ALTER COLUMN id SET DEFAULT nextval('public."Agent_id_seq"'::regclass);


--
-- Name: AgentAlertRule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAlertRule" ALTER COLUMN id SET DEFAULT nextval('public."AgentAlertRule_id_seq"'::regclass);


--
-- Name: AgentAnalyticsEvent id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAnalyticsEvent" ALTER COLUMN id SET DEFAULT nextval('public."AgentAnalyticsEvent_id_seq"'::regclass);


--
-- Name: AgentBoost id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentBoost" ALTER COLUMN id SET DEFAULT nextval('public."AgentBoost_id_seq"'::regclass);


--
-- Name: AgentChainVerification id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentChainVerification" ALTER COLUMN id SET DEFAULT nextval('public."AgentChainVerification_id_seq"'::regclass);


--
-- Name: AgentMcpOffer id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMcpOffer" ALTER COLUMN id SET DEFAULT nextval('public."AgentMcpOffer_id_seq"'::regclass);


--
-- Name: AgentMetadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMetadata" ALTER COLUMN id SET DEFAULT nextval('public."AgentMetadata_id_seq"'::regclass);


--
-- Name: AgentPerfSnapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentPerfSnapshot" ALTER COLUMN id SET DEFAULT nextval('public."AgentPerfSnapshot_id_seq"'::regclass);


--
-- Name: AgentRankSnapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentRankSnapshot" ALTER COLUMN id SET DEFAULT nextval('public."AgentRankSnapshot_id_seq"'::regclass);


--
-- Name: AgentService id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentService" ALTER COLUMN id SET DEFAULT nextval('public."AgentService_id_seq"'::regclass);


--
-- Name: AgentStar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentStar" ALTER COLUMN id SET DEFAULT nextval('public."AgentStar_id_seq"'::regclass);


--
-- Name: AgentVote id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVote" ALTER COLUMN id SET DEFAULT nextval('public."AgentVote_id_seq"'::regclass);


--
-- Name: Chain id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chain" ALTER COLUMN id SET DEFAULT nextval('public."Chain_id_seq"'::regclass);


--
-- Name: ContactInquiry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContactInquiry" ALTER COLUMN id SET DEFAULT nextval('public."ContactInquiry_id_seq"'::regclass);


--
-- Name: ContactInquiryReply id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContactInquiryReply" ALTER COLUMN id SET DEFAULT nextval('public."ContactInquiryReply_id_seq"'::regclass);


--
-- Name: ConversionEvent id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ConversionEvent" ALTER COLUMN id SET DEFAULT nextval('public."ConversionEvent_id_seq"'::regclass);


--
-- Name: DaoLeaderboardLive id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardLive" ALTER COLUMN id SET DEFAULT nextval('public."DaoLeaderboardLive_id_seq"'::regclass);


--
-- Name: DaoLeaderboardSnapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardSnapshot" ALTER COLUMN id SET DEFAULT nextval('public."DaoLeaderboardSnapshot_id_seq"'::regclass);


--
-- Name: Feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Feedback" ALTER COLUMN id SET DEFAULT nextval('public."Feedback_id_seq"'::regclass);


--
-- Name: ProfileFollow id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProfileFollow" ALTER COLUMN id SET DEFAULT nextval('public."ProfileFollow_id_seq"'::regclass);


--
-- Name: Promotion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotion" ALTER COLUMN id SET DEFAULT nextval('public."Promotion_id_seq"'::regclass);


--
-- Name: PromotionPrice id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionPrice" ALTER COLUMN id SET DEFAULT nextval('public."PromotionPrice_id_seq"'::regclass);


--
-- Name: SyncState id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncState" ALTER COLUMN id SET DEFAULT nextval('public."SyncState_id_seq"'::regclass);


--
-- Name: UserProfile id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserProfile" ALTER COLUMN id SET DEFAULT nextval('public."UserProfile_id_seq"'::regclass);


--
-- Name: agent_analytics_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_analytics_daily ALTER COLUMN id SET DEFAULT nextval('public.agent_analytics_daily_id_seq'::regclass);


--
-- Name: agent_official_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_official_links ALTER COLUMN id SET DEFAULT nextval('public.agent_official_links_id_seq'::regclass);


--
-- Name: agent_paid_services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_paid_services ALTER COLUMN id SET DEFAULT nextval('public.agent_paid_services_id_seq'::regclass);


--
-- Name: job_interaction_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_interaction_events ALTER COLUMN id SET DEFAULT nextval('public.job_interaction_events_id_seq'::regclass);


--
-- Name: site_news_articles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_news_articles ALTER COLUMN id SET DEFAULT nextval('public.site_news_articles_id_seq'::regclass);


--
-- Name: AdOrderSquare AdOrderSquare_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrderSquare"
    ADD CONSTRAINT "AdOrderSquare_pkey" PRIMARY KEY (id);


--
-- Name: AdOrderStrip AdOrderStrip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrderStrip"
    ADD CONSTRAINT "AdOrderStrip_pkey" PRIMARY KEY (id);


--
-- Name: AdOrder AdOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdOrder"
    ADD CONSTRAINT "AdOrder_pkey" PRIMARY KEY (id);


--
-- Name: AdPackage AdPackage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdPackage"
    ADD CONSTRAINT "AdPackage_pkey" PRIMARY KEY (id);


--
-- Name: AdminLoginChallenge AdminLoginChallenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminLoginChallenge"
    ADD CONSTRAINT "AdminLoginChallenge_pkey" PRIMARY KEY (id);


--
-- Name: AgentAlertRule AgentAlertRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAlertRule"
    ADD CONSTRAINT "AgentAlertRule_pkey" PRIMARY KEY (id);


--
-- Name: AgentAnalyticsEvent AgentAnalyticsEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAnalyticsEvent"
    ADD CONSTRAINT "AgentAnalyticsEvent_pkey" PRIMARY KEY (id);


--
-- Name: AgentBlocklistRule AgentBlocklistRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentBlocklistRule"
    ADD CONSTRAINT "AgentBlocklistRule_pkey" PRIMARY KEY (id);


--
-- Name: AgentBoost AgentBoost_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentBoost"
    ADD CONSTRAINT "AgentBoost_pkey" PRIMARY KEY (id);


--
-- Name: AgentChainVerification AgentChainVerification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentChainVerification"
    ADD CONSTRAINT "AgentChainVerification_pkey" PRIMARY KEY (id);


--
-- Name: AgentMcpOffer AgentMcpOffer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMcpOffer"
    ADD CONSTRAINT "AgentMcpOffer_pkey" PRIMARY KEY (id);


--
-- Name: AgentMetadata AgentMetadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMetadata"
    ADD CONSTRAINT "AgentMetadata_pkey" PRIMARY KEY (id);


--
-- Name: AgentPerfSnapshot AgentPerfSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentPerfSnapshot"
    ADD CONSTRAINT "AgentPerfSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: AgentRankSnapshot AgentRankSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentRankSnapshot"
    ADD CONSTRAINT "AgentRankSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: AgentReport AgentReport_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentReport"
    ADD CONSTRAINT "AgentReport_pkey" PRIMARY KEY (id);


--
-- Name: AgentService AgentService_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentService"
    ADD CONSTRAINT "AgentService_pkey" PRIMARY KEY (id);


--
-- Name: AgentStar AgentStar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentStar"
    ADD CONSTRAINT "AgentStar_pkey" PRIMARY KEY (id);


--
-- Name: AgentVerificationRequest AgentVerificationRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVerificationRequest"
    ADD CONSTRAINT "AgentVerificationRequest_pkey" PRIMARY KEY (id);


--
-- Name: AgentVote AgentVote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVote"
    ADD CONSTRAINT "AgentVote_pkey" PRIMARY KEY (id);


--
-- Name: Agent Agent_agent_evm_wallet_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_agent_evm_wallet_id_key" UNIQUE (agent_evm_wallet_id);


--
-- Name: Agent Agent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_pkey" PRIMARY KEY (id);


--
-- Name: ArHolderAgentPerk ArHolderAgentPerk_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArHolderAgentPerk"
    ADD CONSTRAINT "ArHolderAgentPerk_pkey" PRIMARY KEY (id);


--
-- Name: ArPayoutBatch ArPayoutBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArPayoutBatch"
    ADD CONSTRAINT "ArPayoutBatch_pkey" PRIMARY KEY (id);


--
-- Name: ArPayoutWallet ArPayoutWallet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArPayoutWallet"
    ADD CONSTRAINT "ArPayoutWallet_pkey" PRIMARY KEY (id);


--
-- Name: ArReferralAdjustment ArReferralAdjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralAdjustment"
    ADD CONSTRAINT "ArReferralAdjustment_pkey" PRIMARY KEY (id);


--
-- Name: ArReferralCode ArReferralCode_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralCode"
    ADD CONSTRAINT "ArReferralCode_pkey" PRIMARY KEY (id);


--
-- Name: ArReferralCommission ArReferralCommission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralCommission"
    ADD CONSTRAINT "ArReferralCommission_pkey" PRIMARY KEY (id);


--
-- Name: ArReferralEvent ArReferralEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralEvent"
    ADD CONSTRAINT "ArReferralEvent_pkey" PRIMARY KEY (id);


--
-- Name: ArStakePerkOverride ArStakePerkOverride_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArStakePerkOverride"
    ADD CONSTRAINT "ArStakePerkOverride_pkey" PRIMARY KEY (id);


--
-- Name: ArStakePerkRule ArStakePerkRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArStakePerkRule"
    ADD CONSTRAINT "ArStakePerkRule_pkey" PRIMARY KEY (id);


--
-- Name: ArStakePosition ArStakePosition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArStakePosition"
    ADD CONSTRAINT "ArStakePosition_pkey" PRIMARY KEY (id);


--
-- Name: ArTokenHolderSnapshot ArTokenHolderSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArTokenHolderSnapshot"
    ADD CONSTRAINT "ArTokenHolderSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: ArTokenMetricEvent ArTokenMetricEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArTokenMetricEvent"
    ADD CONSTRAINT "ArTokenMetricEvent_pkey" PRIMARY KEY (id);


--
-- Name: ArTokenPerkConfig ArTokenPerkConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArTokenPerkConfig"
    ADD CONSTRAINT "ArTokenPerkConfig_pkey" PRIMARY KEY (id);


--
-- Name: ArTokenSettings ArTokenSettings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArTokenSettings"
    ADD CONSTRAINT "ArTokenSettings_pkey" PRIMARY KEY (id);


--
-- Name: BountyDispute BountyDispute_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BountyDispute"
    ADD CONSTRAINT "BountyDispute_pkey" PRIMARY KEY (id);


--
-- Name: Bounty Bounty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Bounty"
    ADD CONSTRAINT "Bounty_pkey" PRIMARY KEY (id);


--
-- Name: Chain Chain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Chain"
    ADD CONSTRAINT "Chain_pkey" PRIMARY KEY (id);


--
-- Name: ContactInquiryReply ContactInquiryReply_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContactInquiryReply"
    ADD CONSTRAINT "ContactInquiryReply_pkey" PRIMARY KEY (id);


--
-- Name: ContactInquiry ContactInquiry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContactInquiry"
    ADD CONSTRAINT "ContactInquiry_pkey" PRIMARY KEY (id);


--
-- Name: ConversionEvent ConversionEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ConversionEvent"
    ADD CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY (id);


--
-- Name: DaoLeaderboardLive DaoLeaderboardLive_agentId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardLive"
    ADD CONSTRAINT "DaoLeaderboardLive_agentId_key" UNIQUE ("agentId");


--
-- Name: DaoLeaderboardLive DaoLeaderboardLive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardLive"
    ADD CONSTRAINT "DaoLeaderboardLive_pkey" PRIMARY KEY (id);


--
-- Name: DaoLeaderboardSnapshot DaoLeaderboardSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardSnapshot"
    ADD CONSTRAINT "DaoLeaderboardSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: Feedback Feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Feedback"
    ADD CONSTRAINT "Feedback_pkey" PRIMARY KEY (id);


--
-- Name: MeshSignal MeshSignal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MeshSignal"
    ADD CONSTRAINT "MeshSignal_pkey" PRIMARY KEY (id);


--
-- Name: MeshSubscription MeshSubscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MeshSubscription"
    ADD CONSTRAINT "MeshSubscription_pkey" PRIMARY KEY (id);


--
-- Name: Order Order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);


--
-- Name: ProfileFollow ProfileFollow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProfileFollow"
    ADD CONSTRAINT "ProfileFollow_pkey" PRIMARY KEY (id);


--
-- Name: PromotionPrice PromotionPrice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PromotionPrice"
    ADD CONSTRAINT "PromotionPrice_pkey" PRIMARY KEY (id);


--
-- Name: Promotion Promotion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotion"
    ADD CONSTRAINT "Promotion_pkey" PRIMARY KEY (id);


--
-- Name: SyncState SyncState_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncState"
    ADD CONSTRAINT "SyncState_pkey" PRIMARY KEY (id);


--
-- Name: TrustEvent TrustEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TrustEvent"
    ADD CONSTRAINT "TrustEvent_pkey" PRIMARY KEY (id);


--
-- Name: UserProfile UserProfile_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserProfile"
    ADD CONSTRAINT "UserProfile_email_key" UNIQUE (email);


--
-- Name: UserProfile UserProfile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserProfile"
    ADD CONSTRAINT "UserProfile_pkey" PRIMARY KEY (id);


--
-- Name: WalletLinkChallenge WalletLinkChallenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WalletLinkChallenge"
    ADD CONSTRAINT "WalletLinkChallenge_pkey" PRIMARY KEY (id);


--
-- Name: account_credit_ledger account_credit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_credit_ledger
    ADD CONSTRAINT account_credit_ledger_pkey PRIMARY KEY (id);


--
-- Name: agent_alert_deliveries agent_alert_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_alert_deliveries
    ADD CONSTRAINT agent_alert_deliveries_pkey PRIMARY KEY (id);


--
-- Name: agent_alert_events agent_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_alert_events
    ADD CONSTRAINT agent_alert_events_pkey PRIMARY KEY (id);


--
-- Name: agent_analytics_daily agent_analytics_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_analytics_daily
    ADD CONSTRAINT agent_analytics_daily_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_conversations agent_chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_conversations
    ADD CONSTRAINT agent_chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_conversations agent_chat_conversations_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_conversations
    ADD CONSTRAINT agent_chat_conversations_scope_key UNIQUE (id, app_account_id, agent_db_id);


--
-- Name: agent_chat_messages agent_chat_messages_conversation_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_messages
    ADD CONSTRAINT agent_chat_messages_conversation_id_id_key UNIQUE (conversation_id, id);


--
-- Name: agent_chat_messages agent_chat_messages_conversation_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_messages
    ADD CONSTRAINT agent_chat_messages_conversation_sequence_key UNIQUE (conversation_id, sequence);


--
-- Name: agent_chat_messages agent_chat_messages_conversation_ui_message_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_messages
    ADD CONSTRAINT agent_chat_messages_conversation_ui_message_key UNIQUE (conversation_id, ui_message_id);


--
-- Name: agent_chat_messages agent_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_messages
    ADD CONSTRAINT agent_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_run_attempts agent_chat_run_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_run_attempts
    ADD CONSTRAINT agent_chat_run_attempts_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_run_attempts agent_chat_run_attempts_run_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_run_attempts
    ADD CONSTRAINT agent_chat_run_attempts_run_sequence_key UNIQUE (run_id, sequence);


--
-- Name: agent_chat_run_runtime agent_chat_run_runtime_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_run_runtime
    ADD CONSTRAINT agent_chat_run_runtime_pkey PRIMARY KEY (run_id);


--
-- Name: agent_chat_runs agent_chat_runs_assistant_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_assistant_message_id_key UNIQUE (assistant_message_id);


--
-- Name: agent_chat_runs agent_chat_runs_conversation_assistant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_conversation_assistant_key UNIQUE (conversation_id, assistant_message_id);


--
-- Name: agent_chat_runs agent_chat_runs_id_assistant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_id_assistant_key UNIQUE (id, assistant_message_id);


--
-- Name: agent_chat_runs agent_chat_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_runs agent_chat_runs_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_request_id_key UNIQUE (request_id);


--
-- Name: agent_chat_runs agent_chat_runs_reservation_ledger_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_reservation_ledger_id_key UNIQUE (reservation_ledger_id);


--
-- Name: agent_chat_runs agent_chat_runs_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_scope_key UNIQUE (id, app_account_id, agent_db_id);


--
-- Name: agent_chat_runs agent_chat_runs_settlement_ledger_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_settlement_ledger_id_key UNIQUE (settlement_ledger_id);


--
-- Name: agent_chat_settings agent_chat_settings_agent_db_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_agent_db_id_key UNIQUE (agent_db_id);


--
-- Name: agent_chat_settings agent_chat_settings_current_revision_agent_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_current_revision_agent_key UNIQUE (current_revision_id, agent_db_id);


--
-- Name: agent_chat_settings agent_chat_settings_id_agent_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_id_agent_key UNIQUE (id, agent_db_id);


--
-- Name: agent_chat_settings agent_chat_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_settings_revisions agent_chat_settings_revisions_id_agent_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings_revisions
    ADD CONSTRAINT agent_chat_settings_revisions_id_agent_key UNIQUE (id, agent_db_id);


--
-- Name: agent_chat_settings_revisions agent_chat_settings_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings_revisions
    ADD CONSTRAINT agent_chat_settings_revisions_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_settings_revisions agent_chat_settings_revisions_settings_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings_revisions
    ADD CONSTRAINT agent_chat_settings_revisions_settings_revision_key UNIQUE (settings_id, revision);


--
-- Name: agent_chat_tool_events agent_chat_tool_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_tool_events
    ADD CONSTRAINT agent_chat_tool_events_pkey PRIMARY KEY (id);


--
-- Name: agent_chat_tool_events agent_chat_tool_events_run_tool_call_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_tool_events
    ADD CONSTRAINT agent_chat_tool_events_run_tool_call_key UNIQUE (run_id, tool_call_id);


--
-- Name: agent_github_connections agent_github_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_connections
    ADD CONSTRAINT agent_github_connections_pkey PRIMARY KEY (id);


--
-- Name: agent_github_push_notes agent_github_push_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_push_notes
    ADD CONSTRAINT agent_github_push_notes_pkey PRIMARY KEY (id);


--
-- Name: agent_github_snapshots agent_github_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_snapshots
    ADD CONSTRAINT agent_github_snapshots_pkey PRIMARY KEY (id);


--
-- Name: agent_launch_events agent_launch_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_events
    ADD CONSTRAINT agent_launch_events_pkey PRIMARY KEY (id);


--
-- Name: agent_launch_fee_distribution_attempts agent_launch_fee_distribution_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_fee_distribution_attempts
    ADD CONSTRAINT agent_launch_fee_distribution_attempts_pkey PRIMARY KEY (id);


--
-- Name: agent_launch_fee_distributions agent_launch_fee_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_fee_distributions
    ADD CONSTRAINT agent_launch_fee_distributions_pkey PRIMARY KEY (id);


--
-- Name: agent_launches agent_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launches
    ADD CONSTRAINT agent_launches_pkey PRIMARY KEY (id);


--
-- Name: agent_official_links agent_official_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_official_links
    ADD CONSTRAINT agent_official_links_pkey PRIMARY KEY (id);


--
-- Name: agent_paid_services agent_paid_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_paid_services
    ADD CONSTRAINT agent_paid_services_pkey PRIMARY KEY (id);


--
-- Name: agent_summaries agent_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_summaries
    ADD CONSTRAINT agent_summaries_pkey PRIMARY KEY ("walletAddress", "chainId");


--
-- Name: agent_verification_signals agent_verification_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_verification_signals
    ADD CONSTRAINT agent_verification_signals_pkey PRIMARY KEY (id);


--
-- Name: app_accounts app_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_accounts
    ADD CONSTRAINT app_accounts_pkey PRIMARY KEY (id);


--
-- Name: auth_accounts auth_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT auth_accounts_pkey PRIMARY KEY (id);


--
-- Name: auth_accounts auth_accounts_provider_providerAccountId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT "auth_accounts_provider_providerAccountId_key" UNIQUE (provider, "providerAccountId");


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_sessionToken_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "auth_sessions_sessionToken_key" UNIQUE ("sessionToken");


--
-- Name: auth_users auth_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_email_key UNIQUE (email);


--
-- Name: auth_users auth_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_users
    ADD CONSTRAINT auth_users_pkey PRIMARY KEY (id);


--
-- Name: auth_verification_tokens auth_verification_tokens_identifier_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_verification_tokens
    ADD CONSTRAINT auth_verification_tokens_identifier_token_key UNIQUE (identifier, token);


--
-- Name: auth_verification_tokens auth_verification_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_verification_tokens
    ADD CONSTRAINT auth_verification_tokens_token_key UNIQUE (token);


--
-- Name: cache_domain_revisions cache_domain_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_domain_revisions
    ADD CONSTRAINT cache_domain_revisions_pkey PRIMARY KEY (domain);


--
-- Name: cache_invalidation_outbox cache_invalidation_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_invalidation_outbox
    ADD CONSTRAINT cache_invalidation_outbox_pkey PRIMARY KEY (id);


--
-- Name: custodial_wallet_audit custodial_wallet_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custodial_wallet_audit
    ADD CONSTRAINT custodial_wallet_audit_pkey PRIMARY KEY (id);


--
-- Name: custodial_wallet_transfers custodial_wallet_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custodial_wallet_transfers
    ADD CONSTRAINT custodial_wallet_transfers_pkey PRIMARY KEY (id);


--
-- Name: custodial_wallets custodial_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custodial_wallets
    ADD CONSTRAINT custodial_wallets_pkey PRIMARY KEY (id);


--
-- Name: dashboard_auth_tokens dashboard_auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_auth_tokens
    ADD CONSTRAINT dashboard_auth_tokens_pkey PRIMARY KEY (id);


--
-- Name: evm_contract_generations evm_contract_generation_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_contract_generations
    ADD CONSTRAINT evm_contract_generation_identity UNIQUE (chain_id, proxy_address, implementation_address, implementation_code_hash);


--
-- Name: evm_contract_generations evm_contract_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_contract_generations
    ADD CONSTRAINT evm_contract_generations_pkey PRIMARY KEY (id);


--
-- Name: evm_event_observations evm_event_observations_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_event_observations
    ADD CONSTRAINT evm_event_observations_event_key_key UNIQUE (event_key);


--
-- Name: evm_event_observations evm_event_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_event_observations
    ADD CONSTRAINT evm_event_observations_pkey PRIMARY KEY (id);


--
-- Name: evm_feedback_observations evm_feedback_observations_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_feedback_observations
    ADD CONSTRAINT evm_feedback_observations_event_key_key UNIQUE (event_key);


--
-- Name: evm_feedback_observations evm_feedback_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_feedback_observations
    ADD CONSTRAINT evm_feedback_observations_pkey PRIMARY KEY (id);


--
-- Name: evm_identity_metadata_observations evm_identity_metadata_observations_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_identity_metadata_observations
    ADD CONSTRAINT evm_identity_metadata_observations_event_key_key UNIQUE (event_key);


--
-- Name: evm_identity_metadata_observations evm_identity_metadata_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_identity_metadata_observations
    ADD CONSTRAINT evm_identity_metadata_observations_pkey PRIMARY KEY (id);


--
-- Name: evm_identity_observations evm_identity_observations_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_identity_observations
    ADD CONSTRAINT evm_identity_observations_business_key_key UNIQUE (business_key);


--
-- Name: evm_identity_observations evm_identity_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_identity_observations
    ADD CONSTRAINT evm_identity_observations_pkey PRIMARY KEY (id);


--
-- Name: evm_validation_observations evm_validation_observations_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_validation_observations
    ADD CONSTRAINT evm_validation_observations_event_key_key UNIQUE (event_key);


--
-- Name: evm_validation_observations evm_validation_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_validation_observations
    ADD CONSTRAINT evm_validation_observations_pkey PRIMARY KEY (id);


--
-- Name: fairscale_agent_assessments fairscale_agent_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fairscale_agent_assessments
    ADD CONSTRAINT fairscale_agent_assessments_pkey PRIMARY KEY (id);


--
-- Name: indexer_bootstrap_epochs indexer_bootstrap_epochs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_bootstrap_epochs
    ADD CONSTRAINT indexer_bootstrap_epochs_pkey PRIMARY KEY (id);


--
-- Name: indexer_bootstrap_sources indexer_bootstrap_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_bootstrap_sources
    ADD CONSTRAINT indexer_bootstrap_sources_pkey PRIMARY KEY (id);


--
-- Name: indexer_bootstrap_work_items indexer_bootstrap_work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_bootstrap_work_items
    ADD CONSTRAINT indexer_bootstrap_work_items_pkey PRIMARY KEY (epoch_id, work_key);


--
-- Name: indexer_dead_letter_records indexer_dead_letter_records_dead_letter_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_dead_letter_records
    ADD CONSTRAINT indexer_dead_letter_records_dead_letter_job_id_key UNIQUE (dead_letter_job_id);


--
-- Name: indexer_dead_letter_records indexer_dead_letter_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_dead_letter_records
    ADD CONSTRAINT indexer_dead_letter_records_pkey PRIMARY KEY (id);


--
-- Name: indexer_endpoint_states indexer_endpoint_states_endpoint_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_endpoint_states
    ADD CONSTRAINT indexer_endpoint_states_endpoint_key_key UNIQUE (endpoint_key);


--
-- Name: indexer_endpoint_states indexer_endpoint_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_endpoint_states
    ADD CONSTRAINT indexer_endpoint_states_pkey PRIMARY KEY (id);


--
-- Name: indexer_idempotency_records indexer_idempotency_records_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_idempotency_records
    ADD CONSTRAINT indexer_idempotency_records_business_key_key UNIQUE (business_key);


--
-- Name: indexer_idempotency_records indexer_idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_idempotency_records
    ADD CONSTRAINT indexer_idempotency_records_pkey PRIMARY KEY (id);


--
-- Name: indexer_job_leases indexer_job_leases_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_job_leases
    ADD CONSTRAINT indexer_job_leases_business_key_key UNIQUE (business_key);


--
-- Name: indexer_job_leases indexer_job_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_job_leases
    ADD CONSTRAINT indexer_job_leases_pkey PRIMARY KEY (id);


--
-- Name: indexer_outbox indexer_outbox_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_outbox
    ADD CONSTRAINT indexer_outbox_business_key_key UNIQUE (business_key);


--
-- Name: indexer_outbox indexer_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_outbox
    ADD CONSTRAINT indexer_outbox_pkey PRIMARY KEY (id);


--
-- Name: indexer_range_leases indexer_range_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_range_leases
    ADD CONSTRAINT indexer_range_leases_pkey PRIMARY KEY (id);


--
-- Name: indexer_scan_intents indexer_scan_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_scan_intents
    ADD CONSTRAINT indexer_scan_intents_pkey PRIMARY KEY (id);


--
-- Name: indexer_scan_intents indexer_scan_intents_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_scan_intents
    ADD CONSTRAINT indexer_scan_intents_source_key_key UNIQUE (source_key);


--
-- Name: indexer_scheduler_leases indexer_scheduler_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_scheduler_leases
    ADD CONSTRAINT indexer_scheduler_leases_pkey PRIMARY KEY (lease_key);


--
-- Name: indexer_source_cursors indexer_source_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_source_cursors
    ADD CONSTRAINT indexer_source_cursors_pkey PRIMARY KEY (id);


--
-- Name: indexer_source_cursors indexer_source_cursors_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_source_cursors
    ADD CONSTRAINT indexer_source_cursors_source_key_key UNIQUE (source_key);


--
-- Name: job_interaction_events job_interaction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_interaction_events
    ADD CONSTRAINT job_interaction_events_pkey PRIMARY KEY (id);


--
-- Name: job_partner_sources job_partner_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_partner_sources
    ADD CONSTRAINT job_partner_sources_pkey PRIMARY KEY (id);


--
-- Name: llm_credit_deposits llm_credit_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_credit_deposits
    ADD CONSTRAINT llm_credit_deposits_pkey PRIMARY KEY (id);


--
-- Name: llm_provider_balance_snapshots llm_provider_balance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_provider_balance_snapshots
    ADD CONSTRAINT llm_provider_balance_snapshots_pkey PRIMARY KEY (id);


--
-- Name: llm_run_usage llm_run_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_run_usage
    ADD CONSTRAINT llm_run_usage_pkey PRIMARY KEY (id);


--
-- Name: llm_run_usage llm_run_usage_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_run_usage
    ADD CONSTRAINT llm_run_usage_run_id_key UNIQUE (run_id);


--
-- Name: llm_run_usage llm_run_usage_run_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_run_usage
    ADD CONSTRAINT llm_run_usage_run_scope_key UNIQUE (run_id, app_account_id, agent_db_id);


--
-- Name: mesh_signal_deliveries mesh_signal_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mesh_signal_deliveries
    ADD CONSTRAINT mesh_signal_deliveries_pkey PRIMARY KEY (id);


--
-- Name: metaplex_launch_attempts metaplex_launch_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metaplex_launch_attempts
    ADD CONSTRAINT metaplex_launch_attempts_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: order_post_activations order_post_activations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_post_activations
    ADD CONSTRAINT order_post_activations_pkey PRIMARY KEY (order_id);


--
-- Name: partner_jobs partner_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_jobs
    ADD CONSTRAINT partner_jobs_pkey PRIMARY KEY (id);


--
-- Name: raw_events raw_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_events
    ADD CONSTRAINT raw_events_pkey PRIMARY KEY (id);


--
-- Name: registration_document_observations registration_document_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_document_observations
    ADD CONSTRAINT registration_document_observations_pkey PRIMARY KEY (id);


--
-- Name: registration_document_observations registration_document_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_document_observations
    ADD CONSTRAINT registration_document_version UNIQUE (normalized_uri, raw_document_digest);


--
-- Name: robinhood_chain_launches robinhood_chain_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robinhood_chain_launches
    ADD CONSTRAINT robinhood_chain_launches_pkey PRIMARY KEY (id);


--
-- Name: robinhood_fee_claims robinhood_fee_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robinhood_fee_claims
    ADD CONSTRAINT robinhood_fee_claims_pkey PRIMARY KEY (id);


--
-- Name: robinhood_launch_preparations robinhood_launch_preparations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robinhood_launch_preparations
    ADD CONSTRAINT robinhood_launch_preparations_pkey PRIMARY KEY (id);


--
-- Name: sap_agent_operator_claims sap_agent_operator_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sap_agent_operator_claims
    ADD CONSTRAINT sap_agent_operator_claims_pkey PRIMARY KEY (id);


--
-- Name: sap_sync_logs sap_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sap_sync_logs
    ADD CONSTRAINT sap_sync_logs_pkey PRIMARY KEY (id);


--
-- Name: site_news_articles site_news_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_news_articles
    ADD CONSTRAINT site_news_articles_pkey PRIMARY KEY (id);


--
-- Name: solana_8004_trust_observations solana_8004_trust_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_8004_trust_observations
    ADD CONSTRAINT solana_8004_trust_observations_pkey PRIMARY KEY (id);


--
-- Name: solana_8004_trust_signatures solana_8004_trust_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_8004_trust_signatures
    ADD CONSTRAINT solana_8004_trust_signatures_pkey PRIMARY KEY (signature);


--
-- Name: solana_agent_observations solana_agent_observations_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_agent_observations
    ADD CONSTRAINT solana_agent_observations_business_key_key UNIQUE (business_key);


--
-- Name: solana_agent_observations solana_agent_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_agent_observations
    ADD CONSTRAINT solana_agent_observations_pkey PRIMARY KEY (id);


--
-- Name: solana_registry_memberships solana_registry_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_registry_memberships
    ADD CONSTRAINT solana_registry_memberships_pkey PRIMARY KEY (id);


--
-- Name: solana_registry_snapshots solana_registry_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_registry_snapshots
    ADD CONSTRAINT solana_registry_snapshots_pkey PRIMARY KEY (id);


--
-- Name: solana_transaction_observations solana_transaction_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_transaction_observations
    ADD CONSTRAINT solana_transaction_observations_pkey PRIMARY KEY (signature);


--
-- Name: webhook_receipts webhook_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_receipts
    ADD CONSTRAINT webhook_receipts_pkey PRIMARY KEY (id);


--
-- Name: worker_resource_leases worker_resource_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_resource_leases
    ADD CONSTRAINT worker_resource_leases_pkey PRIMARY KEY (resource_key, slot);


--
-- Name: worker_resource_rate_budgets worker_resource_rate_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_resource_rate_budgets
    ADD CONSTRAINT worker_resource_rate_budgets_pkey PRIMARY KEY (resource_key);


--
-- Name: worker_resource_states worker_resource_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_resource_states
    ADD CONSTRAINT worker_resource_states_pkey PRIMARY KEY (resource_key);


--
-- Name: AdOrderSquare_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdOrderSquare_txHash_key" ON public."AdOrderSquare" USING btree ("txHash");


--
-- Name: AdOrderStrip_active_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdOrderStrip_active_createdAt_id_idx" ON public."AdOrderStrip" USING btree ("createdAt", id) WHERE (status = 'active'::text);


--
-- Name: AdOrderStrip_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdOrderStrip_txHash_key" ON public."AdOrderStrip" USING btree ("txHash");


--
-- Name: AdOrder_orderNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdOrder_orderNumber_key" ON public."AdOrder" USING btree ("orderNumber") WHERE ("orderNumber" IS NOT NULL);


--
-- Name: AdOrder_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdOrder_txHash_key" ON public."AdOrder" USING btree ("txHash");


--
-- Name: AdPackage_orderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdPackage_orderId_key" ON public."AdPackage" USING btree ("orderId");


--
-- Name: AdPackage_status_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdPackage_status_expiresAt_idx" ON public."AdPackage" USING btree (status, "expiresAt");


--
-- Name: AdminLoginChallenge_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AdminLoginChallenge_expiresAt_idx" ON public."AdminLoginChallenge" USING btree ("expiresAt");


--
-- Name: AdminLoginChallenge_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AdminLoginChallenge_tokenHash_key" ON public."AdminLoginChallenge" USING btree ("tokenHash");


--
-- Name: AgentAlertRule_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentAlertRule_agentId_idx" ON public."AgentAlertRule" USING btree ("agentId");


--
-- Name: AgentAlertRule_userProfileId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentAlertRule_userProfileId_idx" ON public."AgentAlertRule" USING btree ("userProfileId");


--
-- Name: AgentAnalyticsEvent_agentId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentAnalyticsEvent_agentId_createdAt_idx" ON public."AgentAnalyticsEvent" USING btree ("agentId", "createdAt");


--
-- Name: AgentAnalyticsEvent_agentId_serviceId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentAnalyticsEvent_agentId_serviceId_createdAt_idx" ON public."AgentAnalyticsEvent" USING btree ("agentId", "serviceId", "createdAt");


--
-- Name: AgentBlocklistRule_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentBlocklistRule_active_idx" ON public."AgentBlocklistRule" USING btree (active);


--
-- Name: AgentBoost_agentId_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentBoost_agentId_expiresAt_idx" ON public."AgentBoost" USING btree ("agentId", "expiresAt");


--
-- Name: AgentBoost_orderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgentBoost_orderId_key" ON public."AgentBoost" USING btree ("orderId");


--
-- Name: AgentBoost_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgentBoost_txHash_key" ON public."AgentBoost" USING btree ("txHash");


--
-- Name: AgentChainVerification_chainId_agentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgentChainVerification_chainId_agentId_key" ON public."AgentChainVerification" USING btree ("chainId", "agentId");


--
-- Name: AgentChainVerification_source_registry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentChainVerification_source_registry_idx" ON public."AgentChainVerification" USING btree ("chainId", source_registry);


--
-- Name: AgentChainVerification_verified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentChainVerification_verified_idx" ON public."AgentChainVerification" USING btree (verified);


--
-- Name: AgentMcpOffer_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMcpOffer_agentId_idx" ON public."AgentMcpOffer" USING btree ("agentId");


--
-- Name: AgentMcpOffer_agentId_isPublished_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMcpOffer_agentId_isPublished_idx" ON public."AgentMcpOffer" USING btree ("agentId", "isPublished");


--
-- Name: AgentMetadata_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMetadata_agentId_idx" ON public."AgentMetadata" USING btree ("agentId");


--
-- Name: AgentMetadata_agent_id_chain_controlled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMetadata_agent_id_chain_controlled_idx" ON public."AgentMetadata" USING btree ("agentId", chain_controlled);


--
-- Name: AgentMetadata_capability_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMetadata_capability_agent_idx" ON public."AgentMetadata" USING btree (key, "agentId") WHERE (key = ANY (ARRAY['mcpTools'::text, 'a2aSkills'::text, 'oasfSkills'::text]));


--
-- Name: AgentMetadata_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentMetadata_key_idx" ON public."AgentMetadata" USING btree (key);


--
-- Name: AgentReport_agentDbId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentReport_agentDbId_idx" ON public."AgentReport" USING btree ("agentDbId");


--
-- Name: AgentReport_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentReport_createdAt_idx" ON public."AgentReport" USING btree ("createdAt");


--
-- Name: AgentReport_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentReport_status_idx" ON public."AgentReport" USING btree (status);


--
-- Name: AgentService_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentService_agentId_idx" ON public."AgentService" USING btree ("agentId");


--
-- Name: AgentService_agent_id_source_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentService_agent_id_source_kind_idx" ON public."AgentService" USING btree ("agentId", source_kind);


--
-- Name: AgentStar_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentStar_agentId_idx" ON public."AgentStar" USING btree ("agentId");


--
-- Name: AgentStar_agentId_walletAddress_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgentStar_agentId_walletAddress_key" ON public."AgentStar" USING btree ("agentId", "walletAddress");


--
-- Name: AgentVerificationRequest_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentVerificationRequest_agentId_idx" ON public."AgentVerificationRequest" USING btree ("agentId");


--
-- Name: AgentVerificationRequest_verificationStatus_submittedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentVerificationRequest_verificationStatus_submittedAt_idx" ON public."AgentVerificationRequest" USING btree ("verificationStatus", "submittedAt");


--
-- Name: AgentVerificationRequest_walletAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentVerificationRequest_walletAddress_idx" ON public."AgentVerificationRequest" USING btree ("walletAddress");


--
-- Name: AgentVote_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AgentVote_agentId_idx" ON public."AgentVote" USING btree ("agentId");


--
-- Name: AgentVote_agentId_ipHash_voteType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgentVote_agentId_ipHash_voteType_key" ON public."AgentVote" USING btree ("agentId", "ipHash", "voteType");


--
-- Name: Agent_agentId_chainId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_agentId_chainId_key" ON public."Agent" USING btree ("agentId", "chainId");


--
-- Name: Agent_agent_wallet_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_agent_wallet_id_key" ON public."Agent" USING btree (agent_wallet_id);


--
-- Name: Agent_archetype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_archetype_idx" ON public."Agent" USING btree (archetype);


--
-- Name: Agent_binanceCompatible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_binanceCompatible_idx" ON public."Agent" USING btree ("binanceCompatible") WHERE ("binanceCompatible" = true);


--
-- Name: Agent_chainId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_chainId_idx" ON public."Agent" USING btree ("chainId");


--
-- Name: Agent_chainId_protocol_agent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_chainId_protocol_agent_id_idx" ON public."Agent" USING btree ("chainId", protocol_agent_id);


--
-- Name: Agent_cluster_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_cluster_key_idx" ON public."Agent" USING btree (cluster_key);


--
-- Name: Agent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_createdAt_idx" ON public."Agent" USING btree ("createdAt");


--
-- Name: Agent_evm_privy_wallet_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_evm_privy_wallet_id_key" ON public."Agent" USING btree (evm_privy_wallet_id);


--
-- Name: Agent_evm_wallet_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_evm_wallet_address_key" ON public."Agent" USING btree (evm_wallet_address);


--
-- Name: Agent_evm_wallet_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_evm_wallet_status_idx" ON public."Agent" USING btree (evm_wallet_status);


--
-- Name: Agent_featured_work_ready_work_ready_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_featured_work_ready_work_ready_status_idx" ON public."Agent" USING btree (featured_work_ready, work_ready_status);


--
-- Name: Agent_hotScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_hotScore_idx" ON public."Agent" USING btree ("hotScore");


--
-- Name: Agent_isActive_activityScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_activityScore_idx" ON public."Agent" USING btree ("isActive", "activityScore");


--
-- Name: Agent_isActive_agentMode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_agentMode_idx" ON public."Agent" USING btree ("isActive", "agentMode");


--
-- Name: Agent_isActive_agentRankScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_agentRankScore_idx" ON public."Agent" USING btree ("isActive", "agentRankScore" DESC);


--
-- Name: Agent_isActive_archetype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_archetype_idx" ON public."Agent" USING btree ("isActive", archetype);


--
-- Name: Agent_isActive_discoveryScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_discoveryScore_idx" ON public."Agent" USING btree ("isActive", discovery_score DESC);


--
-- Name: Agent_isActive_executionScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_executionScore_idx" ON public."Agent" USING btree ("isActive", "executionScore");


--
-- Name: Agent_isActive_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_id_idx" ON public."Agent" USING btree ("isActive", id);


--
-- Name: Agent_isActive_isVerifiedRevenue_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_isVerifiedRevenue_score_idx" ON public."Agent" USING btree ("isActive", "isVerifiedRevenue", score);


--
-- Name: Agent_isActive_metaplexVerified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_metaplexVerified_idx" ON public."Agent" USING btree ("isActive", metaplex_verified);


--
-- Name: Agent_isActive_protocolTrustScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_protocolTrustScore_idx" ON public."Agent" USING btree ("isActive", "protocolTrustScore");


--
-- Name: Agent_isActive_sapVerified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_sapVerified_idx" ON public."Agent" USING btree ("isActive", sap_verified);


--
-- Name: Agent_isActive_verified_any_partial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_isActive_verified_any_partial_idx" ON public."Agent" USING btree (id) WHERE (("isActive" = true) AND (("isVerified" = true) OR ("isPremiumVerified" = true)));


--
-- Name: Agent_listedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_listedAt_idx" ON public."Agent" USING btree ("listedAt");


--
-- Name: Agent_metaplex_asset_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_metaplex_asset_address_key" ON public."Agent" USING btree (metaplex_asset_address);


--
-- Name: Agent_name_lower_trim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_name_lower_trim_idx" ON public."Agent" USING btree (lower(TRIM(BOTH FROM name)));


--
-- Name: Agent_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_owner_idx" ON public."Agent" USING btree (owner);


--
-- Name: Agent_powerScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_powerScore_idx" ON public."Agent" USING btree ("powerScore");


--
-- Name: Agent_public_activity_score_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_public_activity_score_id_idx" ON public."Agent" USING btree ("activityScore" DESC, score DESC, id) WHERE ("isActive" = true);


--
-- Name: Agent_public_chain_score_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_public_chain_score_id_idx" ON public."Agent" USING btree ("chainId", score DESC, id) WHERE ("isActive" = true);


--
-- Name: Agent_public_dao_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_public_dao_candidate_idx" ON public."Agent" USING btree ("lastActiveAt" DESC, id) INCLUDE ("activeBoosts", "adminPowerAdjust") WHERE (("isActive" = true) AND ("agentId" <> 88888) AND (("activeBoosts" > 0) OR ("adminPowerAdjust" <> 0)));


--
-- Name: Agent_public_hot_score_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_public_hot_score_id_idx" ON public."Agent" USING btree ("hotScore" DESC, score DESC, id) WHERE ("isActive" = true);


--
-- Name: Agent_public_listed_created_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_public_listed_created_id_idx" ON public."Agent" USING btree ("listedAt" DESC, "createdAt" DESC, id DESC) WHERE ("isActive" = true);


--
-- Name: Agent_public_referral_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_public_referral_code_key" ON public."Agent" USING btree (public_referral_code);


--
-- Name: Agent_registration_normalized_uri_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_registration_normalized_uri_idx" ON public."Agent" USING btree (registration_normalized_uri) WHERE (registration_normalized_uri IS NOT NULL);


--
-- Name: Agent_registration_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_registration_retry_idx" ON public."Agent" USING btree (registration_status, registration_next_retry_at);


--
-- Name: Agent_sap_agent_pda_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_sap_agent_pda_key" ON public."Agent" USING btree (sap_agent_pda);


--
-- Name: Agent_scanner_listed_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_scanner_listed_id_idx" ON public."Agent" USING btree ("listedAt" DESC, id DESC);


--
-- Name: Agent_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_score_idx" ON public."Agent" USING btree (score);


--
-- Name: Agent_score_materialization_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_score_materialization_pending_idx" ON public."Agent" USING btree (id) WHERE (score_state_version > score_materialized_version);


--
-- Name: Agent_score_state_version_score_materialized_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_score_state_version_score_materialized_version_idx" ON public."Agent" USING btree (score_state_version, score_materialized_version);


--
-- Name: Agent_solana_asset_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agent_solana_asset_address_key" ON public."Agent" USING btree (solana_asset_address) WHERE (solana_asset_address IS NOT NULL);


--
-- Name: Agent_solana_canonical_status_solana_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_solana_canonical_status_solana_slot_idx" ON public."Agent" USING btree (solana_canonical_status, solana_slot);


--
-- Name: Agent_source_block_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_source_block_number_idx" ON public."Agent" USING btree (source_block_number);


--
-- Name: Agent_source_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_source_lifecycle_idx" ON public."Agent" USING btree ("chainId", source_active, publicly_active);


--
-- Name: Agent_source_registry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_source_registry_idx" ON public."Agent" USING btree ("chainId", source_registry_address);


--
-- Name: Agent_verifiedWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_verifiedWallet_idx" ON public."Agent" USING btree ("verifiedWallet");


--
-- Name: Agent_wallet_hydration_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agent_wallet_hydration_status_idx" ON public."Agent" USING btree (wallet_hydration_status);


--
-- Name: ArHolderAgentPerk_active_power_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArHolderAgentPerk_active_power_agent_idx" ON public."ArHolderAgentPerk" USING btree ("agentId") INCLUDE ("boostUnits", "expiresAt") WHERE (("perkType" = 'power_boost'::text) AND (status = 'active'::text));


--
-- Name: ArHolderAgentPerk_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArHolderAgentPerk_agentId_idx" ON public."ArHolderAgentPerk" USING btree ("agentId");


--
-- Name: ArHolderAgentPerk_perkType_status_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArHolderAgentPerk_perkType_status_expiresAt_idx" ON public."ArHolderAgentPerk" USING btree ("perkType", status, "expiresAt");


--
-- Name: ArHolderAgentPerk_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArHolderAgentPerk_wallet_idx" ON public."ArHolderAgentPerk" USING btree (wallet);


--
-- Name: ArHolderAgentPerk_wallet_perkType_periodKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArHolderAgentPerk_wallet_perkType_periodKey_key" ON public."ArHolderAgentPerk" USING btree (wallet, "perkType", "periodKey");


--
-- Name: ArPayoutBatch_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArPayoutBatch_createdAt_idx" ON public."ArPayoutBatch" USING btree ("createdAt");


--
-- Name: ArPayoutBatch_perkSlug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArPayoutBatch_perkSlug_idx" ON public."ArPayoutBatch" USING btree ("perkSlug");


--
-- Name: ArPayoutBatch_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArPayoutBatch_status_idx" ON public."ArPayoutBatch" USING btree (status);


--
-- Name: ArPayoutWallet_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArPayoutWallet_isActive_idx" ON public."ArPayoutWallet" USING btree ("isActive");


--
-- Name: ArPayoutWallet_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArPayoutWallet_purpose_idx" ON public."ArPayoutWallet" USING btree (purpose);


--
-- Name: ArReferralAdjustment_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralAdjustment_createdAt_idx" ON public."ArReferralAdjustment" USING btree ("createdAt");


--
-- Name: ArReferralAdjustment_referralCodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralAdjustment_referralCodeId_idx" ON public."ArReferralAdjustment" USING btree ("referralCodeId");


--
-- Name: ArReferralCode_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArReferralCode_code_key" ON public."ArReferralCode" USING btree (code);


--
-- Name: ArReferralCode_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCode_isActive_idx" ON public."ArReferralCode" USING btree ("isActive");


--
-- Name: ArReferralCode_ownerWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCode_ownerWallet_idx" ON public."ArReferralCode" USING btree ("ownerWallet");


--
-- Name: ArReferralCode_userProfileId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCode_userProfileId_idx" ON public."ArReferralCode" USING btree ("userProfileId");


--
-- Name: ArReferralCommission_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCommission_createdAt_idx" ON public."ArReferralCommission" USING btree ("createdAt");


--
-- Name: ArReferralCommission_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArReferralCommission_idempotency_key_key" ON public."ArReferralCommission" USING btree (idempotency_key);


--
-- Name: ArReferralCommission_orderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCommission_orderId_idx" ON public."ArReferralCommission" USING btree ("orderId");


--
-- Name: ArReferralCommission_referralCodeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCommission_referralCodeId_idx" ON public."ArReferralCommission" USING btree ("referralCodeId");


--
-- Name: ArReferralCommission_referrerWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCommission_referrerWallet_idx" ON public."ArReferralCommission" USING btree ("referrerWallet");


--
-- Name: ArReferralCommission_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralCommission_status_idx" ON public."ArReferralCommission" USING btree (status);


--
-- Name: ArReferralEvent_conversionStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralEvent_conversionStatus_idx" ON public."ArReferralEvent" USING btree ("conversionStatus");


--
-- Name: ArReferralEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralEvent_createdAt_idx" ON public."ArReferralEvent" USING btree ("createdAt");


--
-- Name: ArReferralEvent_referralCodeId_referredWallet_eventType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArReferralEvent_referralCodeId_referredWallet_eventType_key" ON public."ArReferralEvent" USING btree ("referralCodeId", "referredWallet", "eventType");


--
-- Name: ArReferralEvent_referredWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralEvent_referredWallet_idx" ON public."ArReferralEvent" USING btree ("referredWallet");


--
-- Name: ArReferralEvent_referrerWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArReferralEvent_referrerWallet_idx" ON public."ArReferralEvent" USING btree ("referrerWallet");


--
-- Name: ArStakePerkOverride_perkSlug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePerkOverride_perkSlug_idx" ON public."ArStakePerkOverride" USING btree ("perkSlug");


--
-- Name: ArStakePerkOverride_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePerkOverride_wallet_idx" ON public."ArStakePerkOverride" USING btree (wallet);


--
-- Name: ArStakePerkOverride_wallet_perkSlug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArStakePerkOverride_wallet_perkSlug_key" ON public."ArStakePerkOverride" USING btree (wallet, "perkSlug");


--
-- Name: ArStakePerkRule_isActive_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePerkRule_isActive_priority_idx" ON public."ArStakePerkRule" USING btree ("isActive", priority);


--
-- Name: ArStakePerkRule_perkSlug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePerkRule_perkSlug_idx" ON public."ArStakePerkRule" USING btree ("perkSlug");


--
-- Name: ArStakePosition_lockEndAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePosition_lockEndAt_idx" ON public."ArStakePosition" USING btree ("lockEndAt");


--
-- Name: ArStakePosition_poolAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePosition_poolAddress_idx" ON public."ArStakePosition" USING btree ("poolAddress");


--
-- Name: ArStakePosition_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePosition_status_idx" ON public."ArStakePosition" USING btree (status);


--
-- Name: ArStakePosition_txSignature_nonempty_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArStakePosition_txSignature_nonempty_key" ON public."ArStakePosition" USING btree ("txSignature") WHERE ("txSignature" <> ''::text);


--
-- Name: ArStakePosition_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArStakePosition_wallet_idx" ON public."ArStakePosition" USING btree (wallet);


--
-- Name: ArStakePosition_wallet_nonce_poolAddress_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArStakePosition_wallet_nonce_poolAddress_key" ON public."ArStakePosition" USING btree (wallet, nonce, "poolAddress");


--
-- Name: ArTokenHolderSnapshot_lastSyncedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenHolderSnapshot_lastSyncedAt_idx" ON public."ArTokenHolderSnapshot" USING btree ("lastSyncedAt");


--
-- Name: ArTokenHolderSnapshot_referralCount_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenHolderSnapshot_referralCount_idx" ON public."ArTokenHolderSnapshot" USING btree ("referralCount");


--
-- Name: ArTokenHolderSnapshot_tokenBalanceRaw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenHolderSnapshot_tokenBalanceRaw_idx" ON public."ArTokenHolderSnapshot" USING btree ("tokenBalanceRaw");


--
-- Name: ArTokenHolderSnapshot_wallet_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArTokenHolderSnapshot_wallet_key" ON public."ArTokenHolderSnapshot" USING btree (wallet);


--
-- Name: ArTokenMetricEvent_eventType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenMetricEvent_eventType_idx" ON public."ArTokenMetricEvent" USING btree ("eventType");


--
-- Name: ArTokenMetricEvent_occurredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenMetricEvent_occurredAt_idx" ON public."ArTokenMetricEvent" USING btree ("occurredAt");


--
-- Name: ArTokenPerkConfig_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ArTokenPerkConfig_slug_key" ON public."ArTokenPerkConfig" USING btree (slug);


--
-- Name: ArTokenPerkConfig_status_displayOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ArTokenPerkConfig_status_displayOrder_idx" ON public."ArTokenPerkConfig" USING btree (status, "displayOrder");


--
-- Name: BountyDispute_bountyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BountyDispute_bountyId_idx" ON public."BountyDispute" USING btree ("bountyId");


--
-- Name: Bounty_claimedByAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Bounty_claimedByAgentId_idx" ON public."Bounty" USING btree ("claimedByAgentId");


--
-- Name: Bounty_status_autoReleaseAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Bounty_status_autoReleaseAt_idx" ON public."Bounty" USING btree (status, "autoReleaseAt");


--
-- Name: Bounty_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Bounty_status_createdAt_idx" ON public."Bounty" USING btree (status, "createdAt");


--
-- Name: Bounty_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Bounty_status_idx" ON public."Bounty" USING btree (status);


--
-- Name: Chain_chainId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Chain_chainId_key" ON public."Chain" USING btree ("chainId");


--
-- Name: ContactInquiryReply_inquiryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ContactInquiryReply_inquiryId_idx" ON public."ContactInquiryReply" USING btree ("inquiryId");


--
-- Name: ContactInquiry_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ContactInquiry_status_idx" ON public."ContactInquiry" USING btree (status);


--
-- Name: ContactInquiry_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ContactInquiry_userId_idx" ON public."ContactInquiry" USING btree ("userId");


--
-- Name: ConversionEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ConversionEvent_createdAt_idx" ON public."ConversionEvent" USING btree ("createdAt");


--
-- Name: ConversionEvent_eventType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ConversionEvent_eventType_createdAt_idx" ON public."ConversionEvent" USING btree ("eventType", "createdAt");


--
-- Name: ConversionEvent_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ConversionEvent_idempotency_key_key" ON public."ConversionEvent" USING btree (idempotency_key);


--
-- Name: DaoLeaderboardLive_daoVotes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DaoLeaderboardLive_daoVotes_idx" ON public."DaoLeaderboardLive" USING btree ("daoVotes" DESC);


--
-- Name: DaoLeaderboardLive_rank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DaoLeaderboardLive_rank_idx" ON public."DaoLeaderboardLive" USING btree (rank);


--
-- Name: Feedback_agentId_clientAddress_feedbackIndex_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Feedback_agentId_clientAddress_feedbackIndex_idx" ON public."Feedback" USING btree ("agentId", "clientAddress", "feedbackIndex");


--
-- Name: Feedback_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Feedback_agentId_idx" ON public."Feedback" USING btree ("agentId");


--
-- Name: Feedback_clientAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Feedback_clientAddress_idx" ON public."Feedback" USING btree ("clientAddress");


--
-- Name: Feedback_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Feedback_createdAt_idx" ON public."Feedback" USING btree ("createdAt");


--
-- Name: MeshSignal_publisherAgentId_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MeshSignal_publisherAgentId_timestamp_idx" ON public."MeshSignal" USING btree ("publisherAgentId", "timestamp");


--
-- Name: MeshSubscription_publisherAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MeshSubscription_publisherAgentId_idx" ON public."MeshSubscription" USING btree ("publisherAgentId");


--
-- Name: MeshSubscription_subscriberAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MeshSubscription_subscriberAgentId_idx" ON public."MeshSubscription" USING btree ("subscriberAgentId");


--
-- Name: MeshSubscription_subscriberAgentId_publisherAgentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MeshSubscription_subscriberAgentId_publisherAgentId_key" ON public."MeshSubscription" USING btree ("subscriberAgentId", "publisherAgentId");


--
-- Name: Order_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Order_agentId_idx" ON public."Order" USING btree ("agentId");


--
-- Name: Order_orderNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Order_orderNumber_key" ON public."Order" USING btree ("orderNumber");


--
-- Name: Order_referralCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Order_referralCode_idx" ON public."Order" USING btree ("referralCode");


--
-- Name: Order_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Order_txHash_key" ON public."Order" USING btree ("txHash");


--
-- Name: ProfileFollow_followerAddress_followingAddress_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProfileFollow_followerAddress_followingAddress_key" ON public."ProfileFollow" USING btree ("followerAddress", "followingAddress");


--
-- Name: ProfileFollow_followerAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProfileFollow_followerAddress_idx" ON public."ProfileFollow" USING btree ("followerAddress");


--
-- Name: ProfileFollow_followingAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProfileFollow_followingAddress_idx" ON public."ProfileFollow" USING btree ("followingAddress");


--
-- Name: PromotionPrice_slotType_currency_durationDays_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PromotionPrice_slotType_currency_durationDays_key" ON public."PromotionPrice" USING btree ("slotType", currency, "durationDays");


--
-- Name: Promotion_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Promotion_agentId_idx" ON public."Promotion" USING btree ("agentId");


--
-- Name: Promotion_orderNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Promotion_orderNumber_key" ON public."Promotion" USING btree ("orderNumber") WHERE ("orderNumber" IS NOT NULL);


--
-- Name: Promotion_slotType_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Promotion_slotType_expiresAt_idx" ON public."Promotion" USING btree ("slotType", "expiresAt");


--
-- Name: Promotion_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Promotion_txHash_key" ON public."Promotion" USING btree ("txHash");


--
-- Name: Promotion_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Promotion_wallet_idx" ON public."Promotion" USING btree (wallet);


--
-- Name: SyncState_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SyncState_key_key" ON public."SyncState" USING btree (key);


--
-- Name: SyncState_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncState_outcome_idx" ON public."SyncState" USING btree (last_outcome_status, last_attempt_at);


--
-- Name: TrustEvent_agentId_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TrustEvent_agentId_timestamp_idx" ON public."TrustEvent" USING btree ("agentId", "timestamp");


--
-- Name: TrustEvent_event_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TrustEvent_event_key_key" ON public."TrustEvent" USING btree (event_key);


--
-- Name: UserProfile_claimToken_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserProfile_claimToken_idx" ON public."UserProfile" USING btree ("claimToken");


--
-- Name: UserProfile_claimToken_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserProfile_claimToken_key" ON public."UserProfile" USING btree ("claimToken");


--
-- Name: UserProfile_solana_wallet_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserProfile_solana_wallet_key" ON public."UserProfile" USING btree (solana_wallet) WHERE (solana_wallet IS NOT NULL);


--
-- Name: UserProfile_subscriptionStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserProfile_subscriptionStatus_idx" ON public."UserProfile" USING btree ("subscriptionStatus");


--
-- Name: UserProfile_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserProfile_username_key" ON public."UserProfile" USING btree (username);


--
-- Name: UserProfile_walletAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserProfile_walletAddress_idx" ON public."UserProfile" USING btree ("walletAddress");


--
-- Name: UserProfile_walletAddress_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserProfile_walletAddress_key" ON public."UserProfile" USING btree ("walletAddress");


--
-- Name: WalletLinkChallenge_nonce_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WalletLinkChallenge_nonce_key" ON public."WalletLinkChallenge" USING btree (nonce);


--
-- Name: account_credit_ledger_app_account_id_credit_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_credit_ledger_app_account_id_credit_type_idx ON public.account_credit_ledger USING btree (app_account_id, credit_type);


--
-- Name: account_credit_ledger_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_credit_ledger_created_at_idx ON public.account_credit_ledger USING btree (created_at);


--
-- Name: account_credit_ledger_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_credit_ledger_idempotency_key_key ON public.account_credit_ledger USING btree (idempotency_key);


--
-- Name: agent_alert_deliveries_event_id_rule_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_alert_deliveries_event_id_rule_id_key ON public.agent_alert_deliveries USING btree (event_id, rule_id);


--
-- Name: agent_alert_deliveries_rule_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_alert_deliveries_rule_id_created_at_idx ON public.agent_alert_deliveries USING btree (rule_id, created_at);


--
-- Name: agent_alert_deliveries_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_alert_deliveries_status_created_at_idx ON public.agent_alert_deliveries USING btree (status, created_at);


--
-- Name: agent_alert_events_agent_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_alert_events_agent_id_occurred_at_idx ON public.agent_alert_events USING btree (agent_id, occurred_at);


--
-- Name: agent_alert_events_event_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_alert_events_event_key_key ON public.agent_alert_events USING btree (event_key);


--
-- Name: agent_alert_events_event_type_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_alert_events_event_type_occurred_at_idx ON public.agent_alert_events USING btree (event_type, occurred_at);


--
-- Name: agent_analytics_daily_agentId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "agent_analytics_daily_agentId_date_key" ON public.agent_analytics_daily USING btree ("agentId", date);


--
-- Name: agent_analytics_daily_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_analytics_daily_agentId_idx" ON public.agent_analytics_daily USING btree ("agentId");


--
-- Name: agent_chat_conversations_account_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_conversations_account_updated_idx ON public.agent_chat_conversations USING btree (app_account_id, updated_at DESC);


--
-- Name: agent_chat_conversations_agent_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_conversations_agent_last_message_idx ON public.agent_chat_conversations USING btree (agent_db_id, last_message_at DESC);


--
-- Name: agent_chat_conversations_visible_feed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_conversations_visible_feed_idx ON public.agent_chat_conversations USING btree (app_account_id, agent_db_id, last_message_at DESC, id DESC) WHERE (status <> 'DELETED'::public."AgentChatConversationStatus");


--
-- Name: agent_chat_messages_conversation_sequence_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_messages_conversation_sequence_desc_idx ON public.agent_chat_messages USING btree (conversation_id, sequence DESC);


--
-- Name: agent_chat_run_attempts_provider_model_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_run_attempts_provider_model_started_idx ON public.agent_chat_run_attempts USING btree (provider, provider_model_id, started_at DESC);


--
-- Name: agent_chat_run_attempts_provider_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_run_attempts_provider_request_idx ON public.agent_chat_run_attempts USING btree (provider_request_id);


--
-- Name: agent_chat_run_runtime_lease_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_run_runtime_lease_expires_idx ON public.agent_chat_run_runtime USING btree (lease_expires_at);


--
-- Name: agent_chat_runs_account_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_runs_account_started_idx ON public.agent_chat_runs USING btree (app_account_id, started_at DESC);


--
-- Name: agent_chat_runs_agent_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_runs_agent_started_idx ON public.agent_chat_runs USING btree (agent_db_id, started_at DESC);


--
-- Name: agent_chat_runs_conversation_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_runs_conversation_started_idx ON public.agent_chat_runs USING btree (conversation_id, started_at DESC);


--
-- Name: agent_chat_runs_one_active_per_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_chat_runs_one_active_per_conversation ON public.agent_chat_runs USING btree (conversation_id) WHERE (status = ANY (ARRAY['PREPARING'::public."AgentChatRunLifecycle", 'RESERVED'::public."AgentChatRunLifecycle", 'STREAMING'::public."AgentChatRunLifecycle"]));


--
-- Name: agent_chat_runs_status_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_runs_status_started_idx ON public.agent_chat_runs USING btree (status, started_at);


--
-- Name: agent_chat_settings_revisions_creator_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_settings_revisions_creator_created_idx ON public.agent_chat_settings_revisions USING btree (created_by_user_profile_id, created_at DESC);


--
-- Name: agent_chat_settings_revisions_settings_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_settings_revisions_settings_created_idx ON public.agent_chat_settings_revisions USING btree (settings_id, created_at DESC);


--
-- Name: agent_chat_tool_events_message_step_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_tool_events_message_step_idx ON public.agent_chat_tool_events USING btree (assistant_message_id, step_index);


--
-- Name: agent_chat_tool_events_run_step_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_chat_tool_events_run_step_idx ON public.agent_chat_tool_events USING btree (run_id, step_index);


--
-- Name: agent_github_connections_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_github_connections_agentId_idx" ON public.agent_github_connections USING btree ("agentId");


--
-- Name: agent_github_push_notes_agentId_commit_sha_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "agent_github_push_notes_agentId_commit_sha_key" ON public.agent_github_push_notes USING btree ("agentId", commit_sha);


--
-- Name: agent_github_push_notes_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_github_push_notes_agentId_idx" ON public.agent_github_push_notes USING btree ("agentId");


--
-- Name: agent_github_snapshots_agentId_captured_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_github_snapshots_agentId_captured_at_idx" ON public.agent_github_snapshots USING btree ("agentId", captured_at);


--
-- Name: agent_launch_events_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_events_launch_id_idx ON public.agent_launch_events USING btree (launch_id);


--
-- Name: agent_launch_events_tx_signature_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_events_tx_signature_idx ON public.agent_launch_events USING btree (tx_signature);


--
-- Name: agent_launch_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_events_type_idx ON public.agent_launch_events USING btree (type);


--
-- Name: agent_launch_fee_distribution_attempts_tx_signature_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_launch_fee_distribution_attempts_tx_signature_key ON public.agent_launch_fee_distribution_attempts USING btree (tx_signature);


--
-- Name: agent_launch_fee_distributions_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_fee_distributions_launch_id_idx ON public.agent_launch_fee_distributions USING btree (launch_id);


--
-- Name: agent_launch_fee_distributions_mint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_fee_distributions_mint_idx ON public.agent_launch_fee_distributions USING btree (mint);


--
-- Name: agent_launch_fee_distributions_network_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launch_fee_distributions_network_idx ON public.agent_launch_fee_distributions USING btree (network);


--
-- Name: agent_launch_fee_distributions_tx_signature_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_launch_fee_distributions_tx_signature_key ON public.agent_launch_fee_distributions USING btree (tx_signature);


--
-- Name: agent_launches_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_launches_agentId_idx" ON public.agent_launches USING btree ("agentId");


--
-- Name: agent_launches_agent_db_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launches_agent_db_id_idx ON public.agent_launches USING btree (agent_db_id);


--
-- Name: agent_launches_creatorWallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_launches_creatorWallet_idx" ON public.agent_launches USING btree ("creatorWallet");


--
-- Name: agent_launches_feeSharingStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_launches_feeSharingStatus_idx" ON public.agent_launches USING btree ("feeSharingStatus");


--
-- Name: agent_launches_launchStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_launches_launchStatus_idx" ON public.agent_launches USING btree ("launchStatus");


--
-- Name: agent_launches_launch_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launches_launch_kind_idx ON public.agent_launches USING btree (launch_kind);


--
-- Name: agent_launches_launch_lifecycle_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launches_launch_lifecycle_status_idx ON public.agent_launches USING btree (launch_lifecycle_status);


--
-- Name: agent_launches_mint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_launches_mint_key ON public.agent_launches USING btree (mint);


--
-- Name: agent_launches_network_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_launches_network_idx ON public.agent_launches USING btree (network);


--
-- Name: agent_official_links_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_official_links_agentId_idx" ON public.agent_official_links USING btree ("agentId");


--
-- Name: agent_official_links_agentId_link_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "agent_official_links_agentId_link_type_key" ON public.agent_official_links USING btree ("agentId", link_type);


--
-- Name: agent_paid_services_agentId_is_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_paid_services_agentId_is_published_idx" ON public.agent_paid_services USING btree ("agentId", is_published);


--
-- Name: agent_verification_signals_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_verification_signals_agentId_idx" ON public.agent_verification_signals USING btree ("agentId");


--
-- Name: agent_verification_signals_agentId_signal_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "agent_verification_signals_agentId_signal_type_key" ON public.agent_verification_signals USING btree ("agentId", signal_type);


--
-- Name: agent_verification_signals_signal_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_verification_signals_signal_type_status_idx ON public.agent_verification_signals USING btree (signal_type, status);


--
-- Name: app_accounts_account_wallet_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_accounts_account_wallet_id_key ON public.app_accounts USING btree (account_wallet_id);


--
-- Name: app_accounts_user_profile_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_accounts_user_profile_id_key ON public.app_accounts USING btree (user_profile_id);


--
-- Name: cache_invalidation_outbox_delivered_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cache_invalidation_outbox_delivered_at_id_idx ON public.cache_invalidation_outbox USING btree (delivered_at, id);


--
-- Name: cache_invalidation_outbox_pending_domain_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cache_invalidation_outbox_pending_domain_key ON public.cache_invalidation_outbox USING btree (domain) WHERE (delivered_at IS NULL);


--
-- Name: console_auth_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX console_auth_tokens_token_hash_key ON public.dashboard_auth_tokens USING btree (token_hash);


--
-- Name: custodial_wallet_audit_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallet_audit_created_at_idx ON public.custodial_wallet_audit USING btree (created_at);


--
-- Name: custodial_wallet_audit_wallet_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallet_audit_wallet_id_idx ON public.custodial_wallet_audit USING btree (wallet_id);


--
-- Name: custodial_wallet_transfers_agent_db_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallet_transfers_agent_db_id_idx ON public.custodial_wallet_transfers USING btree (agent_db_id);


--
-- Name: custodial_wallet_transfers_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallet_transfers_created_at_idx ON public.custodial_wallet_transfers USING btree (created_at);


--
-- Name: custodial_wallet_transfers_wallet_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallet_transfers_wallet_id_idx ON public.custodial_wallet_transfers USING btree (wallet_id);


--
-- Name: custodial_wallets_chain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallets_chain_idx ON public.custodial_wallets USING btree (chain);


--
-- Name: custodial_wallets_public_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX custodial_wallets_public_key_key ON public.custodial_wallets USING btree (public_key);


--
-- Name: custodial_wallets_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custodial_wallets_scope_idx ON public.custodial_wallets USING btree (scope);


--
-- Name: dashboard_auth_tokens_email_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_auth_tokens_email_type_idx ON public.dashboard_auth_tokens USING btree (email, type);


--
-- Name: evm_contract_generations_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_contract_generations_lookup_idx ON public.evm_contract_generations USING btree (chain_id, proxy_address, effective_from_block);


--
-- Name: evm_event_observations_block_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_event_observations_block_status_idx ON public.evm_event_observations USING btree (block_hash, status);


--
-- Name: evm_event_observations_business_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_event_observations_business_status_idx ON public.evm_event_observations USING btree (business_key, status);


--
-- Name: evm_event_observations_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_event_observations_order_idx ON public.evm_event_observations USING btree (chain_id, contract_address, block_number, transaction_index, log_index);


--
-- Name: evm_feedback_block_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_feedback_block_status_idx ON public.evm_feedback_observations USING btree (block_hash, status);


--
-- Name: evm_feedback_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_feedback_identity_idx ON public.evm_feedback_observations USING btree (chain_id, registry_address, protocol_agent_id, client_address, feedback_index);


--
-- Name: evm_identity_metadata_block_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_identity_metadata_block_status_idx ON public.evm_identity_metadata_observations USING btree (block_hash, status);


--
-- Name: evm_identity_metadata_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_identity_metadata_current_idx ON public.evm_identity_metadata_observations USING btree (chain_id, registry_address, protocol_agent_id, metadata_key, is_current);


--
-- Name: evm_identity_observations_identity_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_identity_observations_identity_order_idx ON public.evm_identity_observations USING btree (chain_id, registry_address, protocol_agent_id, block_number);


--
-- Name: evm_identity_observations_status_block_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_identity_observations_status_block_idx ON public.evm_identity_observations USING btree (status, block_number);


--
-- Name: evm_validation_agent_response_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_validation_agent_response_idx ON public.evm_validation_observations USING btree (protocol_agent_id, has_response, status);


--
-- Name: evm_validation_request_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evm_validation_request_order_idx ON public.evm_validation_observations USING btree (chain_id, registry_address, request_hash, block_number);


--
-- Name: evm_validation_request_registry_hash_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX evm_validation_request_registry_hash_unique ON public.evm_validation_observations USING btree (chain_id, registry_address, request_hash) WHERE ((event_type = 'ValidationRequest'::text) AND (status <> 'orphaned'::text));


--
-- Name: fairscale_agent_assessments_agent_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fairscale_agent_assessments_agent_id_key ON public.fairscale_agent_assessments USING btree (agent_id);


--
-- Name: fairscale_agent_assessments_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fairscale_agent_assessments_expires_at_idx ON public.fairscale_agent_assessments USING btree (expires_at);


--
-- Name: fairscale_agent_assessments_last_attempt_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fairscale_agent_assessments_last_attempt_at_idx ON public.fairscale_agent_assessments USING btree (last_attempt_at);


--
-- Name: fairscale_agent_assessments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fairscale_agent_assessments_status_idx ON public.fairscale_agent_assessments USING btree (status);


--
-- Name: fairscale_agent_assessments_wallet_address_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fairscale_agent_assessments_wallet_address_idx ON public.fairscale_agent_assessments USING btree (wallet_address);


--
-- Name: indexer_bootstrap_epochs_first_agent_materialized_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_epochs_first_agent_materialized_at_idx ON public.indexer_bootstrap_epochs USING btree (first_agent_materialized_at) WHERE (first_agent_materialized_at IS NOT NULL);


--
-- Name: indexer_bootstrap_epochs_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_epochs_published_at_idx ON public.indexer_bootstrap_epochs USING btree (published_at) WHERE (published_at IS NOT NULL);


--
-- Name: indexer_bootstrap_epochs_single_running_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX indexer_bootstrap_epochs_single_running_idx ON public.indexer_bootstrap_epochs USING btree ((1)) WHERE (status = 'RUNNING'::public."IndexerBootstrapStatus");


--
-- Name: indexer_bootstrap_epochs_status_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_epochs_status_phase_idx ON public.indexer_bootstrap_epochs USING btree (status, phase);


--
-- Name: indexer_bootstrap_epochs_topology_hash_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_epochs_topology_hash_status_idx ON public.indexer_bootstrap_epochs USING btree (topology_hash, status);


--
-- Name: indexer_bootstrap_sources_epoch_id_phase_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_sources_epoch_id_phase_status_idx ON public.indexer_bootstrap_sources USING btree (epoch_id, phase, status);


--
-- Name: indexer_bootstrap_sources_epoch_id_source_key_phase_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX indexer_bootstrap_sources_epoch_id_source_key_phase_key ON public.indexer_bootstrap_sources USING btree (epoch_id, source_key, phase);


--
-- Name: indexer_bootstrap_work_items_agent_db_id_phase_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_work_items_agent_db_id_phase_status_idx ON public.indexer_bootstrap_work_items USING btree (agent_db_id, phase, status);


--
-- Name: indexer_bootstrap_work_items_epoch_id_phase_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_bootstrap_work_items_epoch_id_phase_status_idx ON public.indexer_bootstrap_work_items USING btree (epoch_id, phase, status);


--
-- Name: indexer_dead_letter_queue_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_dead_letter_queue_status_idx ON public.indexer_dead_letter_records USING btree (original_queue, status, created_at);


--
-- Name: indexer_endpoint_states_protocol_credential_key_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_endpoint_states_protocol_credential_key_hash_idx ON public.indexer_endpoint_states USING btree (protocol, credential_key_hash);


--
-- Name: indexer_endpoint_states_protocol_network_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_endpoint_states_protocol_network_idx ON public.indexer_endpoint_states USING btree (protocol, observed_network);


--
-- Name: indexer_idempotency_stage_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_idempotency_stage_completed_idx ON public.indexer_idempotency_records USING btree (stage, completed_at);


--
-- Name: indexer_job_leases_queue_state_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_job_leases_queue_state_deadline_idx ON public.indexer_job_leases USING btree (queue_name, state, deadline_at);


--
-- Name: indexer_job_leases_state_progress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_job_leases_state_progress_idx ON public.indexer_job_leases USING btree (state, last_meaningful_progress_at);


--
-- Name: indexer_outbox_queue_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_outbox_queue_dispatch_idx ON public.indexer_outbox USING btree (queue_name, dispatched_at, available_at);


--
-- Name: indexer_outbox_source_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_outbox_source_dispatch_idx ON public.indexer_outbox USING btree (source_key, dispatched_at);


--
-- Name: indexer_range_leases_chain_id_domain_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_range_leases_chain_id_domain_status_idx ON public.indexer_range_leases USING btree (chain_id, domain, status);


--
-- Name: indexer_range_leases_lease_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_range_leases_lease_until_idx ON public.indexer_range_leases USING btree (lease_until);


--
-- Name: indexer_range_leases_source_key_from_block_to_block_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX indexer_range_leases_source_key_from_block_to_block_key ON public.indexer_range_leases USING btree (source_key, from_block, to_block);


--
-- Name: indexer_range_leases_source_key_requested_generation_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_range_leases_source_key_requested_generation_status_idx ON public.indexer_range_leases USING btree (source_key, requested_generation, status);


--
-- Name: indexer_range_leases_source_key_status_from_block_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_range_leases_source_key_status_from_block_idx ON public.indexer_range_leases USING btree (source_key, status, from_block);


--
-- Name: indexer_scan_intents_chain_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_scan_intents_chain_domain_idx ON public.indexer_scan_intents USING btree (chain_id, domain);


--
-- Name: indexer_scheduler_leases_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_scheduler_leases_expires_at_idx ON public.indexer_scheduler_leases USING btree (expires_at);


--
-- Name: indexer_source_cursors_chain_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX indexer_source_cursors_chain_domain_idx ON public.indexer_source_cursors USING btree (chain_id, domain);


--
-- Name: job_interaction_events_agent_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_interaction_events_agent_id_created_at_idx ON public.job_interaction_events USING btree (agent_id, created_at);


--
-- Name: job_interaction_events_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_interaction_events_event_type_created_at_idx ON public.job_interaction_events USING btree (event_type, created_at);


--
-- Name: job_interaction_events_job_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_interaction_events_job_id_created_at_idx ON public.job_interaction_events USING btree (job_id, created_at);


--
-- Name: job_partner_sources_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_partner_sources_source_key ON public.job_partner_sources USING btree (source);


--
-- Name: launch_fee_attempt_launch_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_fee_attempt_launch_status_created_idx ON public.agent_launch_fee_distribution_attempts USING btree (launch_id, status, created_at);


--
-- Name: launch_fee_attempt_network_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_fee_attempt_network_status_idx ON public.agent_launch_fee_distribution_attempts USING btree (network, status);


--
-- Name: launch_fee_attempt_one_active_per_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_fee_attempt_one_active_per_launch_idx ON public.agent_launch_fee_distribution_attempts USING btree (launch_id) WHERE (status = ANY (ARRAY['prepared'::text, 'submitted'::text]));


--
-- Name: llm_credit_deposits_app_account_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_credit_deposits_app_account_id_created_at_idx ON public.llm_credit_deposits USING btree (app_account_id, created_at DESC);


--
-- Name: llm_credit_deposits_credit_ledger_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX llm_credit_deposits_credit_ledger_id_key ON public.llm_credit_deposits USING btree (credit_ledger_id);


--
-- Name: llm_credit_deposits_network_asset_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_credit_deposits_network_asset_status_idx ON public.llm_credit_deposits USING btree (network, asset, status);


--
-- Name: llm_credit_deposits_reference_public_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX llm_credit_deposits_reference_public_key_key ON public.llm_credit_deposits USING btree (reference_public_key);


--
-- Name: llm_credit_deposits_signature_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX llm_credit_deposits_signature_key ON public.llm_credit_deposits USING btree (signature);


--
-- Name: llm_credit_deposits_status_quote_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_credit_deposits_status_quote_expires_at_idx ON public.llm_credit_deposits USING btree (status, quote_expires_at);


--
-- Name: llm_provider_balance_snapshots_provider_captured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_provider_balance_snapshots_provider_captured_idx ON public.llm_provider_balance_snapshots USING btree (provider, captured_at DESC);


--
-- Name: llm_run_usage_account_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_run_usage_account_created_idx ON public.llm_run_usage USING btree (app_account_id, created_at DESC);


--
-- Name: llm_run_usage_agent_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_run_usage_agent_created_idx ON public.llm_run_usage USING btree (agent_db_id, created_at DESC);


--
-- Name: llm_run_usage_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_run_usage_created_idx ON public.llm_run_usage USING btree (created_at);


--
-- Name: llm_run_usage_reconciliation_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_run_usage_reconciliation_updated_idx ON public.llm_run_usage USING btree (reconciliation_status, updated_at);


--
-- Name: mesh_signal_deliveries_signal_id_subscription_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mesh_signal_deliveries_signal_id_subscription_id_key ON public.mesh_signal_deliveries USING btree (signal_id, subscription_id);


--
-- Name: mesh_signal_deliveries_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mesh_signal_deliveries_status_created_at_idx ON public.mesh_signal_deliveries USING btree (status, created_at);


--
-- Name: metaplex_attempts_public_creator_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_attempts_public_creator_status_updated_idx ON public.metaplex_launch_attempts USING btree (public_creator_wallet, status, updated_at DESC);


--
-- Name: metaplex_launch_attempts_agent_db_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_launch_attempts_agent_db_id_idx ON public.metaplex_launch_attempts USING btree (agent_db_id);


--
-- Name: metaplex_launch_attempts_asset_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX metaplex_launch_attempts_asset_address_key ON public.metaplex_launch_attempts USING btree (asset_address);


--
-- Name: metaplex_launch_attempts_genesis_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX metaplex_launch_attempts_genesis_address_key ON public.metaplex_launch_attempts USING btree (genesis_address);


--
-- Name: metaplex_launch_attempts_processing_lease_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_launch_attempts_processing_lease_expires_at_idx ON public.metaplex_launch_attempts USING btree (processing_lease_expires_at);


--
-- Name: metaplex_launch_attempts_public_attribution_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX metaplex_launch_attempts_public_attribution_id_key ON public.metaplex_launch_attempts USING btree (public_attribution_id);


--
-- Name: metaplex_launch_attempts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_launch_attempts_status_idx ON public.metaplex_launch_attempts USING btree (status);


--
-- Name: metaplex_launch_attempts_token_mint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX metaplex_launch_attempts_token_mint_key ON public.metaplex_launch_attempts USING btree (token_mint);


--
-- Name: metaplex_launch_attempts_user_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_launch_attempts_user_profile_id_idx ON public.metaplex_launch_attempts USING btree (user_profile_id);


--
-- Name: metaplex_launch_attempts_wallet_address_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metaplex_launch_attempts_wallet_address_idx ON public.metaplex_launch_attempts USING btree (wallet_address);


--
-- Name: notification_deliveries_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_deliveries_idempotency_key_key ON public.notification_deliveries USING btree (idempotency_key);


--
-- Name: notification_deliveries_kind_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_deliveries_kind_created_at_idx ON public.notification_deliveries USING btree (kind, created_at);


--
-- Name: notification_deliveries_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_deliveries_status_created_at_idx ON public.notification_deliveries USING btree (status, created_at);


--
-- Name: order_post_activations_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_post_activations_status_created_at_idx ON public.order_post_activations USING btree (status, created_at);


--
-- Name: partner_jobs_is_sample_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_jobs_is_sample_status_idx ON public.partner_jobs USING btree (is_sample, status);


--
-- Name: partner_jobs_source_external_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX partner_jobs_source_external_id_key ON public.partner_jobs USING btree (source, external_id);


--
-- Name: partner_jobs_source_status_last_seen_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_jobs_source_status_last_seen_at_idx ON public.partner_jobs USING btree (source, status, last_seen_at);


--
-- Name: partner_jobs_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_jobs_status_created_at_idx ON public.partner_jobs USING btree (status, created_at);


--
-- Name: raw_events_chainId_txHash_eventIndex_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "raw_events_chainId_txHash_eventIndex_key" ON public.raw_events USING btree ("chainId", "txHash", "eventIndex");


--
-- Name: raw_events_linkedAgentDbId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "raw_events_linkedAgentDbId_idx" ON public.raw_events USING btree ("linkedAgentDbId");


--
-- Name: registration_document_content_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registration_document_content_path_idx ON public.registration_document_observations USING btree (source_content_address, ipfs_path);


--
-- Name: registration_document_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registration_document_status_idx ON public.registration_document_observations USING btree (availability_status, schema_validity_status);


--
-- Name: robinhood_chain_launches_agent_db_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_chain_launches_agent_db_id_idx ON public.robinhood_chain_launches USING btree (agent_db_id);


--
-- Name: robinhood_chain_launches_block_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_chain_launches_block_timestamp_idx ON public.robinhood_chain_launches USING btree (block_timestamp);


--
-- Name: robinhood_chain_launches_creator_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_chain_launches_creator_wallet_idx ON public.robinhood_chain_launches USING btree (creator_wallet);


--
-- Name: robinhood_chain_launches_source_verified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_chain_launches_source_verified_idx ON public.robinhood_chain_launches USING btree (source_verified);


--
-- Name: robinhood_chain_launches_token_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX robinhood_chain_launches_token_address_key ON public.robinhood_chain_launches USING btree (token_address);


--
-- Name: robinhood_chain_launches_tx_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX robinhood_chain_launches_tx_hash_key ON public.robinhood_chain_launches USING btree (tx_hash);


--
-- Name: robinhood_fee_claims_agent_db_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_fee_claims_agent_db_id_idx ON public.robinhood_fee_claims USING btree (agent_db_id);


--
-- Name: robinhood_fee_claims_claim_tx_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_fee_claims_claim_tx_hash_idx ON public.robinhood_fee_claims USING btree (claim_tx_hash);


--
-- Name: robinhood_fee_claims_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_fee_claims_launch_id_idx ON public.robinhood_fee_claims USING btree (launch_id);


--
-- Name: robinhood_fee_claims_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_fee_claims_status_idx ON public.robinhood_fee_claims USING btree (status);


--
-- Name: robinhood_fee_claims_tx_asset_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX robinhood_fee_claims_tx_asset_key ON public.robinhood_fee_claims USING btree (claim_tx_hash, claimed_asset);


--
-- Name: robinhood_launch_preparations_consumed_tx_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX robinhood_launch_preparations_consumed_tx_hash_key ON public.robinhood_launch_preparations USING btree (consumed_tx_hash);


--
-- Name: robinhood_launch_preparations_creator_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_launch_preparations_creator_wallet_idx ON public.robinhood_launch_preparations USING btree (creator_wallet);


--
-- Name: robinhood_launch_preparations_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robinhood_launch_preparations_expires_at_idx ON public.robinhood_launch_preparations USING btree (expires_at);


--
-- Name: sap_agent_operator_claims_agent_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sap_agent_operator_claims_agent_id_key ON public.sap_agent_operator_claims USING btree (agent_id);


--
-- Name: sap_agent_operator_claims_user_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sap_agent_operator_claims_user_profile_id_idx ON public.sap_agent_operator_claims USING btree (user_profile_id);


--
-- Name: sap_sync_logs_synced_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sap_sync_logs_synced_at_idx ON public.sap_sync_logs USING btree (synced_at);


--
-- Name: site_news_articles_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_news_articles_category_idx ON public.site_news_articles USING btree (category);


--
-- Name: site_news_articles_published_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_news_articles_published_published_at_idx ON public.site_news_articles USING btree (published, published_at);


--
-- Name: site_news_articles_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX site_news_articles_slug_key ON public.site_news_articles USING btree (slug);


--
-- Name: solana_8004_trust_observations_agent_kind_revoked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_observations_agent_kind_revoked_idx ON public.solana_8004_trust_observations USING btree (agent_db_id, kind, revoked);


--
-- Name: solana_8004_trust_observations_asset_client_feedback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_observations_asset_client_feedback_idx ON public.solana_8004_trust_observations USING btree (asset_address, client_address, feedback_index);


--
-- Name: solana_8004_trust_observations_event_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_8004_trust_observations_event_key_key ON public.solana_8004_trust_observations USING btree (event_key);


--
-- Name: solana_8004_trust_observations_kind_signature_event_ordinal_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_8004_trust_observations_kind_signature_event_ordinal_key ON public.solana_8004_trust_observations USING btree (kind, signature, event_ordinal);


--
-- Name: solana_8004_trust_observations_parent_kind_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_observations_parent_kind_status_idx ON public.solana_8004_trust_observations USING btree (parent_key, kind, status);


--
-- Name: solana_8004_trust_observations_signature_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_observations_signature_idx ON public.solana_8004_trust_observations USING btree (signature);


--
-- Name: solana_8004_trust_signatures_slot_signature_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_signatures_slot_signature_idx ON public.solana_8004_trust_signatures USING btree (slot, signature);


--
-- Name: solana_8004_trust_signatures_status_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_8004_trust_signatures_status_slot_idx ON public.solana_8004_trust_signatures USING btree (status, slot);


--
-- Name: solana_agent_observations_asset_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_agent_observations_asset_order_idx ON public.solana_agent_observations USING btree (asset, slot, transaction_index, event_ordinal);


--
-- Name: solana_agent_observations_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_agent_observations_sequence_idx ON public.solana_agent_observations USING btree (sequence_id);


--
-- Name: solana_agent_observations_status_eligible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_agent_observations_status_eligible_idx ON public.solana_agent_observations USING btree (canonical_status, materialization_eligible);


--
-- Name: solana_registry_memberships_agent_db_id_is_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_registry_memberships_agent_db_id_is_current_idx ON public.solana_registry_memberships USING btree (agent_db_id, is_current);


--
-- Name: solana_registry_memberships_agent_source_current_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_registry_memberships_agent_source_current_key ON public.solana_registry_memberships USING btree (agent_db_id, source) WHERE (is_current = true);


--
-- Name: solana_registry_memberships_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_registry_memberships_external_id_idx ON public.solana_registry_memberships USING btree (external_id);


--
-- Name: solana_registry_memberships_source_current_generation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_registry_memberships_source_current_generation_idx ON public.solana_registry_memberships USING btree (source, is_current, last_seen_generation);


--
-- Name: solana_registry_memberships_source_external_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_registry_memberships_source_external_id_key ON public.solana_registry_memberships USING btree (source, external_id);


--
-- Name: solana_registry_memberships_source_is_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_registry_memberships_source_is_current_idx ON public.solana_registry_memberships USING btree (source, is_current);


--
-- Name: solana_registry_snapshots_one_running_per_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_registry_snapshots_one_running_per_source_key ON public.solana_registry_snapshots USING btree (source) WHERE (status = 'running'::text);


--
-- Name: solana_registry_snapshots_source_generation_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solana_registry_snapshots_source_generation_key ON public.solana_registry_snapshots USING btree (source, generation);


--
-- Name: solana_registry_snapshots_source_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_registry_snapshots_source_status_idx ON public.solana_registry_snapshots USING btree (source, status);


--
-- Name: solana_transaction_observations_program_execution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_transaction_observations_program_execution_idx ON public.solana_transaction_observations USING btree (expected_program_id, expected_program_executed);


--
-- Name: solana_transaction_observations_slot_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solana_transaction_observations_slot_status_idx ON public.solana_transaction_observations USING btree (slot, status);


--
-- Name: webhook_receipts_provider_provider_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webhook_receipts_provider_provider_event_id_key ON public.webhook_receipts USING btree (provider, provider_event_id);


--
-- Name: webhook_receipts_status_processing_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_receipts_status_processing_at_idx ON public.webhook_receipts USING btree (status, processing_at);


--
-- Name: worker_resource_leases_lease_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_resource_leases_lease_until_idx ON public.worker_resource_leases USING btree (lease_until);


--
-- Name: worker_resource_rate_budgets_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_resource_rate_budgets_updated_at_idx ON public.worker_resource_rate_budgets USING btree (updated_at);


--
-- Name: worker_resource_states_cooling_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_resource_states_cooling_until_idx ON public.worker_resource_states USING btree (cooling_until) WHERE (cooling_until IS NOT NULL);


--
-- Name: worker_resource_states_rate_limited_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_resource_states_rate_limited_until_idx ON public.worker_resource_states USING btree (rate_limited_until) WHERE (rate_limited_until IS NOT NULL);


--
-- Name: worker_resource_states_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_resource_states_updated_at_idx ON public.worker_resource_states USING btree (updated_at);


--
-- Name: AgentBlocklistRule AgentBlocklistRule_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentBlocklistRule_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."AgentBlocklistRule" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: AgentBlocklistRule AgentBlocklistRule_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentBlocklistRule_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentBlocklistRule" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: AgentBoost AgentBoost_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentBoost_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."AgentBoost" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: AgentBoost AgentBoost_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentBoost_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentBoost" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: AgentMetadata AgentMetadata_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentMetadata_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."AgentMetadata" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: AgentMetadata AgentMetadata_payload_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentMetadata_payload_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentMetadata" FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();


--
-- Name: AgentMetadata AgentMetadata_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentMetadata_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentMetadata" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: AgentMetadata AgentMetadata_score_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentMetadata_score_dirty" AFTER INSERT OR DELETE OR UPDATE ON public."AgentMetadata" FOR EACH ROW EXECUTE FUNCTION public.agentranking_mark_related_agent_score_dirty();


--
-- Name: AgentService AgentService_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentService_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: AgentService AgentService_payload_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentService_payload_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_related_agent_payload_row();


--
-- Name: AgentService AgentService_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentService_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: AgentService AgentService_sap_twin_index; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentService_sap_twin_index" AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_sap_twin_index();


--
-- Name: AgentService AgentService_score_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentService_score_dirty" AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH ROW EXECUTE FUNCTION public.agentranking_mark_related_agent_score_dirty();


--
-- Name: AgentVote AgentVote_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentVote_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."AgentVote" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: AgentVote AgentVote_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "AgentVote_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."AgentVote" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: Agent Agent_global_ranks_insert_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_global_ranks_insert_delete" AFTER INSERT OR DELETE ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: Agent Agent_global_ranks_score_lifecycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_global_ranks_score_lifecycle" AFTER UPDATE OF "agentRankScore", "isActive", "adminPowerAdjust", name, description, image, "chainId", "agentId" ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: Agent Agent_mark_score_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_mark_score_dirty" BEFORE UPDATE ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.agentranking_mark_agent_score_dirty();


--
-- Name: Agent Agent_payload_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_payload_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.agentranking_invalidate_agent_payload_row();


--
-- Name: Agent Agent_public_cache_domains_insert_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_public_cache_domains_insert_delete" AFTER INSERT OR DELETE ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: Agent Agent_public_cache_domains_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_public_cache_domains_update" AFTER UPDATE OF "agentId", "chainId", name, description, image, "agentURI", owner, publicly_active, "isActive", "isVerified", score, "hotScore", rank, "x402Support", "isSmartBatchEnabled", stars, "totalFeedback", "totalMessages", "totalChats", "totalWatches", "scoreQuality", "scorePopularity", "scoreActivity", "scoreWallet", "scoreFreshness", score_verified_revenue, "scoreMetadata", "scoreServices", score_social, score_compliance, "supportedTrust", "isCustomListed", "isPremiumVerified", public_verification_status, "binanceCompatible", "hasDuplicateName", "powerScore", "agentRankScore", discovery_score, "activityScore", "adminPowerAdjust", "activeBoosts", "voteFireCount", "votePooCount", "tokenAddress", archetype, "archetypeAuto", "agentMode", "protocolTrustScore", "executionScore", "verifiedWallet", "verifiedWalletAt", "verifiedWalletChainId", "perfWinRate", "perfAvgPnlPercent", "perfBurnToEarnRatio", "perfTotalVolumeUsd", "perfMonthlyPnlUsd", "perfLastComputedAt", "perfTxCount", "perfProfitableTxCount", "isVerifiedRevenue", "verifiedRevenueAt", "verifiedRevenueExpiresAt", "recentActivity", "activityUpdatedAt", "activeWinRate30d", "nativeVolume30d", listing_registry_source, sap_verified, sap_agent_pda, sap_stats_pda, sap_capabilities, sap_pricing_tiers, sap_protocols, sap_x402_endpoint, sap_registration_tx, sap_last_synced_at, sap_stats, sap_owner_wallet, sap_registered_at, metaplex_verified, metaplex_agent_token_mint, metaplex_asset_address, metaplex_active, metaplex_launch_address, metaplex_launch_type, metaplex_launch_status, metaplex_bonding_progress_pct, metaplex_has_dex_pair, public_referral_code, public_referral_destination, public_referral_info, work_ready_status, work_ready_reasons, featured_work_ready, "listedAt", "lastActiveAt", cluster_key, ar_verification_status, ar_verified_at ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: Agent Agent_record_indexer_bootstrap_first_agent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_record_indexer_bootstrap_first_agent" AFTER INSERT ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.record_indexer_bootstrap_first_agent();


--
-- Name: Agent Agent_refresh_duplicate_names_insert_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_refresh_duplicate_names_insert_delete" AFTER INSERT OR DELETE ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.agentranking_refresh_duplicate_names_for_row();


--
-- Name: Agent Agent_refresh_duplicate_names_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_refresh_duplicate_names_update" AFTER UPDATE OF name, "chainId" ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.agentranking_refresh_duplicate_names_for_row();


--
-- Name: Agent Agent_sap_twin_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_sap_twin_fields" AFTER UPDATE OF name, "isActive", sap_verified, "agentURI", sap_x402_endpoint, sap_stats ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_sap_twin_index();


--
-- Name: Agent Agent_sap_twin_insert_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_sap_twin_insert_delete" AFTER INSERT OR DELETE ON public."Agent" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_sap_twin_index();


--
-- Name: Agent Agent_score_enqueue_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_score_enqueue_insert" AFTER INSERT ON public."Agent" FOR EACH ROW EXECUTE FUNCTION public.agentranking_enqueue_agent_score_version();


--
-- Name: Agent Agent_score_enqueue_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Agent_score_enqueue_version" AFTER UPDATE OF score_state_version ON public."Agent" FOR EACH ROW WHEN ((old.score_state_version IS DISTINCT FROM new.score_state_version)) EXECUTE FUNCTION public.agentranking_enqueue_agent_score_version();


--
-- Name: ArHolderAgentPerk ArHolderAgentPerk_global_ranks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "ArHolderAgentPerk_global_ranks" AFTER INSERT OR DELETE OR UPDATE ON public."ArHolderAgentPerk" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_global_ranks();


--
-- Name: ArHolderAgentPerk ArHolderAgentPerk_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "ArHolderAgentPerk_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."ArHolderAgentPerk" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_agent_public_domains();


--
-- Name: Feedback Feedback_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Feedback_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."Feedback" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_feedback_domains();


--
-- Name: Feedback Feedback_score_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Feedback_score_dirty" AFTER INSERT OR DELETE OR UPDATE ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION public.agentranking_mark_related_agent_score_dirty();


--
-- Name: Promotion Promotion_public_cache_domains; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "Promotion_public_cache_domains" AFTER INSERT OR DELETE OR UPDATE ON public."Promotion" FOR EACH STATEMENT EXECUTE FUNCTION public.agentranking_invalidate_promotion_domains();


--
-- Name: Agent agent_score_guard_derived_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_score_guard_derived_write BEFORE UPDATE OF "totalFeedback", score, "hotScore", "scoreQuality", "scorePopularity", "scoreActivity", "scoreWallet", "scoreFreshness", score_verified_revenue, "scoreMetadata", "scoreServices", score_social, score_compliance ON public."Agent" FOR EACH ROW WHEN (((old."totalFeedback" IS DISTINCT FROM new."totalFeedback") OR (old.score IS DISTINCT FROM new.score) OR (old."hotScore" IS DISTINCT FROM new."hotScore") OR (old."scoreQuality" IS DISTINCT FROM new."scoreQuality") OR (old."scorePopularity" IS DISTINCT FROM new."scorePopularity") OR (old."scoreActivity" IS DISTINCT FROM new."scoreActivity") OR (old."scoreWallet" IS DISTINCT FROM new."scoreWallet") OR (old."scoreFreshness" IS DISTINCT FROM new."scoreFreshness") OR (old.score_verified_revenue IS DISTINCT FROM new.score_verified_revenue) OR (old."scoreMetadata" IS DISTINCT FROM new."scoreMetadata") OR (old."scoreServices" IS DISTINCT FROM new."scoreServices") OR (old.score_social IS DISTINCT FROM new.score_social) OR (old.score_compliance IS DISTINCT FROM new.score_compliance))) EXECUTE FUNCTION public.agentranking_guard_derived_score_write();


--
-- Name: Feedback agent_score_stale_on_feedback_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_score_stale_on_feedback_change AFTER INSERT OR DELETE OR UPDATE ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION public.agentranking_bump_related_agent_score();


--
-- Name: AgentMetadata agent_score_stale_on_metadata_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_score_stale_on_metadata_change AFTER INSERT OR DELETE OR UPDATE ON public."AgentMetadata" FOR EACH ROW EXECUTE FUNCTION public.agentranking_bump_related_agent_score();


--
-- Name: AgentService agent_score_stale_on_service_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_score_stale_on_service_change AFTER INSERT OR DELETE OR UPDATE ON public."AgentService" FOR EACH ROW EXECUTE FUNCTION public.agentranking_bump_related_agent_score();


--
-- Name: Agent agent_score_stale_on_source_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_score_stale_on_source_change BEFORE UPDATE OF name, description, image, "x402Support", "binanceCompatible", activity_observed_at, "lastActiveAt", "isVerifiedRevenue", "perfWinRate", "perfMonthlyPnlUsd", "perfBurnToEarnRatio", source_quality_score, source_feedback_count, wallet_hydration_status ON public."Agent" FOR EACH ROW WHEN (((old.name IS DISTINCT FROM new.name) OR (old.description IS DISTINCT FROM new.description) OR (old.image IS DISTINCT FROM new.image) OR (old."x402Support" IS DISTINCT FROM new."x402Support") OR (old."binanceCompatible" IS DISTINCT FROM new."binanceCompatible") OR (old.activity_observed_at IS DISTINCT FROM new.activity_observed_at) OR (old."lastActiveAt" IS DISTINCT FROM new."lastActiveAt") OR (old."isVerifiedRevenue" IS DISTINCT FROM new."isVerifiedRevenue") OR (old."perfWinRate" IS DISTINCT FROM new."perfWinRate") OR (old."perfMonthlyPnlUsd" IS DISTINCT FROM new."perfMonthlyPnlUsd") OR (old."perfBurnToEarnRatio" IS DISTINCT FROM new."perfBurnToEarnRatio") OR (old.source_quality_score IS DISTINCT FROM new.source_quality_score) OR (old.source_feedback_count IS DISTINCT FROM new.source_feedback_count) OR (old.wallet_hydration_status IS DISTINCT FROM new.wallet_hydration_status))) EXECUTE FUNCTION public.agentranking_mark_agent_score_stale();


--
-- Name: AdPackage AdPackage_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdPackage"
    ADD CONSTRAINT "AdPackage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentAlertRule AgentAlertRule_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAlertRule"
    ADD CONSTRAINT "AgentAlertRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentAlertRule AgentAlertRule_userProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAlertRule"
    ADD CONSTRAINT "AgentAlertRule_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AgentAnalyticsEvent AgentAnalyticsEvent_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAnalyticsEvent"
    ADD CONSTRAINT "AgentAnalyticsEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentAnalyticsEvent AgentAnalyticsEvent_serviceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentAnalyticsEvent"
    ADD CONSTRAINT "AgentAnalyticsEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES public."AgentService"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentBoost AgentBoost_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentBoost"
    ADD CONSTRAINT "AgentBoost_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AgentBoost AgentBoost_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentBoost"
    ADD CONSTRAINT "AgentBoost_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentMcpOffer AgentMcpOffer_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMcpOffer"
    ADD CONSTRAINT "AgentMcpOffer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AgentMcpOffer AgentMcpOffer_linkedServiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMcpOffer"
    ADD CONSTRAINT "AgentMcpOffer_linkedServiceId_fkey" FOREIGN KEY ("linkedServiceId") REFERENCES public."AgentService"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentMetadata AgentMetadata_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentMetadata"
    ADD CONSTRAINT "AgentMetadata_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentPerfSnapshot AgentPerfSnapshot_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentPerfSnapshot"
    ADD CONSTRAINT "AgentPerfSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentRankSnapshot AgentRankSnapshot_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentRankSnapshot"
    ADD CONSTRAINT "AgentRankSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentReport AgentReport_agentDbId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentReport"
    ADD CONSTRAINT "AgentReport_agentDbId_fkey" FOREIGN KEY ("agentDbId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AgentService AgentService_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentService"
    ADD CONSTRAINT "AgentService_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentStar AgentStar_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentStar"
    ADD CONSTRAINT "AgentStar_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AgentVerificationRequest AgentVerificationRequest_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVerificationRequest"
    ADD CONSTRAINT "AgentVerificationRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AgentVerificationRequest AgentVerificationRequest_userProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVerificationRequest"
    ADD CONSTRAINT "AgentVerificationRequest_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AgentVote AgentVote_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AgentVote"
    ADD CONSTRAINT "AgentVote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Agent Agent_agent_evm_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_agent_evm_wallet_id_fkey" FOREIGN KEY (agent_evm_wallet_id) REFERENCES public.custodial_wallets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Agent Agent_agent_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_agent_wallet_id_fkey" FOREIGN KEY (agent_wallet_id) REFERENCES public.custodial_wallets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Agent Agent_chainId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES public."Chain"("chainId") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Agent Agent_owner_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Agent"
    ADD CONSTRAINT "Agent_owner_account_id_fkey" FOREIGN KEY (owner_account_id) REFERENCES public.app_accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ArHolderAgentPerk ArHolderAgentPerk_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArHolderAgentPerk"
    ADD CONSTRAINT "ArHolderAgentPerk_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ArReferralAdjustment ArReferralAdjustment_referralCodeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralAdjustment"
    ADD CONSTRAINT "ArReferralAdjustment_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES public."ArReferralCode"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ArReferralCode ArReferralCode_userProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralCode"
    ADD CONSTRAINT "ArReferralCode_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ArReferralCommission ArReferralCommission_referralCodeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralCommission"
    ADD CONSTRAINT "ArReferralCommission_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES public."ArReferralCode"(id) ON DELETE CASCADE;


--
-- Name: ArReferralEvent ArReferralEvent_referralCodeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralEvent"
    ADD CONSTRAINT "ArReferralEvent_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES public."ArReferralCode"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ArReferralEvent ArReferralEvent_referredUserProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ArReferralEvent"
    ADD CONSTRAINT "ArReferralEvent_referredUserProfileId_fkey" FOREIGN KEY ("referredUserProfileId") REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BountyDispute BountyDispute_bountyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BountyDispute"
    ADD CONSTRAINT "BountyDispute_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES public."Bounty"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Bounty Bounty_claimedByAgentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Bounty"
    ADD CONSTRAINT "Bounty_claimedByAgentId_fkey" FOREIGN KEY ("claimedByAgentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ContactInquiryReply ContactInquiryReply_inquiryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ContactInquiryReply"
    ADD CONSTRAINT "ContactInquiryReply_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES public."ContactInquiry"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DaoLeaderboardSnapshot DaoLeaderboardSnapshot_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DaoLeaderboardSnapshot"
    ADD CONSTRAINT "DaoLeaderboardSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON DELETE CASCADE;


--
-- Name: Feedback Feedback_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Feedback"
    ADD CONSTRAINT "Feedback_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MeshSubscription MeshSubscription_publisherAgentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MeshSubscription"
    ADD CONSTRAINT "MeshSubscription_publisherAgentId_fkey" FOREIGN KEY ("publisherAgentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MeshSubscription MeshSubscription_subscriberAgentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MeshSubscription"
    ADD CONSTRAINT "MeshSubscription_subscriberAgentId_fkey" FOREIGN KEY ("subscriberAgentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Order Order_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Promotion Promotion_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Promotion"
    ADD CONSTRAINT "Promotion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TrustEvent TrustEvent_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TrustEvent"
    ADD CONSTRAINT "TrustEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WalletLinkChallenge WalletLinkChallenge_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WalletLinkChallenge"
    ADD CONSTRAINT "WalletLinkChallenge_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: account_credit_ledger account_credit_ledger_app_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_credit_ledger
    ADD CONSTRAINT account_credit_ledger_app_account_id_fkey FOREIGN KEY (app_account_id) REFERENCES public.app_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_alert_deliveries agent_alert_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_alert_deliveries
    ADD CONSTRAINT agent_alert_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.agent_alert_events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_alert_deliveries agent_alert_deliveries_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_alert_deliveries
    ADD CONSTRAINT agent_alert_deliveries_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public."AgentAlertRule"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_alert_events agent_alert_events_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_alert_events
    ADD CONSTRAINT agent_alert_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_analytics_daily agent_analytics_daily_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_analytics_daily
    ADD CONSTRAINT "agent_analytics_daily_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_conversations agent_chat_conversations_agent_db_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_conversations
    ADD CONSTRAINT agent_chat_conversations_agent_db_id_fkey FOREIGN KEY (agent_db_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_conversations agent_chat_conversations_app_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_conversations
    ADD CONSTRAINT agent_chat_conversations_app_account_id_fkey FOREIGN KEY (app_account_id) REFERENCES public.app_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_conversations agent_chat_conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_conversations
    ADD CONSTRAINT agent_chat_conversations_created_by_fkey FOREIGN KEY (created_by_user_profile_id) REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_messages agent_chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_messages
    ADD CONSTRAINT agent_chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.agent_chat_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_run_attempts agent_chat_run_attempts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_run_attempts
    ADD CONSTRAINT agent_chat_run_attempts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_chat_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_run_runtime agent_chat_run_runtime_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_run_runtime
    ADD CONSTRAINT agent_chat_run_runtime_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_chat_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_runs agent_chat_runs_assistant_message_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_assistant_message_scope_fkey FOREIGN KEY (conversation_id, assistant_message_id) REFERENCES public.agent_chat_messages(conversation_id, id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_runs agent_chat_runs_conversation_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_conversation_scope_fkey FOREIGN KEY (conversation_id, app_account_id, agent_db_id) REFERENCES public.agent_chat_conversations(id, app_account_id, agent_db_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_runs agent_chat_runs_settings_revision_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_settings_revision_scope_fkey FOREIGN KEY (settings_revision_id, agent_db_id) REFERENCES public.agent_chat_settings_revisions(id, agent_db_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_runs agent_chat_runs_user_message_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_runs
    ADD CONSTRAINT agent_chat_runs_user_message_scope_fkey FOREIGN KEY (conversation_id, user_message_id) REFERENCES public.agent_chat_messages(conversation_id, id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_settings agent_chat_settings_agent_db_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_agent_db_id_fkey FOREIGN KEY (agent_db_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_settings agent_chat_settings_current_revision_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_current_revision_scope_fkey FOREIGN KEY (current_revision_id, agent_db_id) REFERENCES public.agent_chat_settings_revisions(id, agent_db_id) ON UPDATE CASCADE;


--
-- Name: agent_chat_settings_revisions agent_chat_settings_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings_revisions
    ADD CONSTRAINT agent_chat_settings_revisions_created_by_fkey FOREIGN KEY (created_by_user_profile_id) REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: agent_chat_settings_revisions agent_chat_settings_revisions_settings_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_settings_revisions
    ADD CONSTRAINT agent_chat_settings_revisions_settings_scope_fkey FOREIGN KEY (settings_id, agent_db_id) REFERENCES public.agent_chat_settings(id, agent_db_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_chat_tool_events agent_chat_tool_events_run_message_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_chat_tool_events
    ADD CONSTRAINT agent_chat_tool_events_run_message_fkey FOREIGN KEY (run_id, assistant_message_id) REFERENCES public.agent_chat_runs(id, assistant_message_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_github_connections agent_github_connections_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_connections
    ADD CONSTRAINT "agent_github_connections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_github_push_notes agent_github_push_notes_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_push_notes
    ADD CONSTRAINT "agent_github_push_notes_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_github_snapshots agent_github_snapshots_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_github_snapshots
    ADD CONSTRAINT "agent_github_snapshots_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_launch_events agent_launch_events_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_events
    ADD CONSTRAINT agent_launch_events_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.agent_launches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_launch_fee_distribution_attempts agent_launch_fee_distribution_attempts_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_fee_distribution_attempts
    ADD CONSTRAINT agent_launch_fee_distribution_attempts_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.agent_launches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_launch_fee_distributions agent_launch_fee_distributions_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launch_fee_distributions
    ADD CONSTRAINT agent_launch_fee_distributions_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.agent_launches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_launches agent_launches_agent_db_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_launches
    ADD CONSTRAINT agent_launches_agent_db_id_fkey FOREIGN KEY (agent_db_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: agent_official_links agent_official_links_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_official_links
    ADD CONSTRAINT "agent_official_links_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_paid_services agent_paid_services_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_paid_services
    ADD CONSTRAINT "agent_paid_services_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_verification_signals agent_verification_signals_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_verification_signals
    ADD CONSTRAINT "agent_verification_signals_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_accounts app_accounts_account_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_accounts
    ADD CONSTRAINT app_accounts_account_wallet_id_fkey FOREIGN KEY (account_wallet_id) REFERENCES public.custodial_wallets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: app_accounts app_accounts_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_accounts
    ADD CONSTRAINT app_accounts_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: custodial_wallet_audit custodial_wallet_audit_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custodial_wallet_audit
    ADD CONSTRAINT custodial_wallet_audit_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.custodial_wallets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: custodial_wallet_transfers custodial_wallet_transfers_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custodial_wallet_transfers
    ADD CONSTRAINT custodial_wallet_transfers_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.custodial_wallets(id) ON DELETE CASCADE;


--
-- Name: evm_event_observations evm_event_observations_contract_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evm_event_observations
    ADD CONSTRAINT evm_event_observations_contract_generation_id_fkey FOREIGN KEY (contract_generation_id) REFERENCES public.evm_contract_generations(id) ON DELETE SET NULL;


--
-- Name: fairscale_agent_assessments fairscale_agent_assessments_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fairscale_agent_assessments
    ADD CONSTRAINT fairscale_agent_assessments_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indexer_bootstrap_sources indexer_bootstrap_sources_epoch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_bootstrap_sources
    ADD CONSTRAINT indexer_bootstrap_sources_epoch_id_fkey FOREIGN KEY (epoch_id) REFERENCES public.indexer_bootstrap_epochs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indexer_bootstrap_work_items indexer_bootstrap_work_items_epoch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indexer_bootstrap_work_items
    ADD CONSTRAINT indexer_bootstrap_work_items_epoch_id_fkey FOREIGN KEY (epoch_id) REFERENCES public.indexer_bootstrap_epochs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_interaction_events job_interaction_events_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_interaction_events
    ADD CONSTRAINT job_interaction_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: job_interaction_events job_interaction_events_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_interaction_events
    ADD CONSTRAINT job_interaction_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.partner_jobs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: llm_credit_deposits llm_credit_deposits_app_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_credit_deposits
    ADD CONSTRAINT llm_credit_deposits_app_account_id_fkey FOREIGN KEY (app_account_id) REFERENCES public.app_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: llm_run_usage llm_run_usage_run_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_run_usage
    ADD CONSTRAINT llm_run_usage_run_scope_fkey FOREIGN KEY (run_id, app_account_id, agent_db_id) REFERENCES public.agent_chat_runs(id, app_account_id, agent_db_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mesh_signal_deliveries mesh_signal_deliveries_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mesh_signal_deliveries
    ADD CONSTRAINT mesh_signal_deliveries_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public."MeshSignal"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mesh_signal_deliveries mesh_signal_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mesh_signal_deliveries
    ADD CONSTRAINT mesh_signal_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public."MeshSubscription"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: order_post_activations order_post_activations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_post_activations
    ADD CONSTRAINT order_post_activations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."Order"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: raw_events raw_events_linkedAgentDbId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_events
    ADD CONSTRAINT "raw_events_linkedAgentDbId_fkey" FOREIGN KEY ("linkedAgentDbId") REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: robinhood_fee_claims robinhood_fee_claims_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robinhood_fee_claims
    ADD CONSTRAINT robinhood_fee_claims_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.robinhood_chain_launches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sap_agent_operator_claims sap_agent_operator_claims_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sap_agent_operator_claims
    ADD CONSTRAINT sap_agent_operator_claims_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sap_agent_operator_claims sap_agent_operator_claims_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sap_agent_operator_claims
    ADD CONSTRAINT sap_agent_operator_claims_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public."UserProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solana_8004_trust_observations solana_8004_trust_observations_agent_db_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_8004_trust_observations
    ADD CONSTRAINT solana_8004_trust_observations_agent_db_id_fkey FOREIGN KEY (agent_db_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solana_8004_trust_observations solana_8004_trust_observations_signature_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_8004_trust_observations
    ADD CONSTRAINT solana_8004_trust_observations_signature_fkey FOREIGN KEY (signature) REFERENCES public.solana_8004_trust_signatures(signature) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solana_registry_memberships solana_registry_memberships_agent_db_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solana_registry_memberships
    ADD CONSTRAINT solana_registry_memberships_agent_db_id_fkey FOREIGN KEY (agent_db_id) REFERENCES public."Agent"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AdOrder; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AdOrder" ENABLE ROW LEVEL SECURITY;

--
-- Name: AdOrderSquare; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AdOrderSquare" ENABLE ROW LEVEL SECURITY;

--
-- Name: AdOrderStrip; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AdOrderStrip" ENABLE ROW LEVEL SECURITY;

--
-- Name: AdPackage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AdPackage" ENABLE ROW LEVEL SECURITY;

--
-- Name: Agent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Agent" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentAlertRule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentAlertRule" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentAnalyticsEvent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentAnalyticsEvent" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentBlocklistRule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentBlocklistRule" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentBoost; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentBoost" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentMcpOffer; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentMcpOffer" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentMetadata; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentMetadata" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentPerfSnapshot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentPerfSnapshot" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentRankSnapshot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentRankSnapshot" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentReport; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentReport" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentService; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentService" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentStar; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentStar" ENABLE ROW LEVEL SECURITY;

--
-- Name: AgentVote; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AgentVote" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArHolderAgentPerk; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArHolderAgentPerk" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArPayoutBatch; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArPayoutBatch" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArPayoutWallet; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArPayoutWallet" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArReferralAdjustment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArReferralAdjustment" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArReferralCode; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArReferralCode" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArReferralCommission; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArReferralCommission" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArReferralEvent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArReferralEvent" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArStakePerkOverride; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArStakePerkOverride" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArStakePerkRule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArStakePerkRule" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArStakePosition; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArStakePosition" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArTokenHolderSnapshot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArTokenHolderSnapshot" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArTokenMetricEvent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArTokenMetricEvent" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArTokenPerkConfig; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArTokenPerkConfig" ENABLE ROW LEVEL SECURITY;

--
-- Name: ArTokenSettings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ArTokenSettings" ENABLE ROW LEVEL SECURITY;

--
-- Name: Bounty; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Bounty" ENABLE ROW LEVEL SECURITY;

--
-- Name: BountyDispute; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BountyDispute" ENABLE ROW LEVEL SECURITY;

--
-- Name: Chain; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Chain" ENABLE ROW LEVEL SECURITY;

--
-- Name: ContactInquiry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ContactInquiry" ENABLE ROW LEVEL SECURITY;

--
-- Name: ContactInquiryReply; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ContactInquiryReply" ENABLE ROW LEVEL SECURITY;

--
-- Name: ConversionEvent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ConversionEvent" ENABLE ROW LEVEL SECURITY;

--
-- Name: Feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Feedback" ENABLE ROW LEVEL SECURITY;

--
-- Name: MeshSignal; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."MeshSignal" ENABLE ROW LEVEL SECURITY;

--
-- Name: MeshSubscription; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."MeshSubscription" ENABLE ROW LEVEL SECURITY;

--
-- Name: Order; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY;

--
-- Name: ProfileFollow; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ProfileFollow" ENABLE ROW LEVEL SECURITY;

--
-- Name: Promotion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Promotion" ENABLE ROW LEVEL SECURITY;

--
-- Name: PromotionPrice; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PromotionPrice" ENABLE ROW LEVEL SECURITY;

--
-- Name: SyncState; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SyncState" ENABLE ROW LEVEL SECURITY;

--
-- Name: TrustEvent; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TrustEvent" ENABLE ROW LEVEL SECURITY;

--
-- Name: UserProfile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."UserProfile" ENABLE ROW LEVEL SECURITY;

--
-- Name: WalletLinkChallenge; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."WalletLinkChallenge" ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_summaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_verification_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_verification_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raw_events ENABLE ROW LEVEL SECURITY;

--
-- Name: sap_agent_operator_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sap_agent_operator_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: sap_sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sap_sync_logs ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

-- Static operational configuration required by a fresh application database.
INSERT INTO public."PromotionPrice" ("slotType", currency, "durationDays", amount)
VALUES
  ('custom_listing', 'ETH', 7, '0.03'),
  ('custom_listing', 'SOL', 7, '0.5'),
  ('custom_listing', 'USDC', 7, '60'),
  ('featured', 'ETH', 1, '0.02'),
  ('featured', 'ETH', 2, '0.03'),
  ('featured', 'ETH', 7, '0.1'),
  ('featured', 'ETH', 14, '0.16'),
  ('featured', 'ETH', 30, '0.25'),
  ('featured', 'SOL', 1, '0.30'),
  ('featured', 'SOL', 2, '0.45'),
  ('featured', 'SOL', 7, '1.6'),
  ('featured', 'SOL', 14, '2.50'),
  ('featured', 'SOL', 30, '4.00'),
  ('featured', 'USDC', 1, '50'),
  ('featured', 'USDC', 2, '70'),
  ('featured', 'USDC', 7, '200'),
  ('featured', 'USDC', 14, '320'),
  ('featured', 'USDC', 30, '500'),
  ('hot', 'ETH', 1, '0.01'),
  ('hot', 'ETH', 2, '0.015'),
  ('hot', 'ETH', 7, '0.05'),
  ('hot', 'ETH', 14, '0.08'),
  ('hot', 'ETH', 30, '0.12'),
  ('hot', 'SOL', 1, '0.15'),
  ('hot', 'SOL', 2, '0.22'),
  ('hot', 'SOL', 7, '0.8'),
  ('hot', 'SOL', 14, '1.2'),
  ('hot', 'SOL', 30, '1.8'),
  ('hot', 'USDC', 1, '25'),
  ('hot', 'USDC', 2, '35'),
  ('hot', 'USDC', 7, '100'),
  ('hot', 'USDC', 14, '160'),
  ('hot', 'USDC', 30, '240'),
  ('premium_verify', 'ETH', 7, '0.02'),
  ('premium_verify', 'SOL', 7, '0.3'),
  ('premium_verify', 'USDC', 7, '40')
ON CONFLICT ("slotType", currency, "durationDays")
DO UPDATE SET amount = EXCLUDED.amount;

INSERT INTO public.job_partner_sources
  (id, source, display_name, website_url, docs_url, enabled, updated_at)
VALUES
  ('earnfi', 'earnfi', 'EarnFi', 'https://app.earnfi.fun', 'https://docs.earnfi.fun', true, CURRENT_TIMESTAMP),
  ('wurk', 'wurk', 'WURK', 'https://wurk.fun', 'https://wurk.fun/docs', true, CURRENT_TIMESTAMP)
ON CONFLICT (source) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  website_url = EXCLUDED.website_url,
  docs_url = EXCLUDED.docs_url,
  enabled = EXCLUDED.enabled,
  updated_at = CURRENT_TIMESTAMP;
