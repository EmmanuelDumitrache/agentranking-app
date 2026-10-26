import "server-only";

import { pruneMessages, type ModelMessage, type ToolSet } from "ai";
import { getToolEffect } from "../tools/tool-effects";
import {
  isContextRetrievalToolName,
  resolveToolContextPolicy,
  toolAppearsStateChanging,
  toolResultAppearsError,
} from "../tools/tool-context-policy";
import {
  estimateJsonTokens,
  estimateModelMessagesTokens,
  estimateToolOutputTokens,
  projectMessagesToBudget,
} from "./token-budget";
import {
  allocateMessageContextBudgets,
  boundContextText,
  historicalWorkingTurnLimit,
  type ContextComponentBudgets,
} from "./context-budget";
import {
  REMOTE_SEMANTIC_MIN_SIMILARITY,
  rankCandidatesSemantically,
} from "@/features/agent-chat/server/semantic-ranking";
import { compactContextRetrievalResult } from "../tools/context-retrieval-projection";
import { searchableContextJson } from "../context-search-text";

const PROTECTED_RECENT_USER_TURNS = 3;
const MAX_STALE_INLINE_TOOL_INPUT_TOKENS = 1_500;
const TARGET_UTILIZATION = 0.82;
const SEMANTIC_HISTORY_CANDIDATE_LIMIT = 48;
const STALE_DISTILL_MIN_TOKENS = 6_000;
const HISTORY_QUERY_STOP_TERMS = new Set([
  "about", "after", "again", "also", "and", "are", "assistant", "can",
  "content", "could", "from", "have", "into", "message", "parts", "please",
  "role", "show", "text", "that", "the", "this", "tool", "type", "user",
  "what", "when", "where", "which", "with", "would", "you", "your",
]);

export type ContextCompilerResult = {
  messages: ModelMessage[];
  reductionLevel: number;
};

export type ContextCompilerExternalizer = (params: {
  toolCallId: string;
  toolName: string;
  output: unknown;
  stateChanging: boolean;
  policy: ReturnType<typeof resolveToolContextPolicy>;
}) => Promise<{ modelOutput: unknown }>;

function unwrapToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const candidate = output as { type?: unknown; value?: unknown };
  if (
    (candidate.type === "json"
      || candidate.type === "text"
      || candidate.type === "error-json"
      || candidate.type === "error-text")
    && "value" in candidate
  ) {
    return candidate.value;
  }
  return output;
}

function rewrapToolOutput(original: unknown, value: unknown): unknown {
  if (!original || typeof original !== "object" || Array.isArray(original)) return value;
  const candidate = original as { type?: unknown; value?: unknown };
  if (!("value" in candidate)) return value;
  if (candidate.type === "text" || candidate.type === "error-text") {
    return {
      ...candidate,
      value: typeof value === "string" ? value : JSON.stringify(value),
    };
  }
  if (candidate.type === "json" || candidate.type === "error-json") {
    return { ...candidate, value };
  }
  return value;
}

function alreadyVirtualized(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { artifactId?: unknown; status?: unknown };
  return typeof candidate.artifactId === "string"
    && (candidate.status === "externalized" || candidate.status === "externalized_error");
}

