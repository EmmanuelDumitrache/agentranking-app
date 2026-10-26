import type {
  AgentOrchestrationState,
  AgentTaskDomain,
  AgentTaskProfile,
  ToolSelectionEntry,
} from "./types";
import {
  REMOTE_SEMANTIC_MIN_SIMILARITY,
  rankCandidatesSemantically,
} from "@/features/agent-chat/server/semantic-ranking";

/**
 * Keep provider tool schemas bounded. The runtime may install hundreds of
 * actions, but only a task-relevant working set needs to be serialized into a
 * model request. Tools used in previous steps are retained so multi-step
 * workflows remain coherent.
 */
export const MAX_ACTIVE_TOOL_COUNT = 5;
const MAX_SEMANTIC_TOOL_CANDIDATES = 48;
const MAX_LEXICAL_SEMANTIC_CANDIDATES = 32;
const SEMANTIC_SCORE_WEIGHT = 80;
const HISTORY_REHYDRATION_INTENT = /\b(?:earlier|previous|prior|before|last\s+time|we\s+(?:said|decided|discussed)|remember|conversation|chat|thread)\b/i;
const CURRENT_THREAD_RETRIEVAL_INTENT = /(?:\b(?:this|our|current)\s+(?:conversation|chat|thread)\b|\b(?:conversation|chat|thread)\s+history\b|\b(?:earlier|previous|prior)\s+(?:message|turn|reply|response)\b|\bwe\s+(?:said|decided|discussed)\b|\byou\s+(?:said|mentioned)\s+(?:earlier|before)\b|\bi\s+(?:said|asked|mentioned)\s+(?:earlier|before)\b)/i;
const PREVIOUS_THREAD_RETRIEVAL_INTENT = /(?:\b(?:previous|prior|last)\s+(?:conversation|chat|thread)\b|\blast\s+time\b|\bwhat\s+did\s+we\s+(?:say|decide|discuss)\b|\bfrom\s+another\s+(?:conversation|chat|thread)\b)/i;
const TOOL_RESULT_RETRIEVAL_INTENT = /(?:\b(?:stored|saved|previous|prior|earlier|old)\s+(?:tool\s+)?(?:result|output|artifact)s?\b|\b(?:tool\s+)?(?:result|output)\s+(?:artifact|history)\b|\bartifact\s+(?:result|output|history)\b)/i;
const ATTACHMENT_RETRIEVAL_INTENT = /\b(?:image|photo|picture|screenshot|attachment|file|document|pdf|spreadsheet|chart|graph|diagram|figure|uploaded\s+(?:image|photo|picture|screenshot|file|document|pdf|spreadsheet|chart|graph|diagram|figure))\b/i;
const DELEGATE_CONTEXT_ANALYSIS_INTENT = /\b(?:analy(?:[sz]e|sis)|investigat(?:e|ion)|compare|correlat(?:e|ion)|summari[sz]e|synthesi[sz]e|review|trace|explain|diagnos(?:e|is)|pattern|aggregate)\b/i;

const STOP_TERMS = new Set([
  "a", "an", "and", "are", "can", "could", "do", "for", "from", "get",
  "have", "i", "in", "is", "it", "me", "my", "of", "on", "please", "show",
  "the", "this", "to", "tool", "tools", "use", "using", "want", "what",
  "which", "with", "you", "your",
]);

const DOMAIN_TERMS: Readonly<Record<AgentTaskDomain, readonly string[]>> = {
  wallet: ["wallet", "account", "address", "public", "key"],
  balance: ["balance", "holdings", "portfolio", "lamports"],
  token: ["token", "mint", "spl", "metadata", "supply", "decimals"],
  market: ["price", "market", "quote", "volume", "trending", "chart"],
  transfer: ["transfer", "send", "recipient", "destination"],
  trade: ["trade", "buy", "sell", "order", "swap", "quote", "jupiter", "raydium", "orca"],
  swap: ["swap", "exchange", "quote", "jupiter", "raydium", "orca"],
  staking: ["stake", "staking", "unstake", "validator", "delegation", "yield", "apr"],
  defi: ["defi", "lend", "borrow", "liquidity", "pool", "deposit", "withdraw", "farm", "yield"],
  nft: ["nft", "collection", "metadata", "asset", "image"],
  launch: ["launch", "deploy", "create", "token", "pump", "memecoin"],
  blink: ["blink", "action", "url"],
  transaction: ["transaction", "tx", "signature", "confirm", "block", "fee"],
  web: ["web", "search", "news", "current", "latest", "lookup"],
  general: [],
};

function normalizeTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !STOP_TERMS.has(term));
}

function entryTerms(entry: ToolSelectionEntry): Set<string> {
  return new Set([
    ...entry.normalizedTerms,
    ...normalizeTerms(entry.name),
    ...normalizeTerms(entry.plugin),
    ...entry.schemaFields.flatMap(normalizeTerms),
  ]);
}

function scoreEntry(params: {
  entry: ToolSelectionEntry;
  queryTerms: readonly string[];
  queryText: string;
  profile: AgentTaskProfile;
  successfulTools: ReadonlySet<string>;
  failedTools: ReadonlySet<string>;
  webTools: ReadonlySet<string>;
}): number {
  const { entry } = params;
  const terms = entryTerms(entry);
  const name = entry.name.toLowerCase();
  const plugin = entry.plugin.toLowerCase();
  let score = 0;

  if (params.successfulTools.has(entry.name)) score += 120;
  if (params.failedTools.has(entry.name)) score -= 24;

  if (params.profile.requiresCurrentWeb && params.webTools.has(entry.name)) {
    score += 200;
  }

  for (const queryTerm of params.queryTerms) {
    if (terms.has(queryTerm)) score += 12;
    if (name.includes(queryTerm)) score += 8;
    if (plugin.includes(queryTerm)) score += 4;
  }

  for (const domain of params.profile.domains) {
    for (const domainTerm of DOMAIN_TERMS[domain]) {
      if (terms.has(domainTerm)) score += 5;
      if (name.includes(domainTerm)) score += 3;
    }
  }

  if (/\bmcp\b|model\s+context\s+protocol/i.test(params.queryText)) {
    if (entry.source === "mcp_server") score += 24;
    if (entry.source === "mcp_runtime") score += 12;
  }

  if (params.profile.stateChangingIntent) {
    const mutationTerms = [
      "send", "transfer", "swap", "trade", "stake", "unstake", "deposit",
      "withdraw", "borrow", "repay", "create", "launch", "mint", "burn",
      "claim", "bridge", "pay", "issue", "cancel",
    ];
    if (mutationTerms.some((term) => terms.has(term) || name.includes(term))) {
      score += 10;
    }
  }

  return score;
}

function semanticDocument(entry: ToolSelectionEntry): string {
  return [
    entry.displayName,
    entry.externalName,
    entry.name,
    entry.plugin,
    entry.serverName,
    entry.description,
    ...entry.similes,
    ...entry.schemaFields,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function semanticCandidateCatalog(params: {
  profile: AgentTaskProfile;
  userText: string;
  catalog: readonly ToolSelectionEntry[];
  availableToolNames: readonly string[];
  state?: Pick<
    AgentOrchestrationState,
    "successfulToolNames" | "failedToolNames"
  >;
  webToolNames?: readonly string[];
}): ToolSelectionEntry[] {
  const available = new Set(params.availableToolNames);
  const queryTerms = normalizeTerms(params.userText);
  const successfulTools = new Set(params.state?.successfulToolNames ?? []);
  const failedTools = new Set(params.state?.failedToolNames ?? []);
  const webTools = new Set(params.webToolNames ?? []);
  const ranked = params.catalog
    .filter((entry) => available.has(entry.name))
    .map((entry) => ({
      entry,
      score: scoreEntry({
        entry,
        queryTerms,
        queryText: params.userText,
        profile: params.profile,
        successfulTools,
        failedTools,
        webTools,
      }),
    }))
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));

  const candidates: ToolSelectionEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: ToolSelectionEntry) => {
    if (seen.has(entry.name) || candidates.length >= MAX_SEMANTIC_TOOL_CANDIDATES) return;
    seen.add(entry.name);
    candidates.push(entry);
  };

  for (const item of ranked) {
    if (item.score <= 0 || candidates.length >= MAX_LEXICAL_SEMANTIC_CANDIDATES) break;
    add(item.entry);
  }

  // Embedding every tool in a very large catalog would move the schema tax to
  // the retrieval layer. Fill the remaining semantic candidate budget with a
  // round-robin sample across plugins/servers so zero-overlap synonyms still
  // have a chance to surface without one huge plugin crowding out the rest.
  const byPlugin = new Map<string, ToolSelectionEntry[]>();
  for (const { entry } of ranked) {
    if (seen.has(entry.name)) continue;
    const group = byPlugin.get(entry.plugin);
    if (group) group.push(entry);
    else byPlugin.set(entry.plugin, [entry]);
  }
  const groups = [...byPlugin.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entries]) => entries);
  let depth = 0;
  while (candidates.length < MAX_SEMANTIC_TOOL_CANDIDATES) {
    let added = false;
    for (const group of groups) {
      const entry = group[depth];
      if (!entry) continue;
      add(entry);
      added = true;
      if (candidates.length >= MAX_SEMANTIC_TOOL_CANDIDATES) break;
    }
    if (!added) break;
    depth += 1;
  }
  return candidates;
}

