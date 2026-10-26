import "server-only";

import { getToolName, isToolUIPart } from "ai";
import { prisma } from "@/lib/db";
import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import { redactSensitiveData, redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import { validatePersistedAgentChatMessage } from "./persisted-ui-message";
import type { AgentChatUIPart } from "../shared/ui-message";

const MAX_TEXT = 1_000;
const MAX_ITEMS = 48;
const MAX_ORDINARY_LEDGER_ARTIFACTS = 12;

export type AgentWorkingState = {
  objective: string;
  constraints: string[];
  decisions: Array<{ decision: string; reason?: string }>;
  pendingActions: Array<{ action: string; artifactId?: string }>;
  completedActions: Array<{ action: string; artifactId?: string; outcome?: string }>;
  importantEntities: Array<{ kind: string; value: string; artifactId?: string }>;
  artifacts: Array<{ artifactId: string; toolName?: string; summary?: string }>;
  approvals: Array<{ action: string; status: string; artifactId?: string }>;
  unresolvedQuestions: string[];
  currentPlan: string[];
};

export const EMPTY_AGENT_WORKING_STATE: AgentWorkingState = {
  objective: "",
  constraints: [],
  decisions: [],
  pendingActions: [],
  completedActions: [],
  importantEntities: [],
  artifacts: [],
  approvals: [],
  unresolvedQuestions: [],
  currentPlan: [],
};

function text(value: unknown, max = MAX_TEXT): string {
  const raw = typeof value === "string" ? value : "";
  return redactSensitiveText(raw.trim()).slice(0, max);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = text(item, 500);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_ITEMS) break;
  }
  return result;
}

function objectList<T>(
  value: unknown,
  normalize: (record: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const result: T[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const normalized = normalize(item as Record<string, unknown>);
    if (normalized) result.push(normalized);
    if (result.length >= MAX_ITEMS) break;
  }
  return result;
}

export function normalizeAgentWorkingState(value: unknown): AgentWorkingState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    objective: text(record.objective, 2_000),
    constraints: stringList(record.constraints),
    decisions: objectList(record.decisions, (item) => {
      const decision = text(item.decision, 800);
      if (!decision) return null;
      const reason = text(item.reason, 800);
      return { decision, ...(reason ? { reason } : {}) };
    }),
    pendingActions: objectList(record.pendingActions, (item) => {
      const action = text(item.action, 800);
      if (!action) return null;
      const artifactId = text(item.artifactId, 128);
      return { action, ...(artifactId ? { artifactId } : {}) };
    }),
    completedActions: objectList(record.completedActions, (item) => {
      const action = text(item.action, 800);
      if (!action) return null;
      const artifactId = text(item.artifactId, 128);
      const outcome = text(item.outcome, 800);
      return {
        action,
        ...(artifactId ? { artifactId } : {}),
        ...(outcome ? { outcome } : {}),
      };
    }),
    importantEntities: objectList(record.importantEntities, (item) => {
      const kind = text(item.kind, 80);
      const entryValue = text(item.value, 1_000);
      if (!kind || !entryValue) return null;
      const artifactId = text(item.artifactId, 128);
      return { kind, value: entryValue, ...(artifactId ? { artifactId } : {}) };
    }),
    artifacts: objectList(record.artifacts, (item) => {
      const artifactId = text(item.artifactId, 128);
      if (!artifactId) return null;
      const toolName = text(item.toolName, 160);
      const summary = text(item.summary, 1_000);
      return {
        artifactId,
        ...(toolName ? { toolName } : {}),
        ...(summary ? { summary } : {}),
      };
    }),
    approvals: objectList(record.approvals, (item) => {
      const action = text(item.action, 800);
      const status = text(item.status, 80);
      if (!action || !status) return null;
      const artifactId = text(item.artifactId, 128);
      return { action, status, ...(artifactId ? { artifactId } : {}) };
    }),
    unresolvedQuestions: stringList(record.unresolvedQuestions),
    currentPlan: stringList(record.currentPlan),
  };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const output: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const itemKey = key(item);
    if (!itemKey || seen.has(itemKey)) continue;
    seen.add(itemKey);
    output.push(item);
    if (output.length >= MAX_ITEMS) break;
  }
  return output;
}