async function virtualizeOversizedToolOutputs(params: {
  messages: ModelMessage[];
  tools: ToolSet;
  externalize?: ContextCompilerExternalizer;
  forceStale?: boolean;
  protectedRecentTokens?: number;
}): Promise<ModelMessage[]> {
  if (!params.externalize) return params.messages;
  const totalToolResultsByName = new Map<string, number>();
  for (const message of params.messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; toolName?: unknown };
      if (part.type !== "tool-result" || typeof part.toolName !== "string") continue;
      totalToolResultsByName.set(
        part.toolName,
        (totalToolResultsByName.get(part.toolName) ?? 0) + 1,
      );
    }
  }
  const toolResultIndexByName = new Map<string, number>();
  const protectedStart = params.forceStale
    ? protectedRecentStartIndex(
        params.messages,
        Math.max(1, params.protectedRecentTokens ?? 1),
      )
    : -1;
  const output: ModelMessage[] = [];
  for (const [messageIndex, message] of params.messages.entries()) {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      output.push(message);
      continue;
    }
    const parts: unknown[] = [];
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) {
        parts.push(rawPart);
        continue;
      }
      const part = rawPart as {
        type?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        output?: unknown;
      };
      if (
        part.type !== "tool-result"
        || typeof part.toolCallId !== "string"
        || typeof part.toolName !== "string"
      ) {
        parts.push(rawPart);
        continue;
      }
      const rawOutput = unwrapToolOutput(part.output);
      const resultIndex = toolResultIndexByName.get(part.toolName) ?? 0;
      toolResultIndexByName.set(part.toolName, resultIndex + 1);
      if (alreadyVirtualized(rawOutput)) {
        parts.push(rawPart);
        continue;
      }
      const tool = params.tools[part.toolName];
      const declaredStateChanging = getToolEffect(tool)?.stateChanging;
      const stateChanging = toolAppearsStateChanging({
        toolName: part.toolName,
        tool,
        stateChanging: declaredStateChanging,
      });
      const policy = resolveToolContextPolicy({
        toolName: part.toolName,
        tool,
        stateChanging,
      });
      const totalForTool = totalToolResultsByName.get(part.toolName) ?? 1;
      const retainedTurns = Math.max(1, Math.trunc(policy.retainedTurns));
      const stale = params.forceStale === true
        && (
          messageIndex < protectedStart
          || resultIndex < Math.max(0, totalForTool - retainedTurns)
        );
      const outputTokens = estimateToolOutputTokens(rawOutput);
      if (!stale && outputTokens <= policy.inlineTokenLimit) {
        parts.push(rawPart);
        continue;
      }
      if (isContextRetrievalToolName(part.toolName)) {
        // These tools are views over canonical artifacts/history. Creating a new
        // artifact from a rehydrated view produces an artifact-of-artifact chain
        // without preserving any additional information. Keep the current read
        // visible while it is useful; once stale or unexpectedly oversized,
        // collapse it back to source identifiers so the exact source can be
        // re-read directly.
        parts.push({
          ...part,
          output: rewrapToolOutput(
            part.output,
            stale
              ? compactContextRetrievalResult(part.toolName, rawOutput)
              : headTailValue(rawOutput, Math.max(2_000, policy.inlineTokenLimit * 4)),
          ),
        });
        continue;
      }
      const staleNeedsExactEvidence = stateChanging || toolResultAppearsError(rawOutput);
      const staleStrategy = staleNeedsExactEvidence
        ? "externalize" as const
        : outputTokens >= STALE_DISTILL_MIN_TOKENS
          ? "distill" as const
          : "structured-preview" as const;
      const projectionPolicy = stale
        ? {
            ...policy,
            strategy: staleStrategy,
            inlineTokenLimit: 1,
            preserveOnError: false,
            preserveIfStateChanging: false,
          }
        : policy;
      try {
        const projected = await params.externalize({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: rawOutput,
          stateChanging,
          policy: projectionPolicy,
        });
        parts.push({
          ...part,
          output: rewrapToolOutput(part.output, projected.modelOutput),
        });
      } catch {
        // Context compilation must never turn an already-successful provider
        // tool execution into a failed agent step. Later reduction stages may
        // bound ordinary read-only output if storage fails, but mutation/error
        // evidence remains intact and can force a local context-too-large error.
        parts.push(rawPart);
      }
    }
    output.push({ ...message, content: parts } as ModelMessage);
  }
  return output;
}

function stringifyMessage(message: ModelMessage): string {
  return searchableContextJson(message, 24_000).toLowerCase();
}

function userMessageSearchText(message: ModelMessage): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const values: string[] = [];
  for (const rawPart of content as unknown[]) {
    if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
    const part = rawPart as Record<string, unknown>;
    if (typeof part.text === "string") values.push(part.text);
    if (typeof part.filename === "string") values.push(part.filename);
    if (typeof part.url === "string" && !/^data:/i.test(part.url)) values.push(part.url);
  }
  return values.join("\n").trim();
}

function currentQueryText(messages: readonly ModelMessage[]): string {
  const newestUser = [...messages].reverse().find((message) => message.role === "user");
  return newestUser ? userMessageSearchText(newestUser) : "";
}

function queryTerms(queryText: string): string[] {
  const query = queryText.toLowerCase().trim();
  if (!query) return [];
  return [...new Set(
    query
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3 && !HISTORY_QUERY_STOP_TERMS.has(term))
      .slice(0, 64),
  )];
}

type MessageGroup = {
  messages: ModelMessage[];
  userTurn: boolean;
  index: number;
};

