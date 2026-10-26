import "server-only";
import { cosineSimilarity, embedMany } from "ai";
import { createHash } from "node:crypto";
import { openrouter } from "@/lib/llm-provider/openrouter";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";

export const REMOTE_SEMANTIC_CANDIDATE_LIMIT = 48;
export const REMOTE_SEMANTIC_MIN_SIMILARITY = 0.3;

const SEMANTIC_EMBEDDING_MODEL_ID = "openai/text-embedding-3-small";
const MAX_SEMANTIC_QUERY_CHARS = 8_000;
const MAX_SEMANTIC_DOCUMENT_CHARS = 1_000;
const EMBEDDING_VECTOR_CACHE_LIMIT = 640;

// Runtime tool descriptions, compact history/artifact candidates, and the same
// user query are frequently ranked by several context subsystems in one run.
// Cache only vectors keyed by a one-way hash of bounded text: raw prompt/context
// text is not retained as a cache key, while identical semantic inputs avoid
// repeated provider embedding work.
const embeddingVectorCache = new Map<string, number[]>();

function embeddingCacheKey(text: string): string {
  return createHash("sha256")
    .update(SEMANTIC_EMBEDDING_MODEL_ID)
    .update("\0")
    .update(text)
    .digest("base64url");
}

function readCachedEmbedding(key: string): number[] | undefined {
  const value = embeddingVectorCache.get(key);
  if (!value) return undefined;
  // Refresh insertion order to provide a tiny process-local LRU without an
  // additional dependency/data structure.
  embeddingVectorCache.delete(key);
  embeddingVectorCache.set(key, value);
  return value;
}

function cacheEmbedding(key: string, embedding: number[]): void {
  embeddingVectorCache.delete(key);
  embeddingVectorCache.set(key, embedding);
  while (embeddingVectorCache.size > EMBEDDING_VECTOR_CACHE_LIMIT) {
    const oldest = embeddingVectorCache.keys().next().value;
    if (typeof oldest !== "string") break;
    embeddingVectorCache.delete(oldest);
  }
}

export type SemanticRankingCandidate = {
  id: string;
  text: string;
};

export type SemanticRankingOptions = {
  /**
   * Semantic ranking uses the platform OpenRouter embedding lane. Callers may
   * enable it only when the parent run already uses that same physical platform
   * provider; a generic platform-billing decision is not sufficient provider
   * affinity.
   */
  allowPlatformEmbeddings: boolean;
};

function boundedText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const half = Math.floor((maxChars - 24) / 2);
  return `${trimmed.slice(0, half)}\n...[truncated]...\n${trimmed.slice(-half)}`;
}

export async function rankCandidatesSemantically(
  query: string,
  candidates: readonly SemanticRankingCandidate[],
  options: SemanticRankingOptions,
): Promise<Map<string, number>> {
  const queryText = boundedText(query, MAX_SEMANTIC_QUERY_CHARS);
  if (
    !queryText ||
    candidates.length === 0 ||
    !options.allowPlatformEmbeddings ||
    !process.env.OPENROUTER_API_KEY?.trim()
  ) {
    return new Map();
  }

  const uniqueCandidates: SemanticRankingCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    uniqueCandidates.push(candidate);
    if (uniqueCandidates.length >= REMOTE_SEMANTIC_CANDIDATE_LIMIT) break;
  }
  if (uniqueCandidates.length === 0) return new Map();

  try {
    const documents = uniqueCandidates.map((candidate) => {
      const text = boundedText(candidate.text, MAX_SEMANTIC_DOCUMENT_CHARS);
      const cacheKey = embeddingCacheKey(text);
      return { candidate, text, cacheKey };
    });
    const queryCacheKey = embeddingCacheKey(queryText);
    const missingByKey = new Map<string, string>();
    if (!readCachedEmbedding(queryCacheKey)) {
      missingByKey.set(queryCacheKey, queryText);
    }
    for (const document of documents) {
      if (readCachedEmbedding(document.cacheKey)) continue;
      if (!missingByKey.has(document.cacheKey)) {
        missingByKey.set(document.cacheKey, document.text);
      }
    }
    const missing = [...missingByKey.entries()];
    if (missing.length > 0) {
      const { embeddings } = await embedMany({
        model: openrouter.textEmbeddingModel(SEMANTIC_EMBEDDING_MODEL_ID),
        values: missing.map(([, text]) => text),
        maxRetries: 0,
        maxParallelCalls: 1,
        abortSignal: AbortSignal.timeout(2_000),
      });
      for (let index = 0; index < missing.length; index += 1) {
        const embedding = embeddings[index];
        if (!embedding) continue;
        cacheEmbedding(missing[index]![0], embedding);
      }
    }
    const queryEmbedding = readCachedEmbedding(queryCacheKey);
    if (!queryEmbedding) return new Map();

    const scores = new Map<string, number>();
    for (const document of documents) {
      const embedding = readCachedEmbedding(document.cacheKey);
      if (!embedding) continue;
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (!Number.isFinite(similarity)) continue;
      scores.set(document.candidate.id, Math.max(-1, Math.min(1, similarity)));
    }
    return scores;
  } catch (error) {
    console.warn("[agent-chat] remote semantic ranking unavailable; using lexical ranking", {
      error: safeErrorDetails(error),
    });
    return new Map();
  }
}
