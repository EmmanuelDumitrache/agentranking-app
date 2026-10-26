import "server-only";

import { createHash } from "node:crypto";
import { getToolName, isToolUIPart } from "ai";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import type { AgentChatAccess } from "../../shared/contracts";
import {
  extractTextContent,
  validateAgentChatUIMessages,
  type AgentChatUIMessage,
  type AgentChatUIPart,
} from "../../shared/ui-message";
import { validatePersistedAgentChatMessage } from "../persisted-ui-message";
import { projectMessageSearchFields } from "../message-search-projection";
import { resolveAgentChatInitiatingTurn } from "./turn-lineage";
import { HttpError } from "../http-error";
import { recordMcpOperationalEvent } from "../mcp/observability";

export type ToolApprovalDecision = {
  id: string;
  approved: boolean;
  reason?: string;
};

export type AppliedToolApproval = {
  conversationId: string;
  triggerMessageId: string;
  parentRunId: string;
  initiatingUserText: string;
  initiatingUserParts: AgentChatUIMessage["parts"];
  approvals: ToolApprovalDecision[];
  continuationRequestId: string;
};

function patchApprovalPart(
  part: AgentChatUIPart,
  decisions: ReadonlyMap<string, ToolApprovalDecision>,
  matched: Set<string>,
): AgentChatUIPart {
  if (!isToolUIPart(part) || !part.approval) return part;

  const id = part.approval.id;
  const decision = decisions.get(id);
  if (!decision) return part;
  if (
    part.state !== "approval-requested" &&
    part.state !== "approval-responded"
  ) {
    return part;
  }

  if (
    part.state === "approval-responded" &&
    typeof part.approval.approved === "boolean" &&
    part.approval.approved !== decision.approved
  ) {
    throw new HttpError(
      409,
      "INVALID_MESSAGE",
      "Tool approval decision conflicts with the persisted decision",
    );
  }

  matched.add(id);
  return {
    ...part,
    state: "approval-responded",
    approval: {
      ...part.approval,
      id,
      approved: decision.approved,
      ...(decision.reason
        ? { reason: redactSensitiveText(decision.reason) }
        : {}),
    },
  } as AgentChatUIPart;
}

function pendingApprovalIds(parts: readonly AgentChatUIPart[]): string[] {
  const ids: string[] = [];
  for (const part of parts) {
    if (
      !isToolUIPart(part) ||
      part.state !== "approval-requested" ||
      !part.approval
    ) {
      continue;
    }
    ids.push(part.approval.id);
  }
  return ids;
}

function continuationRequestId(params: {
  appAccountId: string;
  agentDbId: number;
  conversationId: string;
  triggerMessageId: string;
  approvals: ToolApprovalDecision[];
}): string {
  // The browser request id is intentionally not part of this key. Approval
  // continuation is a one-shot transition of a canonical persisted assistant
  // message; deriving the run idempotency key from that state prevents a
  // repeated HTTP request (or a maliciously changed browser requestId) from
  // executing an already-approved side effect a second time.
  const approvals = [...params.approvals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      approved: item.approved,
    }));
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        account: params.appAccountId,
        agent: params.agentDbId,
        conversation: params.conversationId,
        triggerMessage: params.triggerMessageId,
        approvals,
      }),
    )
    .digest("hex");
  return `approval:${digest}`;
}

/**
 * Applies browser-supplied approval decisions only to approval ids that already
 * exist in the canonical persisted assistant message. Tool names, tool inputs,
 * approval signatures, and all other tool-part metadata come exclusively from
 * the validated server-persisted message and are never accepted from the browser.
 */