function protectedTurnIndexes(
  turns: readonly MessageGroup[],
  protectedTokenTarget: number,
): Set<number> {
  const protectedTurns = new Set<number>();
  let protectedTokens = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const group = turns[index]!;
    protectedTurns.add(group.index);
    protectedTokens += estimateModelMessagesTokens(group.messages);
    if (
      protectedTurns.size >= PROTECTED_RECENT_USER_TURNS
      && protectedTokens >= protectedTokenTarget
    ) break;
  }
  return protectedTurns;
}

function historicalWorkingSetTokens(
  messages: readonly ModelMessage[],
  protectedTokenTarget: number,
): number {
  const turns = groupMessages(messages).filter((group) => group.userTurn);
  if (turns.length <= PROTECTED_RECENT_USER_TURNS) return 0;
  const protectedTurns = protectedTurnIndexes(turns, protectedTokenTarget);
  return turns
    .filter((group) => !protectedTurns.has(group.index))
    .reduce((sum, group) => sum + estimateModelMessagesTokens(group.messages), 0);
}

function boundInjectedSystemContext(
  messages: readonly ModelMessage[],
  budgets: Pick<ContextComponentBudgets, "conversationSummary" | "workingState">,
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "system") return message;
    const content = (message as unknown as { content?: unknown }).content;
    if (typeof content !== "string") return message;
    const trimmed = content.trimStart();
    const maxTokens = trimmed.startsWith("Conversation context summary from earlier messages.")
      ? budgets.conversationSummary
      : trimmed.startsWith("Structured working state for this thread.")
        ? budgets.workingState
        : null;
    if (maxTokens == null) return message;
    const bounded = boundContextText(content, maxTokens);
    return bounded === content ? message : ({ ...message, content: bounded } as ModelMessage);
  });
}

function groupMessages(messages: readonly ModelMessage[]): MessageGroup[] {
  const prefix: ModelMessage[] = [];
  const groups: MessageGroup[] = [];
  let current: ModelMessage[] | null = null;
  for (const message of messages) {
    if (message.role === "system" && groups.length === 0 && current === null) {
      prefix.push(message);
      continue;
    }
    if (message.role === "user") {
      if (current) groups.push({ messages: current, userTurn: true, index: groups.length });
      current = [message];
      continue;
    }
    if (current) current.push(message);
    else prefix.push(message);
  }
  if (current) groups.push({ messages: current, userTurn: true, index: groups.length });
  return prefix.length > 0
    ? [{ messages: prefix, userTurn: false, index: -1 }, ...groups]
    : groups;
}

function evidenceRetentionScore(group: MessageGroup): number {
  const text = group.messages.map(stringifyMessage).join(" ");
  let score = 0;
  if (/\bartifactid\b|\bexternalized(?:_error)?\b/.test(text)) score += 4;
  if (/\bstatechanging\b[^}]{0,80}\btrue\b/.test(text)) score += 8;
  if (/\b(?:error|failed|failure|rejected|timed_out|cancelled)\b/.test(text)) score += 5;
  if (/\b(?:signature|transaction|txhash|receipt|approvalid|orderid)\b/.test(text)) score += 4;
  return score;
}

