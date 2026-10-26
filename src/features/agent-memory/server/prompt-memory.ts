import "server-only";
import { prisma } from "@/lib/db";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import type { AgentMemoryPromptFact } from "../shared/types";
import {
  AGENT_MEMORY_MAX_LIVE_FACTS,
  AGENT_MEMORY_MAX_PROMPT_CHARS,
  AGENT_MEMORY_MAX_PROMPT_FACTS,
} from "../shared/types";
import { readAgentMemorySettings } from "./repository";
import {
  AGENT_MEMORY_MIN_LOCAL_RELEVANCE,
  AGENT_MEMORY_LOCAL_CANDIDATE_LIMIT,
  rankMemoryCandidatesLocally,
} from "./local-ranking";

const MAX_NONRELEVANT_FALLBACK_FACTS = 3;

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFKC")
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  );
}

function lexicalRelevance(
  queryTerms: Set<string>,
  key: string,
  content: string,
): number {
  if (queryTerms.size === 0) return 0;
  const candidate = terms(`${key.replace(/[._:-]+/g, " ")} ${content}`);
  let overlap = 0;
  for (const term of queryTerms) {
    if (candidate.has(term)) overlap += 1;
  }
  return overlap / Math.max(1, queryTerms.size);
}

function recencyScore(lastConfirmedAt: Date): number {
  const ageDays = Math.max(0, (Date.now() - lastConfirmedAt.getTime()) / 86_400_000);
  return 1 / (1 + ageDays / 90);
}

/**
 * Load durable memory from PostgreSQL and rank it entirely in-process. Prompt
 * construction must not depend on an embedding/model provider being funded or
 * available.
 */
export async function loadActiveMemoryFactsForPrompt(
  agentDbId: number,
  appAccountId: string,
  query: string,
): Promise<AgentMemoryPromptFact[]> {
  const settings = await readAgentMemorySettings(prisma, agentDbId, appAccountId);
  if (!settings.enabled) return [];

  const now = new Date();
  const rows = await prisma.agentMemoryFact.findMany({
    where: {
      agentDbId,
      appAccountId,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ lastConfirmedAt: "desc" }, { id: "desc" }],
    take: AGENT_MEMORY_MAX_LIVE_FACTS,
    select: {
      id: true,
      key: true,
      kind: true,
      content: true,
      confidence: true,
      salience: true,
      pinned: true,
      lastConfirmedAt: true,
    },
  });

  const retrievalQuery = redactSensitiveText(query);
  const queryTerms = terms(retrievalQuery);
  const candidates = rows.map((row) => {
    const relevance = lexicalRelevance(queryTerms, row.key, row.content);
    const alwaysRelevant = row.pinned || row.kind === "profile";
    const qualityScore =
      row.confidence * 1.25 +
      row.salience * 1.5 +
      recencyScore(row.lastConfirmedAt) * 0.75;
    return { row, relevance, alwaysRelevant, qualityScore };
  });

  const localCandidates = candidates
    .filter((entry) => !entry.alwaysRelevant)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        b.qualityScore - a.qualityScore ||
        b.row.lastConfirmedAt.getTime() - a.row.lastConfirmedAt.getTime(),
    )
    .slice(0, AGENT_MEMORY_LOCAL_CANDIDATE_LIMIT)
    .map((entry) => ({
      id: entry.row.id,
      text: `${entry.row.key.replace(/[._:-]+/g, " ")} ${entry.row.content}`,
    }));
  const localRelevanceScores =
    queryTerms.size > 0
      ? rankMemoryCandidatesLocally(retrievalQuery, localCandidates)
      : new Map<string, number>();

  const ranked = candidates
    .map((entry) => {
      const localSimilarity = localRelevanceScores.get(entry.row.id);
      const score =
        (entry.row.pinned ? 6 : 0) +
        (entry.row.kind === "profile" ? 3 : 0) +
        entry.relevance * 5 +
        Math.max(0, localSimilarity ?? 0) * 5 +
        entry.qualityScore;
      return { ...entry, score, localSimilarity };
    })
    .filter(
      (entry) =>
        entry.alwaysRelevant ||
        queryTerms.size === 0 ||
        entry.relevance > 0 ||
        (entry.localSimilarity ?? -1) >= AGENT_MEMORY_MIN_LOCAL_RELEVANCE,
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.lastConfirmedAt.getTime() - a.row.lastConfirmedAt.getTime(),
    );

  // Keep a tiny high-quality fallback for vocabulary mismatch rather than
  // filling the prompt budget with unrelated memories. Retrieval and ranking
  // stay entirely local; this fallback is about recall, not provider failure.
  const selectedIds = new Set(ranked.map((entry) => entry.row.id));
  if (queryTerms.size > 0 && ranked.length < AGENT_MEMORY_MAX_PROMPT_FACTS) {
    const fallback = candidates
      .filter((entry) => !selectedIds.has(entry.row.id))
      .sort(
        (a, b) =>
          b.qualityScore - a.qualityScore ||
          b.row.lastConfirmedAt.getTime() - a.row.lastConfirmedAt.getTime(),
      );
    for (const entry of fallback.slice(0, MAX_NONRELEVANT_FALLBACK_FACTS)) {
      ranked.push({
        ...entry,
        score: entry.qualityScore,
        localSimilarity: undefined,
      });
    }
  }

  const facts: AgentMemoryPromptFact[] = [];
  let remainingChars = AGENT_MEMORY_MAX_PROMPT_CHARS;
  for (const entry of ranked) {
    if (facts.length >= AGENT_MEMORY_MAX_PROMPT_FACTS) break;
    const cost = entry.row.content.length + entry.row.key.length + 12;
    if (cost > remainingChars) continue;
    facts.push({
      id: entry.row.id,
      key: entry.row.key,
      kind: entry.row.kind,
      content: entry.row.content,
    });
    remainingChars -= cost;
  }

  if (facts.length > 0) {
    await prisma.agentMemoryFact.updateMany({
      where: {
        agentDbId,
        appAccountId,
        id: { in: facts.map((fact) => fact.id) },
      },
      data: { lastUsedAt: now },
    });
  }
  return facts;
}