export function mergeAgentWorkingStates(
  previous: unknown,
  next: unknown,
): AgentWorkingState {
  const left = normalizeAgentWorkingState(previous);
  const right = normalizeAgentWorkingState(next);
  const completedActions = uniqueBy(
    [...right.completedActions, ...left.completedActions],
    (item) => `${item.action}:${item.artifactId ?? ""}`,
  );
  const completedArtifactIds = new Set(
    completedActions.flatMap((item) => item.artifactId ? [item.artifactId] : []),
  );
  const completedActionNames = new Set(completedActions.map((item) => item.action));
  const pendingActions = uniqueBy(
    [...right.pendingActions, ...left.pendingActions],
    (item) => `${item.action}:${item.artifactId ?? ""}`,
  ).filter((item) =>
    !(item.artifactId && completedArtifactIds.has(item.artifactId))
    && !(!item.artifactId && completedActionNames.has(item.action)),
  );
  return {
    objective: right.objective || left.objective,
    constraints: uniqueBy([...right.constraints, ...left.constraints], (item) => item),
    decisions: uniqueBy([...right.decisions, ...left.decisions], (item) => item.decision),
    pendingActions,
    completedActions,
    importantEntities: uniqueBy([...right.importantEntities, ...left.importantEntities], (item) => `${item.kind}:${item.value}`),
    artifacts: uniqueBy([...right.artifacts, ...left.artifacts], (item) => item.artifactId),
    // Right/new state wins for a given approval action so a responded approval
    // replaces its earlier pending representation.
    approvals: uniqueBy([...right.approvals, ...left.approvals], (item) => `${item.action}:${item.artifactId ?? ""}`),
    unresolvedQuestions: uniqueBy(
      [...right.unresolvedQuestions, ...left.unresolvedQuestions],
      (item) => item,
    ).filter((question) =>
      !right.completedActions.some((item) =>
        question.includes(`State-changing action ${item.action} did not succeed`),
      ),
    ),
    currentPlan: right.currentPlan.length > 0 ? right.currentPlan : left.currentPlan,
  };
}

const NON_OBJECTIVE_FOLLOW_UP = /^(?:yes|yeah|yep|yup|no|nope|ok(?:ay)?|sure|right|correct|exactly|continue|go on|proceed|do it|do that|that one|this one|same|again|retry|try again|thanks?|thank you|sounds good|looks good|please do|please continue)[.!? ]*$/i;
const DEICTIC_FOLLOW_UP = /^(?:(?:and|then|also|now)\s+)?(?:do|use|try|check|show|explain|fix|change|update|continue|finish)\s+(?:it|that|this|those|them)(?:\s+please)?[.!? ]*$/i;
const GENERIC_CONTINUATION_FOLLOW_UP = /^(?:please\s+)?(?:continue|resume|finish|complete|proceed(?:\s+with)?|keep\s+going|carry\s+on)(?:\s+(?:the\s+)?(?:implementation|work|task|plan|process|changes|remaining\s+work|rest))?(?:\s+from\s+(?:before|earlier|where\s+we\s+(?:left\s+off|stopped)))?(?:\s+please)?[.!? ]*$/i;

export function isContextDependentFollowUp(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return NON_OBJECTIVE_FOLLOW_UP.test(normalized)
    || DEICTIC_FOLLOW_UP.test(normalized)
    || GENERIC_CONTINUATION_FOLLOW_UP.test(normalized);
}

export async function resolveTaskControlText(
  conversationId: string,
  userText: string,
): Promise<string> {
  if (!isContextDependentFollowUp(userText)) return userText;
  const conversation = await prisma.agentChatConversation.findUnique({
    where: { id: conversationId },
    select: { workingState: true },
  });
  const objective = normalizeAgentWorkingState(conversation?.workingState).objective;
  if (!objective || isContextDependentFollowUp(objective)) return userText;
  return `${objective}\n\nContext-dependent follow-up: ${userText}`;
}

