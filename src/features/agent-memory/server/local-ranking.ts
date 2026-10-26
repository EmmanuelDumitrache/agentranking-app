import "server-only";

export const AGENT_MEMORY_LOCAL_CANDIDATE_LIMIT = 48;
export const AGENT_MEMORY_MIN_LOCAL_RELEVANCE = 0.3;

const MAX_LOCAL_QUERY_CHARS = 8_000;
const MAX_LOCAL_DOCUMENT_CHARS = 1_000;
const MAX_LOCAL_QUERY_TOKENS = 96;
const MAX_LOCAL_DOCUMENT_TOKENS = 160;
const MIN_LOCAL_FUZZY_TOKEN_SCORE = 0.42;

export type MemoryLocalCandidate = {
  id: string;
  text: string;
};

type LocalTokenProfile = {
  value: string;
  trigrams: ReadonlySet<string>;
};

type LocalTextProfile = {
  normalized: string;
  tokens: readonly LocalTokenProfile[];
  tokenValues: ReadonlySet<string>;
};

function boundedText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const half = Math.floor((maxChars - 24) / 2);
  return `${trimmed.slice(0, half)}\n...[truncated]...\n${trimmed.slice(-half)}`;
}

function normalizeLocalSearchText(value: string, maxChars: number): string {
  return boundedText(value, maxChars)
    // Split common identifier casing before lower-casing so dotted/snake/camel
    // memory keys remain searchable using the owner's natural-language query.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[._:/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lightlyStemLocalToken(value: string): string {
  // Keep stemming deliberately conservative and ASCII-only. Unicode words
  // remain intact while common plural forms converge without an LLM call.
  if (!/^[a-z0-9]+$/.test(value) || value.length < 4) return value;
  if (value.length > 5 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (
    value.length > 5 &&
    value.endsWith("es") &&
    /(?:s|x|z|ch|sh|o)es$/.test(value)
  ) {
    return value.slice(0, -2);
  }
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  const result = new Set<string>();
  for (let index = 0; index + 2 < padded.length; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}

function diceSimilarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function makeLocalTextProfile(
  value: string,
  maxChars: number,
  maxTokens: number,
): LocalTextProfile {
  const normalized = normalizeLocalSearchText(value, maxChars);
  const values: string[] = [];
  const seen = new Set<string>();
  for (const rawToken of normalized.split(" ")) {
    if (rawToken.length < 2) continue;
    const token = lightlyStemLocalToken(rawToken);
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    values.push(token);
    if (values.length >= maxTokens) break;
  }
  return {
    normalized,
    tokens: values.map((value) => ({
      value,
      trigrams: trigrams(value),
    })),
    tokenValues: seen,
  };
}

function tokenSimilarity(
  left: LocalTokenProfile,
  right: LocalTokenProfile,
): number {
  if (left.value === right.value) return 1;
  const shorter =
    left.value.length <= right.value.length ? left.value : right.value;
  const longer = shorter === left.value ? right.value : left.value;
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    return Math.max(0.82, shorter.length / longer.length);
  }
  return diceSimilarity(left.trigrams, right.trigrams);
}

function localRelevanceScore(
  query: LocalTextProfile,
  document: LocalTextProfile,
): number {
  if (
    !query.normalized ||
    query.tokens.length === 0 ||
    document.tokens.length === 0
  ) {
    return 0;
  }
  if (document.normalized === query.normalized) return 1;
  if (
    query.normalized.length >= 3 &&
    document.normalized.includes(query.normalized)
  ) {
    return 0.98;
  }

  let exactMatches = 0;
  let fuzzyTotal = 0;
  for (const queryToken of query.tokens) {
    if (document.tokenValues.has(queryToken.value)) {
      exactMatches += 1;
      fuzzyTotal += 1;
      continue;
    }
    let best = 0;
    for (const documentToken of document.tokens) {
      const similarity = tokenSimilarity(queryToken, documentToken);
      if (similarity > best) best = similarity;
      if (best >= 0.98) break;
    }
    if (best >= MIN_LOCAL_FUZZY_TOKEN_SCORE) fuzzyTotal += best;
  }

  const exactCoverage = exactMatches / query.tokens.length;
  const fuzzyCoverage = fuzzyTotal / query.tokens.length;
  // Exact coverage is primary; bounded trigram similarity only restores useful
  // typo/prefix recall. It is not allowed to turn weak resemblance into a hit.
  const exactWeighted = exactCoverage * 0.7 + fuzzyCoverage * 0.3;
  const fuzzyWeighted = fuzzyCoverage * (query.tokens.length <= 2 ? 0.9 : 0.66);
  return Math.max(0, Math.min(1, Math.max(exactWeighted, fuzzyWeighted)));
}

/**
 * Rank already-loaded PostgreSQL memory rows without provider I/O. Prompt-time
 * memory retrieval must remain available even when every external LLM account
 * is out of credits, unavailable, or rate limited.
 */
export function rankMemoryCandidatesLocally(
  query: string,
  candidates: readonly MemoryLocalCandidate[],
): Map<string, number> {
  const queryProfile = makeLocalTextProfile(
    query,
    MAX_LOCAL_QUERY_CHARS,
    MAX_LOCAL_QUERY_TOKENS,
  );
  if (!queryProfile.normalized || candidates.length === 0) return new Map();

  const scores = new Map<string, number>();
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const score = localRelevanceScore(
      queryProfile,
      makeLocalTextProfile(
        candidate.text,
        MAX_LOCAL_DOCUMENT_CHARS,
        MAX_LOCAL_DOCUMENT_TOKENS,
      ),
    );
    if (score > 0) scores.set(candidate.id, score);
    if (seen.size >= AGENT_MEMORY_LOCAL_CANDIDATE_LIMIT) break;
  }
  return scores;
}