async function relevanceSelect(
  messages: ModelMessage[],
  budgets: {
    maxTotalTokens: number;
    recentProtectedTokens: number;
    historicalWorkingSetTokens: number;
    maxRetainedUserTurns: number;
    relevanceQuery?: string;
    allowPlatformSemanticRanking: boolean;
  },
): Promise<ModelMessage[]> {
  const maxTokens = Math.max(1, Math.trunc(budgets.maxTotalTokens));
  const currentHistoricalTokens = historicalWorkingSetTokens(
    messages,
    budgets.recentProtectedTokens,
  );
  const currentUserTurns = groupMessages(messages).filter((group) => group.userTurn).length;
  if (
    estimateModelMessagesTokens(messages) <= maxTokens
    && currentHistoricalTokens <= budgets.historicalWorkingSetTokens
    && currentUserTurns <= budgets.maxRetainedUserTurns
  ) return messages;
  const groups = groupMessages(messages);
  const prefix = groups.filter((group) => !group.userTurn);
  const turns = groups.filter((group) => group.userTurn);
  if (turns.length <= PROTECTED_RECENT_USER_TURNS) return messages;
  const relevanceQuery = budgets.relevanceQuery?.trim() || currentQueryText(messages);
  const terms = queryTerms(relevanceQuery);
  const protectedTurns = protectedTurnIndexes(
    turns,
    Math.min(maxTokens, Math.max(1, budgets.recentProtectedTokens)),
  );
  const lexicalRanked = turns
    .filter((group) => !protectedTurns.has(group.index))
    .map((group) => {
      const text = group.messages.map(stringifyMessage).join(" ");
      let score = 0;
      for (const term of terms) if (text.includes(term)) score += 1;
      return {
        group,
        text,
        lexicalScore: score,
        evidenceScore: evidenceRetentionScore(group),
      };
    })
    .sort((left, right) =>
      (right.lexicalScore + right.evidenceScore) - (left.lexicalScore + left.evidenceScore)
      || right.group.index - left.group.index,
    );

  // Give semantic retrieval both the strongest lexical/evidence candidates and
  // a bounded stratified sample across older history. Without the latter, a
  // synonym-only match deep in a long conversation can never enter the
  // embedding candidate set because zero-overlap turns are otherwise ordered
  // almost entirely by recency.
  const semanticCandidates = lexicalRanked.slice(0, 32);
  const semanticCandidateIndexes = new Set(
    semanticCandidates.map((entry) => entry.group.index),
  );
  const remaining = lexicalRanked.filter(
    (entry) => !semanticCandidateIndexes.has(entry.group.index),
  );
  const semanticSlots = SEMANTIC_HISTORY_CANDIDATE_LIMIT - semanticCandidates.length;
  if (semanticSlots > 0 && remaining.length > 0) {
    for (let slot = 0; slot < semanticSlots; slot += 1) {
      const index = Math.min(
        remaining.length - 1,
        Math.floor((slot * remaining.length) / semanticSlots),
      );
      const entry = remaining[index];
      if (!entry || semanticCandidateIndexes.has(entry.group.index)) continue;
      semanticCandidateIndexes.add(entry.group.index);
      semanticCandidates.push(entry);
    }
  }
  const semanticScores = await rankCandidatesSemantically(
    relevanceQuery,
    semanticCandidates.map((entry) => ({
      id: String(entry.group.index),
      text: entry.text,
    })),
    { allowPlatformEmbeddings: budgets.allowPlatformSemanticRanking },
  );
  const ranked = lexicalRanked
    .map((entry) => ({
      ...entry,
      score:
        entry.lexicalScore * 5
        + entry.evidenceScore
        + ((semanticScores.get(String(entry.group.index)) ?? -1)
            >= REMOTE_SEMANTIC_MIN_SIMILARITY
          ? Math.max(0, semanticScores.get(String(entry.group.index)) ?? 0) * 25
          : 0)
        + Math.min(3, entry.group.index / Math.max(1, turns.length)),
    }))
    .sort((left, right) => right.score - left.score || right.group.index - left.group.index);

  const selected = new Set<number>(protectedTurns);
  const fixed = [...prefix.flatMap((group) => group.messages), ...turns
    .filter((group) => protectedTurns.has(group.index))
    .flatMap((group) => group.messages)];
  let totalUsed = estimateModelMessagesTokens(fixed);
  let historicalUsed = 0;
  let historicalTurnsUsed = 0;
  const historicalBudget = Math.max(0, Math.trunc(budgets.historicalWorkingSetTokens));
  const historicalTurnBudget = Math.max(
    0,
    Math.trunc(budgets.maxRetainedUserTurns) - protectedTurns.size,
  );
  for (const { group } of ranked) {
    if (historicalTurnsUsed >= historicalTurnBudget) break;
    const cost = estimateModelMessagesTokens(group.messages);
    if (historicalUsed + cost > historicalBudget) continue;
    if (totalUsed + cost > maxTokens) continue;
    selected.add(group.index);
    historicalUsed += cost;
    historicalTurnsUsed += 1;
    totalUsed += cost;
  }
  return [
    ...prefix.flatMap((group) => group.messages),
    ...turns
      .filter((group) => selected.has(group.index))
      .sort((a, b) => a.index - b.index)
      .flatMap((group) => group.messages),
  ];
}

function protectedRecentStartIndex(
  messages: readonly ModelMessage[],
  protectedTokenTarget: number,
): number {
  let userTurns = 0;
  let protectedTokens = 0;
  let protectedStart = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    protectedTokens += estimateModelMessagesTokens([message]);
    if (message.role === "user") {
      userTurns += 1;
      protectedStart = index;
    }
    if (
      userTurns >= PROTECTED_RECENT_USER_TURNS
      && protectedTokens >= protectedTokenTarget
    ) break;
  }
  return protectedStart;
}

