-- Ensure every database mutation that changes the public ranking projection
-- advances the shared Valkey ranking namespace generation.

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_agent_public_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  PERFORM agentranking_queue_cache_domain('stats:top-by-chain');
  PERFORM agentranking_queue_cache_domain('powerboost');
  PERFORM agentranking_queue_cache_domain('ranking');
  PERFORM agentranking_queue_cache_domain('agents:list:web');
  PERFORM agentranking_queue_cache_domain('agents:list:v1');
  PERFORM agentranking_queue_cache_domain('agents:list:v2');
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.agentranking_invalidate_feedback_domains() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM agentranking_queue_cache_domain('stats:lists');
  PERFORM agentranking_queue_cache_domain('stats:top-by-chain');
  PERFORM agentranking_queue_cache_domain('powerboost');
  PERFORM agentranking_queue_cache_domain('ranking');
  PERFORM agentranking_queue_cache_domain('agents:list:web');
  PERFORM agentranking_queue_cache_domain('agents:list:v1');
  PERFORM agentranking_queue_cache_domain('agents:list:v2');
  RETURN NULL;
END
$$;