/**
 * Hybrid semantic supplement for the deterministic selector. This runs at
 * most once per parent run in the main harness and only embeds a bounded
 * candidate set, while the synchronous selector remains a complete fallback.
 */
export async function rankToolCatalogSemantically(params: {
  profile: AgentTaskProfile;
  userText: string;
  catalog: readonly ToolSelectionEntry[];
  availableToolNames: readonly string[];
  state?: Pick<
    AgentOrchestrationState,
    "successfulToolNames" | "failedToolNames"
  >;
  webToolNames?: readonly string[];
  catalogEnumeration?: boolean;
  allowPlatformSemanticRanking: boolean;
}): Promise<ReadonlyMap<string, number>> {
  const userText = params.userText.trim();
  if (
    !userText
    || params.catalogEnumeration
    || params.catalog.length <= MAX_ACTIVE_TOOL_COUNT
  ) {
    return new Map();
  }
  const candidates = semanticCandidateCatalog(params);
  if (candidates.length === 0) return new Map();
  return rankCandidatesSemantically(
    userText,
    candidates.map((entry) => ({
      id: entry.name,
      text: semanticDocument(entry),
    })),
    { allowPlatformEmbeddings: params.allowPlatformSemanticRanking },
  );
}

export function selectActiveToolNames(params: {
  profile: AgentTaskProfile;
  phase?: "DISCOVERY" | "EXECUTION" | "VERIFICATION" | "SYNTHESIS";
  userText: string;
  catalog: readonly ToolSelectionEntry[];
  availableToolNames: readonly string[];
  state?: Pick<
    AgentOrchestrationState,
    "successfulToolNames" | "failedToolNames" | "requestedToolNames" | "materializedToolNames" | "externalizedToolResultCount" | "virtualizedAttachmentCount" | "contextReductionLevel"
  >;
  webToolNames?: readonly string[];
  catalogEnumeration?: boolean;
  inventoryPreloaded?: boolean;
  maxTools?: number;
  semanticScores?: ReadonlyMap<string, number>;
  /** Conservative serialized schema cost per runtime tool. */
  schemaTokenCosts?: ReadonlyMap<string, number>;
  /** Soft aggregate schema ceiling; required/retrieval tools may exceed it. */
  maxSchemaTokens?: number;
}): string[] {
  const available = new Set(params.availableToolNames);
  if (available.size === 0) return [];

  const maxTools = Math.max(
    1,
    Math.min(MAX_ACTIVE_TOOL_COUNT, Math.trunc(params.maxTools ?? MAX_ACTIVE_TOOL_COUNT)),
  );
  const selected = new Set<string>();
  const queryTerms = normalizeTerms(params.userText);
  const successfulTools = new Set(params.state?.successfulToolNames ?? []);
  const failedTools = new Set(params.state?.failedToolNames ?? []);
  const webTools = new Set(params.webToolNames ?? []);
  const maxSchemaTokens = params.maxSchemaTokens == null
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.trunc(params.maxSchemaTokens));
  let selectedSchemaTokens = 0;
  const add = (name: string, required = false) => {
    if (!available.has(name) || selected.has(name) || selected.size >= maxTools) return;
    const schemaTokens = Math.max(0, params.schemaTokenCosts?.get(name) ?? 0);
    // Component budgets are soft, not capability-denial boundaries. Explicitly
    // requested tools, current-web evidence, and context rehydration must remain
    // reachable even when one schema is unusually large; heuristic additions
    // are the part that gets dropped first. The final model-window compiler is
    // still the hard safety invariant.
    if (!required && selected.size > 0 && selectedSchemaTokens + schemaTokens > maxSchemaTokens) {
      return;
    }
    selected.add(name);
    selectedSchemaTokens += schemaTokens;
  };
  const addCanonicalContextReaders = () => {
    if ((params.state?.externalizedToolResultCount ?? 0) > 0) {
      add("read_tool_result", true);
    }
    if (
      (params.state?.contextReductionLevel ?? 0) >= 4
      || (
        CURRENT_THREAD_RETRIEVAL_INTENT.test(params.userText)
        && !PREVIOUS_THREAD_RETRIEVAL_INTENT.test(params.userText)
      )
    ) {
      // A projected/compacted transcript must remain losslessly reopenable even
      // when the user's follow-up is an implicit reference ("what address was
      // that?"). Explicit current-thread history requests also get the reader
      // directly; previous-thread requests preserve progressive disclosure by
      // searching thread summaries first and materializing the reader next.
      add("read_conversation_history", true);
    }
    const attachmentIntent = ATTACHMENT_RETRIEVAL_INTENT.test(params.userText)
      || params.profile.requiresVision
      || ((params.state?.virtualizedAttachmentCount ?? 0) > 0
        && HISTORY_REHYDRATION_INTENT.test(params.userText));
    if (
      attachmentIntent
      && (params.state?.virtualizedAttachmentCount ?? 0) > 0
    ) {
      // Virtualized files are cheap dormant pointers, not a reason to pay a
      // multimodal/file reader schema on every unrelated turn. Materialize the
      // reader only when this working set already contains a direct attachment
      // reference and the task needs attachment evidence. If the source lives
      // outside the loaded history window, read_conversation_history discovers
      // the reference first and requests this schema on the following step.
      add("read_conversation_attachment", true);
    }
  };
  const addContextSearchAndDelegateTools = () => {
    if (
      PREVIOUS_THREAD_RETRIEVAL_INTENT.test(params.userText)
      && !(params.state?.successfulToolNames ?? []).includes("read_conversation_history")
    ) {
      add("search_previous_threads", true);
    }
    if (
      TOOL_RESULT_RETRIEVAL_INTENT.test(params.userText)
      && !(params.state?.successfulToolNames ?? []).includes("read_tool_result")
    ) {
      add("search_tool_results", true);
    }
    if (
      params.profile.complexity === "high"
      && (
        ((params.state?.externalizedToolResultCount ?? 0) > 0
          && DELEGATE_CONTEXT_ANALYSIS_INTENT.test(params.userText))
        || ((params.state?.contextReductionLevel ?? 0) >= 4
          && HISTORY_REHYDRATION_INTENT.test(params.userText))
      )
    ) {
      add("delegate_context_analysis");
    }
  };

  // Synthesis normally drops concrete operational schemas, but canonical
  // context retrieval is different: it does not broaden what the agent can do,
  // it only lets the model inspect evidence that the context compiler already
  // virtualized. History-only user requests likewise need retrieval even when
  // task profiling correctly says no external/action tool is required.
  // Current-web evidence is a hard task requirement and must not be crowded
  // out by several schemas returned from a prior deferred-search result.
  let preferredWebToolName: string | null = null;
  if (params.phase !== "SYNTHESIS" && params.profile.requiresCurrentWeb && webTools.size > 0) {
    // Current evidence needs one reliable web primitive, not every schema that
    // happens to implement search. Rank candidates using the same task signal
    // as the rest of the selector, guarantee only the best one, and leave
    // room for context rehydration/runtime discovery. A failed web tool is
    // naturally deprioritized on the next step so another candidate can take
    // over without keeping both schemas resident.
    const rankedWeb = params.catalog
      .filter((entry) => available.has(entry.name) && webTools.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        score:
          scoreEntry({
            entry,
            queryTerms,
            queryText: params.userText,
            profile: params.profile,
            successfulTools,
            failedTools,
            webTools,
          })
          + Math.round((params.semanticScores?.get(entry.name) ?? 0) * SEMANTIC_SCORE_WEIGHT),
      }))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    preferredWebToolName = rankedWeb[0]?.name ?? [...webTools].sort()[0] ?? null;
    if (preferredWebToolName) add(preferredWebToolName, true);
  }

  // Deferred discovery results are relevance-ordered materialization hints, not
  // a command to serialize every returned schema. Guarantee only the best hit
  // before reserving canonical rehydration and the lightweight discovery
  // escape hatch; otherwise four secondary search hits can consume the five-
  // schema working set and make already-externalized evidence unreachable.
  const requestedToolNames = params.state?.requestedToolNames ?? [];
  const primaryRequestedTool = requestedToolNames.find((name) => available.has(name)) ?? null;
  if (primaryRequestedTool) add(primaryRequestedTool, true);
  addCanonicalContextReaders();
  const needsDeferredDiscovery =
    params.catalog.length > maxTools
    && params.profile.requiresTools
    && !(params.catalogEnumeration && params.inventoryPreloaded);
  if (needsDeferredDiscovery) add("runtime_tool_search", true);
  addContextSearchAndDelegateTools();
  for (const name of requestedToolNames) {
    if (name !== primaryRequestedTool) add(name);
  }
  // Catalog questions are answered from the authoritative preloaded inventory;
  // concrete operational schemas would defeat deferred discovery. Preserve
  // only any independently required context-retrieval schemas for compound
  // requests such as "which tool did we use in the previous thread?".
  if (
    (params.catalogEnumeration && params.inventoryPreloaded)
    || params.phase === "SYNTHESIS"
    || !params.profile.requiresTools
  ) {
    return [...selected].sort();
  }

  const scored = params.catalog
    .filter((entry) => available.has(entry.name))
    // One current-web schema is sufficient at a time. Keep alternatives out
    // of the resident set until the chosen web primitive fails or is replaced
    // on a later step, avoiding duplicate schema tax for equivalent evidence.
    .filter((entry) => !(
      params.profile.requiresCurrentWeb
      && preferredWebToolName != null
      && webTools.has(entry.name)
      && entry.name !== preferredWebToolName
    ))
    .map((entry) => ({
      name: entry.name,
      score:
        scoreEntry({
          entry,
          queryTerms,
          queryText: params.userText,
          profile: params.profile,
          successfulTools,
          failedTools,
          webTools,
        })
        + ((params.semanticScores?.get(entry.name) ?? -1) >= REMOTE_SEMANTIC_MIN_SIMILARITY
          ? Math.round((params.semanticScores?.get(entry.name) ?? 0) * SEMANTIC_SCORE_WEIGHT)
          : 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  // Context-retrieval tools were already added above before operational-tool
  // gating so they remain available in synthesis/history-only turns.
  // Keep only the most recent tools involved in the loop. Older observations
  // remain retrievable from canonical history/artifacts and do not justify a
  // permanent schema reservation.
  for (const name of (params.state?.successfulToolNames ?? []).slice(-2)) add(name);
  for (const name of (params.state?.failedToolNames ?? []).slice(-1)) add(name);

  // Once a concrete schema has been materialized, prefer keeping that bounded
  // working set stable across subsequent execution steps. This preserves the
  // provider's exact tool-definition prefix unless runtime discovery, web
  // requirements, rehydration, or recent execution evidence gives us a reason
  // to replace it. The lightweight search primitive is re-added above as the
  // large-catalog escape hatch on every operational phase.
  for (const name of params.state?.materializedToolNames ?? []) {
    if (
      params.phase !== "DISCOVERY"
      && name === "runtime_tool_search"
    ) {
      continue;
    }
    add(name);
  }

  for (const entry of scored) add(entry.name);

  if (selected.size === 0) {
    const fallback = params.catalog
      .filter((entry) => available.has(entry.name))
      .sort((left, right) => {
        const sourceRank = (entry: ToolSelectionEntry) =>
          entry.source === "provider" ? 0
            : entry.plugin === "runtime-context" ? 1
              : entry.source === "mcp_runtime" ? 2
                : entry.source === "local" ? 3
                  : 4;
        return sourceRank(left) - sourceRank(right) || left.name.localeCompare(right.name);
      });
    const fallbackCount = Math.min(maxTools, params.profile.complexity === "high" ? 3 : 2);
    for (const entry of fallback.slice(0, fallbackCount)) add(entry.name);
  }

  return [...selected].sort();
}