function shouldReplaceWorkingObjective(previous: string, next: string): boolean {
  if (!previous) return true;
  if (isContextDependentFollowUp(next)) return false;
  // A short message containing a concrete identifier/amount/action is still a
  // legitimate new objective (for example "swap 1 SOL" or "check ABC...").
  // Only suppress messages whose entire meaning depends on prior discourse.
  return true;
}

export async function recordWorkingObjective(
  conversationId: string,
  objective: string,
): Promise<void> {
  const value = text(objective, 2_000);
  if (!value) return;
  const conversation = await prisma.agentChatConversation.findUnique({
    where: { id: conversationId },
    select: { workingState: true },
  });
  if (!conversation) return;
  const state = normalizeAgentWorkingState(conversation.workingState);
  if (!shouldReplaceWorkingObjective(state.objective, value)) return;
  await prisma.agentChatConversation.update({
    where: { id: conversationId },
    data: {
      workingState: {
        ...state,
        objective: value,
      } as never,
    },
  });
}

function extractEntityPairs(value: unknown): Array<{ kind: string; value: string }> {
  const result: Array<{ kind: string; value: string }> = [];
  const seen = new Set<string>();
  const visit = (input: unknown, depth: number) => {
    if (depth > 5 || result.length >= 24 || !input || typeof input !== "object") return;
    if (Array.isArray(input)) {
      for (const entry of input.slice(0, 20)) visit(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      if (result.length >= 24) break;
      if (
        typeof entry === "string"
        && /(?:signature|transaction|txHash|hash|address|wallet|mint|token|chainId|network|receipt|approvalId|orderId)$/i.test(key)
      ) {
        const normalized = text(entry, 500);
        const id = `${key}:${normalized}`;
        if (normalized && !seen.has(id)) {
          seen.add(id);
          result.push({ kind: key, value: normalized });
        }
      } else {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
  return result;
}

function approvalStateFromParts(parts: readonly AgentChatUIPart[]): AgentWorkingState["approvals"] {
  const approvals: AgentWorkingState["approvals"] = [];
  for (const part of parts) {
    if (!isToolUIPart(part) || !part.approval) continue;
    const toolName = getToolName(part) || "tool action";
    const action = `${toolName} approval ${part.approval.id}`;
    if (part.state === "approval-requested") {
      approvals.push({ action, status: "pending" });
    } else if (part.state === "approval-responded") {
      approvals.push({
        action,
        status: part.approval.approved === true
          ? "approved"
          : part.approval.approved === false
            ? "rejected"
            : "responded",
      });
    }
  }
  return approvals;
}

export async function mergeRunArtifactsIntoWorkingState(params: {
  conversationId: string;
  runId: string;
}): Promise<void> {
  const [conversation, artifacts, toolEvents, recentAssistantMessages] = await Promise.all([
    prisma.agentChatConversation.findUnique({
      where: { id: params.conversationId },
      select: { workingState: true },
    }),
    prisma.agentChatArtifact.findMany({
      where: { runId: params.runId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        toolCallId: true,
        toolName: true,
        payloadJson: true,
        previewText: true,
        digestText: true,
        stateChanging: true,
      },
    }),
    prisma.agentChatToolEvent.findMany({
      where: { runId: params.runId },
      orderBy: [{ stepIndex: "asc" }, { createdAt: "asc" }],
      select: {
        toolCallId: true,
        toolName: true,
        state: true,
        resultArtifactId: true,
        errorJson: true,
      },
    }),
    prisma.agentChatMessage.findMany({
      where: {
        conversationId: params.conversationId,
        role: "assistant",
      },
      orderBy: { sequence: "desc" },
      take: 16,
      select: { id: true, role: true, parts: true, metadata: true },
    }),
  ]);
  if (!conversation) return;

  const previous = normalizeAgentWorkingState(conversation.workingState);
  const artifactByToolCallId = new Map(
    artifacts.flatMap((artifact) => artifact.toolCallId ? [[artifact.toolCallId, artifact] as const] : []),
  );
  const stateChangingArtifacts = artifacts.filter((artifact) => artifact.stateChanging);
  const terminalSuccess = new Set(
    toolEvents.filter((event) => event.state === "SUCCEEDED").map((event) => event.toolCallId),
  );
  const inFlight = new Set(
    toolEvents.filter((event) => event.state === "PENDING" || event.state === "RUNNING").map((event) => event.toolCallId),
  );
  const failedEvents = toolEvents.filter((event) =>
    event.state === "FAILED" || event.state === "TIMED_OUT" || event.state === "CANCELLED",
  );
  const failedToolCallIds = new Set(failedEvents.map((event) => event.toolCallId));
  const criticalArtifactIds = new Set(
    artifacts
      .filter((artifact) =>
        artifact.stateChanging
        || (artifact.toolCallId != null && failedToolCallIds.has(artifact.toolCallId)),
      )
      .map((artifact) => artifact.id),
  );
  // The working-state artifact list is a compact task ledger, not a second
  // artifact index. Preserve mutation/failure evidence first and only a small
  // recent tail of ordinary reads; every omitted result remains canonical and
  // searchable through search_tool_results/read_tool_result.
  const ledgerArtifacts = uniqueBy(
    [
      ...artifacts.filter((artifact) => criticalArtifactIds.has(artifact.id)).reverse(),
      ...artifacts
        .filter((artifact) => !criticalArtifactIds.has(artifact.id))
        .slice(-MAX_ORDINARY_LEDGER_ARTIFACTS)
        .reverse(),
    ],
    (artifact) => artifact.id,
  );

  const approvals: AgentWorkingState["approvals"] = [];
  for (const row of recentAssistantMessages) {
    try {
      const message = await validatePersistedAgentChatMessage(row);
      approvals.push(...approvalStateFromParts(message.parts));
    } catch {
      // The task ledger is an optimization over canonical history. A malformed
      // or legacy response must not block settlement; compaction can still
      // recover approval state from other validated messages later.
    }
  }

  const next: AgentWorkingState = {
    ...EMPTY_AGENT_WORKING_STATE,
    objective: previous.objective,
    artifacts: ledgerArtifacts.map((artifact) => ({
      artifactId: artifact.id,
      ...(artifact.toolName ? { toolName: artifact.toolName } : {}),
      summary: artifact.digestText?.slice(0, 1_000) ?? boundedJsonPreview(
        redactSensitiveData(artifact.payloadJson),
        {
          maxChars: 900,
          maxDepth: 5,
          maxEntriesPerContainer: 30,
          maxNodes: 500,
          maxStringChars: 500,
          indent: 0,
        },
      ).text,
    })),
    completedActions: stateChangingArtifacts
      .filter((artifact) => artifact.toolCallId && terminalSuccess.has(artifact.toolCallId))
      .map((artifact) => ({
        action: artifact.toolName || "state-changing tool action",
        artifactId: artifact.id,
        outcome: (artifact.digestText ?? artifact.previewText).slice(0, 800),
      })),
    pendingActions: stateChangingArtifacts
      .filter((artifact) => artifact.toolCallId && inFlight.has(artifact.toolCallId))
      .map((artifact) => ({
        action: artifact.toolName || "state-changing tool action",
        artifactId: artifact.id,
      })),
    importantEntities: ledgerArtifacts.flatMap((artifact) =>
      extractEntityPairs(artifact.payloadJson).map((entity) => ({
        ...entity,
        artifactId: artifact.id,
      })),
    ),
    approvals,
    unresolvedQuestions: failedEvents.flatMap((event) => {
      const artifact = artifactByToolCallId.get(event.toolCallId);
      if (!artifact?.stateChanging) return [];
      const details = event.errorJson
        ? boundedJsonPreview(redactSensitiveData(event.errorJson), {
            maxChars: 500,
            maxDepth: 4,
            maxEntriesPerContainer: 20,
            maxNodes: 200,
            maxStringChars: 300,
            indent: 0,
          }).text
        : event.state.toLowerCase();
      return [`State-changing action ${event.toolName} did not succeed (${details}).`];
    }),
  };
  const merged = mergeAgentWorkingStates(previous, next);
  await prisma.agentChatConversation.update({
    where: { id: params.conversationId },
    data: { workingState: merged as never },
  });
}