function toolCallInputTokens(messages: readonly ModelMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; input?: unknown };
      if (part.type !== "tool-call") continue;
      tokens += estimateJsonTokens(part.input);
    }
  }
  return tokens;
}

function isVirtualizedToolCallInput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as { contextVirtualizedToolInput?: unknown }).contextVirtualizedToolInput === true;
}

function staleToolCallInputsNeedMasking(
  messages: readonly ModelMessage[],
  maxToolInputTokens: number,
  protectedRecentTokens: number,
): boolean {
  if (toolCallInputTokens(messages) > maxToolInputTokens) return true;
  const protectedStart = protectedRecentStartIndex(messages, protectedRecentTokens);
  for (let messageIndex = 0; messageIndex < protectedStart; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; input?: unknown };
      if (
        part.type === "tool-call"
        && !isVirtualizedToolCallInput(part.input)
        && estimateJsonTokens(part.input) > MAX_STALE_INLINE_TOOL_INPUT_TOKENS
      ) {
        return true;
      }
    }
  }
  return false;
}

function compactToolCallInput(params: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  tool?: ToolSet[string];
}): unknown {
  if (isVirtualizedToolCallInput(params.input)) return params.input;
  const estimatedTokens = estimateJsonTokens(params.input);
  const stateChanging = toolAppearsStateChanging({
    toolName: params.toolName,
    tool: params.tool,
  });
  const previewChars = stateChanging ? 1_800 : 1_000;
  return {
    contextVirtualizedToolInput: true,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    estimatedTokens,
    stateChanging,
    preview: searchableContextJson(params.input, previewChars),
    retrieval: {
      readTool: "read_conversation_history",
      query: params.toolCallId,
      instruction: [
        "The exact historical tool-call input remains in canonical conversation history.",
        "Search read_conversation_history by toolCallId, then page the returned message by messageId/offset if exact omitted arguments are needed.",
      ].join(" "),
    },
  };
}

/**
 * Tool arguments are part of the assistant trajectory and can be as large as
 * the corresponding result (for example bulk MCP queries, file bodies, or
 * transaction payloads). Once a call is outside the protected recent window,
 * treat those arguments as a model working-set cache: retain a small semantic
 * preview plus the stable toolCallId and reopen the exact canonical assistant
 * message only when needed. This avoids creating a second artifact store for
 * data that is already durable in conversation history.
 */
function maskStaleToolCallInputs(
  messages: ModelMessage[],
  tools: ToolSet,
  maxToolInputTokens: number,
  protectedRecentTokens: number,
): ModelMessage[] {
  let used = toolCallInputTokens(messages);
  const protectedStart = protectedRecentStartIndex(messages, protectedRecentTokens);
  const output = [...messages];
  for (let messageIndex = 0; messageIndex < protectedStart; messageIndex += 1) {
    const message = output[messageIndex];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    let changed = false;
    const content = (message.content as unknown[]).map((rawPart) => {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
      const part = rawPart as {
        type?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        input?: unknown;
      };
      if (
        part.type !== "tool-call"
        || typeof part.toolCallId !== "string"
        || typeof part.toolName !== "string"
        || isVirtualizedToolCallInput(part.input)
      ) {
        return rawPart;
      }
      const before = estimateJsonTokens(part.input);
      // Keep ordinary small arguments verbatim. A stale argument is projected
      // when the aggregate component is over budget or the individual call is
      // itself large enough to become a recurring prompt tax.
      if (
        used <= maxToolInputTokens
        && before <= MAX_STALE_INLINE_TOOL_INPUT_TOKENS
      ) return rawPart;
      const input = compactToolCallInput({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        tool: tools[part.toolName],
      });
      const after = estimateJsonTokens(input);
      if (after >= before) return rawPart;
      used -= before - after;
      changed = true;
      return { ...part, input };
    });
    if (changed) output[messageIndex] = { ...message, content } as ModelMessage;
    // Continue through the stale region even after the aggregate budget is met:
    // a later individual call may still exceed the per-call inline ceiling.
  }
  return output;
}

