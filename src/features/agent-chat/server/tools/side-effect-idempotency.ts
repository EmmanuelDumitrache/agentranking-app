import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { redactSensitiveData, safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import { normalizeToolOutcome } from "../orchestration/tool-outcome";

type ToolExecutionIdentity = {
  runId: string;
  toolCallId: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executionIdentity(args: readonly unknown[]): ToolExecutionIdentity | null {
  const options = args[1];
  if (!isObject(options) || typeof options.toolCallId !== "string") return null;
  const context = options.context;
  if (!isObject(context) || typeof context.runId !== "string") return null;
  const runId = context.runId.trim();
  const toolCallId = options.toolCallId.trim();
  return runId && toolCallId ? { runId, toolCallId } : null;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return String(value);
}

function jsonSafe(value: unknown): unknown {
  return canonicalize(redactSensitiveData(value));
}

function inputHash(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}

function duplicateResult(status: string, toolName: string): unknown {
  if (status === "STARTED") {
    return {
      ok: false,
      status: "unknown",
      code: "TOOL_EXECUTION_IN_FLIGHT_OR_AMBIGUOUS",
      message: `The ${toolName} action was already started. It will not be executed again automatically.`,
    };
  }
  return {
    ok: false,
    status: "unknown",
    code: "TOOL_EXECUTION_NOT_RETRY_SAFE",
    message: `The ${toolName} action has a prior ambiguous or failed attempt. Inspect its external state before trying a new action.`,
  };
}

/**
 * Execute a state-changing tool once per (runId, toolCallId).
 * Successful outputs are persisted only after canonical secret redaction and
 * replayed on duplicate SDK delivery. Exceptions are marked UNKNOWN because a
 * remote side effect may have happened even when its acknowledgement was lost.
 */
export async function executeIdempotentSideEffect(
  toolName: string,
  args: readonly unknown[],
  execute: (...args: unknown[]) => unknown,
): Promise<unknown> {
  const identity = executionIdentity(args);
  if (!identity) return await Promise.resolve(execute(...args));
  const hash = inputHash(args[0]);

  try {
    await prisma.agentChatToolExecution.create({
      data: {
        runId: identity.runId,
        toolCallId: identity.toolCallId,
        toolName,
        inputHash: hash,
        status: "STARTED",
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const existing = await prisma.agentChatToolExecution.findUnique({
      where: { runId_toolCallId: identity },
    });
    if (!existing) throw error;
    if (existing.inputHash !== hash || existing.toolName !== toolName) {
      return {
        ok: false,
        status: "validation_error",
        code: "DUPLICATE_TOOL_CALL_ID_MISMATCH",
        message: "A duplicate tool-call id was received with different action data and was rejected.",
      };
    }
    if ((existing.status === "SUCCEEDED" || existing.status === "FAILED") && existing.outputJson !== null) {
      return existing.outputJson;
    }
    return duplicateResult(existing.status, toolName);
  }

  try {
    const result = await Promise.resolve(execute(...args));
    const safeResult = jsonSafe(result);
    const outcome = normalizeToolOutcome(result);
    const terminalStatus = outcome.terminalSuccess
      ? "SUCCEEDED"
      : outcome.kind === "partial"
        ? "UNKNOWN"
        : "FAILED";
    await prisma.agentChatToolExecution.update({
      where: { runId_toolCallId: identity },
      data: {
        status: terminalStatus,
        outputJson: safeResult as never,
        completedAt: new Date(),
      },
    });
    return safeResult;
  } catch (error) {
    await prisma.agentChatToolExecution.updateMany({
      where: {
        runId: identity.runId,
        toolCallId: identity.toolCallId,
        status: "STARTED",
      },
      data: {
        status: "UNKNOWN",
        errorJson: jsonSafe(safeErrorDetails(error)) as never,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }
}