export async function applyToolApprovalResponses(params: {
  access: AgentChatAccess;
  conversationId: string;
  assistantUiMessageId: string;
  approvals: ToolApprovalDecision[];
}): Promise<AppliedToolApproval> {
  const unique = new Map<string, ToolApprovalDecision>();
  for (const decision of params.approvals) {
    const prior = unique.get(decision.id);
    if (
      prior &&
      (prior.approved !== decision.approved || prior.reason !== decision.reason)
    ) {
      throw new HttpError(
        400,
        "INVALID_MESSAGE",
        "Conflicting responses were provided for the same tool approval",
      );
    }
    unique.set(decision.id, decision);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const message = await tx.agentChatMessage.findFirst({
        where: {
          id: params.assistantUiMessageId,
          conversationId: params.conversationId,
          role: "assistant",
          conversation: {
            appAccountId: params.access.appAccountId,
            agentDbId: params.access.agentDbId,
            status: "ACTIVE",
          },
        },
        select: {
          id: true,
          role: true,
          parts: true,
          metadata: true,
          responseRun: { select: { id: true } },
        },
      });
      if (!message) {
        throw new HttpError(
          404,
          "INVALID_MESSAGE",
          "The approval request is no longer available",
        );
      }

      if (!message.responseRun?.id) {
        throw new HttpError(
          500,
          "INTERNAL",
          "The persisted approval message has no producing run",
        );
      }
      const initiating = await resolveAgentChatInitiatingTurn(tx, {
        runId: message.responseRun.id,
        conversationId: params.conversationId,
      });
      if (!initiating) {
        throw new HttpError(
          500,
          "INTERNAL",
          "The approval run lineage has no canonical initiating turn",
        );
      }

      const assistant = await validatePersistedAgentChatMessage(message);
      const user = await validatePersistedAgentChatMessage(initiating.message);

      const matched = new Set<string>();
      const patchedParts = assistant.parts.map((part) =>
        patchApprovalPart(part, unique, matched),
      );

      for (const id of unique.keys()) {
        if (!matched.has(id)) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "A tool approval identifier did not match the canonical assistant message",
          );
        }
      }

      if (pendingApprovalIds(patchedParts).length > 0) {
        throw new HttpError(
          409,
          "INVALID_MESSAGE",
          "All pending tool approvals must be answered before the run can continue",
        );
      }

      const [validatedPatchedMessage] = await validateAgentChatUIMessages([
        {
          id: message.id,
          role: "assistant",
          parts: patchedParts,
          ...(assistant.metadata == null ? {} : { metadata: assistant.metadata }),
        },
      ]);
      if (!validatedPatchedMessage) {
        throw new HttpError(
          500,
          "INTERNAL",
          "The persisted approval update produced an invalid UI message",
        );
      }

      // Preserve signed/provider metadata exactly; only the approval decision
      // itself was accepted from the browser and patched into validated state.
      await tx.agentChatMessage.update({
        where: { id: message.id },
        data: {
          parts: validatedPatchedMessage.parts as Prisma.InputJsonValue,
          ...projectMessageSearchFields(validatedPatchedMessage.parts),
        },
      });

      const approvals = [...unique.values()];
      const mcpApprovals = assistant.parts.flatMap((part) => {
        // Provider tools use mcp__*, while the bounded catalog/resource/prompt
        // utilities use mcp_*. Both namespaces are MCP approval decisions and
        // must contribute to the same operational approval telemetry.
        if (!isToolUIPart(part) || !part.approval || !getToolName(part).startsWith("mcp_")) return [];
        const decision = unique.get(part.approval.id);
        return decision ? [decision.approved] : [];
      });
      return {
        conversationId: params.conversationId,
        triggerMessageId: message.id,
        parentRunId: message.responseRun.id,
        initiatingUserText: extractTextContent(user),
        initiatingUserParts: user.parts,
        approvals,
        continuationRequestId: continuationRequestId({
          appAccountId: params.access.appAccountId,
          agentDbId: params.access.agentDbId,
          conversationId: params.conversationId,
          triggerMessageId: message.id,
          approvals,
        }),
        mcpApprovals,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  for (const approved of result.mcpApprovals) {
    recordMcpOperationalEvent({
      event: "approval",
      outcome: approved ? "approved" : "rejected",
    });
  }
  const { mcpApprovals: _mcpApprovals, ...applied } = result;
  return applied;
}
