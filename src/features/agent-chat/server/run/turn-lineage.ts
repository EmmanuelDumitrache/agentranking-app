import "server-only";

import type { AgentChatRun, Prisma, PrismaClient } from "@/generated/prisma/client";

export type AgentChatRunRootTriggerKind =
  | "USER_MESSAGE"
  | "REGENERATE"
  | "SCHEDULE";

type ChatDb = PrismaClient | Prisma.TransactionClient;

type AgentChatRunLineageRow = Pick<
  AgentChatRun,
  "id" | "triggerKind" | "triggerMessageId" | "parentRunId"
>;

export type AgentChatInitiatingTurn = {
  rootRunId: string;
  triggerKind: AgentChatRunRootTriggerKind;
  message: {
    id: string;
    role: "user";
    sequence: number;
    parts: unknown;
    metadata: unknown | null;
  };
};

/**
 * Resolve a run/continuation chain to the canonical transcript turn that
 * initiated it. Continuations must have explicit parent-run lineage; transcript
 * proximity is intentionally never used as a fallback.
 */
export async function resolveAgentChatInitiatingTurn(
  db: ChatDb,
  params: { runId: string; conversationId: string },
): Promise<AgentChatInitiatingTurn | null> {
  let runId: string | null = params.runId;

  for (let depth = 0; runId && depth < 32; depth += 1) {
    const run: AgentChatRunLineageRow | null = await db.agentChatRun.findFirst({
      where: {
        id: runId,
        conversationId: params.conversationId,
      },
      select: {
        id: true,
        triggerKind: true,
        triggerMessageId: true,
        parentRunId: true,
      },
    });
    if (!run) return null;

    if (
      run.triggerKind === "USER_MESSAGE" ||
      run.triggerKind === "REGENERATE" ||
      run.triggerKind === "SCHEDULE"
    ) {
      if (!run.triggerMessageId) return null;
      const message = await db.agentChatMessage.findFirst({
        where: {
          id: run.triggerMessageId,
          conversationId: params.conversationId,
          role: "user",
        },
        select: {
          id: true,
          role: true,
          sequence: true,
          parts: true,
          metadata: true,
        },
      });
      if (!message) return null;
      return {
        rootRunId: run.id,
        triggerKind: run.triggerKind,
        message: { ...message, role: "user" as const },
      };
    }

    // TOOL_APPROVAL and MCP_INPUT are execution continuations. Missing parent
    // lineage is corruption in the new schema, not a signal to infer a nearby
    // user message from transcript order.
    if (!run.parentRunId) return null;
    runId = run.parentRunId;
  }

  return null;
}