function compactVirtualizedProjection(value: unknown): unknown {
  if (!alreadyVirtualized(value)) return value;
  const record = value as Record<string, unknown>;
  const stateChanging = record.stateChanging === true;
  const status = typeof record.status === "string" ? record.status : "externalized";
  const error = status === "externalized_error" || record.ok === false;
  const digest = typeof record.digest === "string"
    ? headTailValue(record.digest, 2_000)
    : undefined;
  const important = record.important === undefined
    ? undefined
    : headTailValue(record.important, 2_500);
  return {
    ok: error ? false : true,
    status,
    toolName: record.toolName,
    artifactId: record.artifactId,
    estimatedTokens: record.estimatedTokens,
    stateChanging,
    ...((stateChanging || error) && important !== undefined
      ? { important }
      : {}),
    ...(digest === undefined ? {} : { digest }),
    retrieval: {
      readTool: "read_tool_result",
      searchTool: "search_tool_results",
      instruction: "Exact sanitized result remains stored under artifactId; rehydrate only the detail needed for the current task.",
    },
  };
}

function contextRetrievalTokens(messages: readonly ModelMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; toolName?: unknown; output?: unknown };
      if (
        part.type !== "tool-result"
        || typeof part.toolName !== "string"
        || !isContextRetrievalToolName(part.toolName)
      ) {
        continue;
      }
      tokens += estimateToolOutputTokens(unwrapToolOutput(part.output));
    }
  }
  return tokens;
}

function maskStaleContextRetrievalOutputs(
  messages: ModelMessage[],
  maxRetrievedTokens: number,
  protectedRecentTokens: number,
): ModelMessage[] {
  let used = contextRetrievalTokens(messages);
  if (used <= maxRetrievedTokens) return messages;
  const protectedStart = protectedRecentStartIndex(messages, protectedRecentTokens);
  const output = [...messages];
  for (let messageIndex = 0; messageIndex < protectedStart; messageIndex += 1) {
    const message = output[messageIndex];
    if (!message || message.role !== "tool" || !Array.isArray(message.content)) continue;
    let changed = false;
    const content = (message.content as unknown[]).map((rawPart) => {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
      const part = rawPart as {
        type?: unknown;
        toolName?: unknown;
        output?: unknown;
      };
      if (
        part.type !== "tool-result"
        || typeof part.toolName !== "string"
        || !isContextRetrievalToolName(part.toolName)
      ) {
        return rawPart;
      }
      const rawOutput = unwrapToolOutput(part.output);
      const compacted = compactContextRetrievalResult(part.toolName, rawOutput);
      const before = estimateToolOutputTokens(rawOutput);
      const after = estimateToolOutputTokens(compacted);
      if (after >= before) return rawPart;
      used -= before - after;
      changed = true;
      return {
        ...part,
        output: rewrapToolOutput(part.output, compacted),
      };
    });
    if (changed) output[messageIndex] = { ...message, content } as ModelMessage;
    if (used <= maxRetrievedTokens) break;
  }
  return output;
}

function toolObservationTokens(messages: readonly ModelMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; toolName?: unknown; output?: unknown };
      if (part.type !== "tool-result") continue;
      if (
        typeof part.toolName === "string"
        && isContextRetrievalToolName(part.toolName)
      ) continue;
      tokens += estimateToolOutputTokens(unwrapToolOutput(part.output));
    }
  }
  return tokens;
}

/**
 * Once exact bulky observations have durable artifact IDs, old previews are a
 * cache, not canonical state. Collapse those previews before dropping entire
 * historical turns so the model keeps provenance and can selectively rehydrate
 * the exact result later.
 */
function maskStaleVirtualizedToolOutputs(
  messages: ModelMessage[],
  maxToolObservationTokens: number,
  protectedRecentTokens: number,
): ModelMessage[] {
  let used = toolObservationTokens(messages);
  if (used <= maxToolObservationTokens) return messages;
  const protectedStart = protectedRecentStartIndex(messages, protectedRecentTokens);
  const output = [...messages];
  for (let messageIndex = 0; messageIndex < protectedStart; messageIndex += 1) {
    const message = output[messageIndex];
    if (!message || message.role !== "tool" || !Array.isArray(message.content)) continue;
    let changed = false;
    const content = (message.content as unknown[]).map((rawPart) => {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
      const part = rawPart as { type?: unknown; toolName?: unknown; output?: unknown };
      if (part.type !== "tool-result") return rawPart;
      if (
        typeof part.toolName === "string"
        && isContextRetrievalToolName(part.toolName)
      ) return rawPart;
      const rawOutput = unwrapToolOutput(part.output);
      if (!alreadyVirtualized(rawOutput)) return rawPart;
      const compacted = compactVirtualizedProjection(rawOutput);
      const before = estimateToolOutputTokens(rawOutput);
      const after = estimateToolOutputTokens(compacted);
      if (after >= before) return rawPart;
      used -= before - after;
      changed = true;
      return {
        ...part,
        output: rewrapToolOutput(part.output, compacted),
      };
    });
    if (changed) output[messageIndex] = { ...message, content } as ModelMessage;
    if (used <= maxToolObservationTokens) break;
  }
  return output;
}

