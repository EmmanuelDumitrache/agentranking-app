import "server-only";

import { prisma } from "@/lib/db";
import {
  isAgentCardToolName,
  redactAgentCardPayload,
} from "@/lib/agent-trading/agentcard";
import {
  redactSensitiveData,
  safeErrorDetails,
} from "@/lib/security/sensitive-data-redaction";
import { normalizeToolOutcome } from "../orchestration/tool-outcome";

export type ToolEventTerminalState =
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export type ToolEventSourceMetadata = {
  toolSource?: string;
  sourceConnectionId?: string;
  sourceProviderKey?: string | null;
  sourceToolName?: string;
  sourceDisplayName?: string;
  sourceBindingId?: string;
  sourceDescriptorId?: string;
  catalogRevision?: number;
  schemaHash?: string;
  effectiveRisk?: string;
  approvalDecision?: string;
};

function jsonByteLength(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

const MCP_TARGET_FIELDS: Record<string, string> = {
  chain: "chain",
  network: "chain",
  chainid: "chainId",
  destinationchain: "destinationChain",
  asset: "asset",
  tokensymbol: "asset",
  tokenaddress: "asset",
  symbol: "asset",
  mint: "asset",
  contract: "contract",
  contractaddress: "contract",
  to: "recipient",
  recipient: "recipient",
  destinationaddress: "recipient",
  operation: "operation",
  method: "operation",
  action: "operation",
  amount: "amount",
  value: "value",
  slippage: "slippage",
  slippagebps: "slippageBps",
  fee: "fee",
  gas: "gas",
  gaslimit: "gasLimit",
  deadline: "deadline",
  expiry: "expiry",
};
const SECRET_TARGET_KEY = /(?:secret|api.?key|authorization|password|private|mnemonic|seed|signature|calldata|transaction|raw.?tx|access.?token|refresh.?token|bearer.?token|id.?token)/i;

function extractSafeMcpTargetInput(
  value: unknown,
  result: Record<string, string | number | boolean>,
  depth = 0,
  budget = { remaining: 96 },
): void {
  if (depth > 3 || budget.remaining <= 0 || !value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (--budget.remaining < 0) return;
    if (SECRET_TARGET_KEY.test(key)) continue;
    const canonical = MCP_TARGET_FIELDS[key.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (canonical && (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean")) {
      result[canonical] = typeof nested === "string" ? nested.slice(0, 256) : nested;
    } else if (nested && typeof nested === "object") {
      extractSafeMcpTargetInput(nested, result, depth + 1, budget);
    }
  }
}

function sanitizedMcpTarget(
  source: ToolEventSourceMetadata,
  input: unknown,
): Record<string, string | number | boolean> | undefined {
  if (source.toolSource !== "mcp") return undefined;
  const target: Record<string, string | number | boolean> = Object.fromEntries(
    Object.entries({
      connectionId: source.sourceConnectionId,
      providerKey: source.sourceProviderKey ?? undefined,
      bindingId: source.sourceBindingId,
      descriptorId: source.sourceDescriptorId,
      toolName: source.sourceToolName,
      displayName: source.sourceDisplayName,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  extractSafeMcpTargetInput(input, target);
  return target;
}

function sanitizeToolValue(toolName: string, value: unknown): unknown {
  const toolRedacted = isAgentCardToolName(toolName)
    ? redactAgentCardPayload(value)
    : value;
  return redactSensitiveData(toolRedacted);
}

function resultStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const direct = (value as { status?: unknown }).status;
  if (typeof direct === "string") return direct;
  const output = (value as { output?: unknown }).output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const nested = (output as { status?: unknown }).status;
  return typeof nested === "string" ? nested : null;
}

export function toolEventStateForResult(value: unknown): ToolEventTerminalState {
  if (resultStatus(value) === "input_required") return "SUCCEEDED";
  return normalizeToolOutcome(value).terminalSuccess ? "SUCCEEDED" : "FAILED";
}

export async function beginToolEvent(params: {
  runId: string;
  responseMessageId: string;
  stepIndex: number;
  toolCallId: string;
  toolName: string;
  input: unknown;
  redactInput?: boolean;
  sourceMetadata?: ToolEventSourceMetadata;
}): Promise<void> {
  const source = params.sourceMetadata ?? {};
  const inputJson = redactSensitiveData(
    params.redactInput ? { redacted: true } : params.input,
  ) as never;
  await prisma.agentChatToolEvent.createMany({
    data: [{
      runId: params.runId,
      responseMessageId: params.responseMessageId,
      stepIndex: params.stepIndex,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      state: "RUNNING",
      inputJson,
      toolSource: source.toolSource,
      sourceConnectionId: source.sourceConnectionId,
      sourceToolName: source.sourceToolName,
      sourceDisplayName: source.sourceDisplayName,
      sourceBindingId: source.sourceBindingId,
      sourceDescriptorId: source.sourceDescriptorId,
      catalogRevision: source.catalogRevision,
      schemaHash: source.schemaHash,
      effectiveRisk: source.effectiveRisk,
      approvalDecision: source.approvalDecision,
      requestBytes: jsonByteLength(params.input),
      sanitizedTargetJson: sanitizedMcpTarget(source, params.input),
    }],
    skipDuplicates: true,
  });
  // A stream observer may have created a PENDING row before execute starts.
  // Promote only that in-flight state; a duplicate callback must never move an
  // already-terminal execution back to RUNNING.
  await prisma.agentChatToolEvent.updateMany({
    where: {
      runId: params.runId,
      toolCallId: params.toolCallId,
      state: "PENDING",
    },
    data: {
      state: "RUNNING",
      stepIndex: params.stepIndex,
      inputJson,
      toolSource: source.toolSource,
      sourceConnectionId: source.sourceConnectionId,
      sourceToolName: source.sourceToolName,
      sourceDisplayName: source.sourceDisplayName,
      sourceBindingId: source.sourceBindingId,
      sourceDescriptorId: source.sourceDescriptorId,
      catalogRevision: source.catalogRevision,
      schemaHash: source.schemaHash,
      effectiveRisk: source.effectiveRisk,
      approvalDecision: source.approvalDecision,
      requestBytes: jsonByteLength(params.input),
      sanitizedTargetJson: sanitizedMcpTarget(source, params.input),
    },
  });
}

export async function finishToolEvent(params: {
  runId: string;
  toolCallId: string;
  toolName: string;
  state: ToolEventTerminalState;
  output?: unknown;
  summary?: unknown;
  resultArtifactId?: string;
  error?: unknown;
}): Promise<void> {
  await prisma.agentChatToolEvent.updateMany({
    where: {
      runId: params.runId,
      toolCallId: params.toolCallId,
      state: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      state: params.state,
      outputJson:
        params.output === undefined
          ? undefined
          : (sanitizeToolValue(params.toolName, params.output) as never),
      responseBytes: params.output === undefined
        ? undefined
        : jsonByteLength(sanitizeToolValue(params.toolName, params.output)),
      summaryJson:
        params.summary === undefined
          ? undefined
          : (sanitizeToolValue(params.toolName, params.summary) as never),
      resultArtifactId: params.resultArtifactId,
      errorJson:
        params.error === undefined
          ? undefined
          : (redactSensitiveData(safeErrorDetails(params.error)) as never),
      completedAt: new Date(),
    },
  });
}