function headTailValue(value: unknown, maxChars = 8_000): unknown {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return value;
  const marker = "\n...[emergency middle truncation]...\n";
  const half = Math.max(1, Math.floor((maxChars - marker.length) / 2));
  return {
    truncatedForContext: true,
    preview: `${text.slice(0, half)}${marker}${text.slice(-half)}`,
    instruction: "Use stored tool-result artifacts/history tools if exact omitted content is needed.",
  };
}

function emergencyBoundNewestToolOutputs(
  messages: ModelMessage[],
  tools: ToolSet,
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: (message.content as unknown[]).map((rawPart) => {
        if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
        const part = rawPart as { type?: unknown; toolName?: unknown; output?: unknown };
        if (part.type !== "tool-result") return rawPart;
        const rawOutput = unwrapToolOutput(part.output);
        if (estimateToolOutputTokens(rawOutput) < 2_000) return rawPart;
        if (!alreadyVirtualized(rawOutput)) {
          const stateChanging = typeof part.toolName === "string"
            && toolAppearsStateChanging({
              toolName: part.toolName,
              tool: tools[part.toolName],
            });
          if (stateChanging || toolResultAppearsError(rawOutput)) {
            // If canonical artifact persistence failed, do not manufacture a
            // lossy version of mutation/failure evidence merely to make the
            // provider call fit. Leaving it intact lets the caller reject the
            // irreducible turn locally rather than silently discarding facts.
            return rawPart;
          }
        }
        return {
          ...part,
          output: rewrapToolOutput(part.output, headTailValue(rawOutput)),
        };
      }),
    } as ModelMessage;
  });
}


export function contextNeedsToolResultRehydration(
  messages: readonly ModelMessage[],
  tools: ToolSet,
): boolean {
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const rawPart of message.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
      const part = rawPart as { type?: unknown; toolName?: unknown; output?: unknown };
      if (part.type !== "tool-result" || typeof part.toolName !== "string") continue;
      if (isContextRetrievalToolName(part.toolName)) continue;
      const rawOutput = unwrapToolOutput(part.output);
      if (alreadyVirtualized(rawOutput)) return true;
      const tool = tools[part.toolName];
      const declaredStateChanging = getToolEffect(tool)?.stateChanging;
      const stateChanging = toolAppearsStateChanging({
        toolName: part.toolName,
        tool,
        stateChanging: declaredStateChanging,
      });
      const policy = resolveToolContextPolicy({
        toolName: part.toolName,
        tool,
        stateChanging,
      });
      const preservedInlineMultiplier =
        (
          (stateChanging && policy.preserveIfStateChanging)
          || (toolResultAppearsError(rawOutput) && policy.preserveOnError)
        )
          ? 2
          : 1;
      if (
        estimateToolOutputTokens(rawOutput)
        > policy.inlineTokenLimit * preservedInlineMultiplier
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Compile canonical history into a bounded model working set. Reductions are
 * ordered from lossless/cheap to progressively more lossy operations.
 */
export async function compileAgentContext(params: {
  messages: ModelMessage[];
  tools: ToolSet;
  maxInputTokens: number;
  externalizeToolResult?: ContextCompilerExternalizer;
  /** Resolved control-plane task text; falls back to the literal latest user turn. */
  relevanceQuery?: string;
  allowPlatformSemanticRanking: boolean;
}): Promise<ContextCompilerResult> {
  const maxInputTokens = Math.max(1, Math.trunc(params.maxInputTokens));
  const targetTokens = Math.max(1, Math.floor(maxInputTokens * TARGET_UTILIZATION));
  const componentBudgets = allocateMessageContextBudgets(maxInputTokens);
  const maxRetainedUserTurns = historicalWorkingTurnLimit(maxInputTokens);
  let reductionLevel = 0;
  let messages = pruneMessages({
    messages: params.messages,
    reasoning: "all",
    emptyMessages: "remove",
  });
  if (messages.length !== params.messages.length) reductionLevel = 1;

  const boundedSystemMessages = boundInjectedSystemContext(messages, componentBudgets);
  if (estimateModelMessagesTokens(boundedSystemMessages) < estimateModelMessagesTokens(messages)) {
    reductionLevel = Math.max(reductionLevel, 1);
  }
  messages = boundedSystemMessages;

  const beforeInitialVirtualizationTokens = estimateModelMessagesTokens(messages);
  messages = await virtualizeOversizedToolOutputs({
    messages,
    tools: params.tools,
    externalize: params.externalizeToolResult,
  });
  if (estimateModelMessagesTokens(messages) < beforeInitialVirtualizationTokens) {
    reductionLevel = Math.max(reductionLevel, 2);
  }

  if (
    estimateModelMessagesTokens(messages) > targetTokens
    || toolObservationTokens(messages) > componentBudgets.toolObservations
  ) {
    const beforeMessageTokens = estimateModelMessagesTokens(messages);
    const beforeObservationTokens = toolObservationTokens(messages);
    messages = await virtualizeOversizedToolOutputs({
      messages,
      tools: params.tools,
      externalize: params.externalizeToolResult,
      forceStale: true,
      protectedRecentTokens: componentBudgets.recentProtectedHistory,
    });
    if (
      estimateModelMessagesTokens(messages) < beforeMessageTokens
      || toolObservationTokens(messages) < beforeObservationTokens
    ) {
      reductionLevel = Math.max(reductionLevel, 2);
    }
  }

  if (contextRetrievalTokens(messages) > componentBudgets.retrievedArtifacts) {
    const before = contextRetrievalTokens(messages);
    messages = maskStaleContextRetrievalOutputs(
      messages,
      componentBudgets.retrievedArtifacts,
      componentBudgets.recentProtectedHistory,
    );
    if (contextRetrievalTokens(messages) < before) {
      reductionLevel = Math.max(reductionLevel, 3);
    }
  }

  if (toolObservationTokens(messages) > componentBudgets.toolObservations) {
    const before = toolObservationTokens(messages);
    messages = maskStaleVirtualizedToolOutputs(
      messages,
      componentBudgets.toolObservations,
      componentBudgets.recentProtectedHistory,
    );
    if (toolObservationTokens(messages) < before) {
      reductionLevel = Math.max(reductionLevel, 3);
    }
  }

  if (staleToolCallInputsNeedMasking(
    messages,
    componentBudgets.toolInputs,
    componentBudgets.recentProtectedHistory,
  )) {
    const before = toolCallInputTokens(messages);
    messages = maskStaleToolCallInputs(
      messages,
      params.tools,
      componentBudgets.toolInputs,
      componentBudgets.recentProtectedHistory,
    );
    if (toolCallInputTokens(messages) < before) {
      // Exact tool arguments now live behind canonical history rehydration, so
      // provider-owned state must be reset just like other history reductions.
      reductionLevel = Math.max(reductionLevel, 4);
    }
  }

  if (
    estimateModelMessagesTokens(messages) > targetTokens
    || groupMessages(messages).filter((group) => group.userTurn).length > maxRetainedUserTurns
    || historicalWorkingSetTokens(
      messages,
      componentBudgets.recentProtectedHistory,
    ) > componentBudgets.historicalWorkingSet
  ) {
    const beforeTokens = estimateModelMessagesTokens(messages);
    const beforeMessages = messages.length;
    messages = await relevanceSelect(messages, {
      maxTotalTokens: targetTokens,
      recentProtectedTokens: componentBudgets.recentProtectedHistory,
      historicalWorkingSetTokens: componentBudgets.historicalWorkingSet,
      maxRetainedUserTurns,
      relevanceQuery: params.relevanceQuery,
      allowPlatformSemanticRanking: params.allowPlatformSemanticRanking,
    });
    if (
      estimateModelMessagesTokens(messages) < beforeTokens
      || messages.length < beforeMessages
    ) {
      reductionLevel = Math.max(reductionLevel, 4);
    }
  }

  if (estimateModelMessagesTokens(messages) > maxInputTokens) {
    messages = projectMessagesToBudget({ messages, maxInputTokens });
    reductionLevel = Math.max(reductionLevel, 5);
  }

  if (estimateModelMessagesTokens(messages) > maxInputTokens) {
    messages = emergencyBoundNewestToolOutputs(messages, params.tools);
    messages = projectMessagesToBudget({ messages, maxInputTokens });
    reductionLevel = Math.max(reductionLevel, 6);
  }

  return { messages, reductionLevel };
}
