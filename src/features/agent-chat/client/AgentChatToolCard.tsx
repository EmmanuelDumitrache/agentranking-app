"use client";
import { memo, useMemo, useState } from "react";
import { getToolName } from "ai";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import type { AgentChatToolUIPart } from "../shared/ui-message";
import { cn } from "@/lib/utils";
import {
  McpElicitationCard,
  isMcpInputRequiredOutput,
} from "./McpElicitationCard";
import type { McpContinuationResponse } from "../shared/contracts";
interface Props {
  part: AgentChatToolUIPart;
  onApprovalResponse?: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
  onMcpContinuation?: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => void | Promise<void>;
  continuationDisabled?: boolean;
}
const MAX_DETAIL_CHARS = 12_000;
const stateMeta: Record<
  string,
  { label: string; icon: typeof Circle; className: string }
> = {
  "approval-requested": {
    label: "Awaiting approval",
    icon: Clock3,
    className: "text-amber-600 dark:text-amber-400",
  },
  "approval-responded": {
    label: "Approved",
    icon: CheckCircle2,
    className: "text-neutral-400",
  },
  "input-streaming": {
    label: "Preparing",
    icon: Circle,
    className: "text-muted-foreground",
  },
  "input-available": {
    label: "Running",
    icon: Clock3,
    className: "text-amber-600 dark:text-amber-400",
  },
  "output-available": {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-neutral-400",
  },
  "output-denied": {
    label: "Denied",
    icon: XCircle,
    className: "text-orange-600 dark:text-orange-400",
  },
  "output-error": {
    label: "Error",
    icon: AlertCircle,
    className: "text-destructive",
  },
};
function humanizeToolName(value: string): string {
  const normalized = value.replace(/^tool-/, "");
  const mcp = normalized.match(/^mcp_s[0-9a-z]+_(.+)_[0-9a-f]{8,32}$/i);
  const stableMcp = normalized.startsWith("mcp__")
    ? normalized.split("__").slice(2).join("__")
    : null;
  const display = stableMcp || mcp?.[1] || normalized.replace(/^mcp_/, "");
  return display
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeLabel(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function getMcpProvenance(output: unknown, metadata: unknown):
  | {
      server: string;
      tool: string;
      risk: string | null;
      provider: string | null;
      connectionId: string | null;
      approvalMode: string | null;
      durationMs: number | null;
      executionState: string | null;
    }
  | null {
  const source = record(record(output)?.source);
  const trusted = record(metadata);
  if (source?.kind !== "mcp" && trusted?.source !== "mcp") return null;
  const server =
    safeLabel(source?.server)
    ?? safeLabel(source?.serverName)
    ?? safeLabel(trusted?.serverName)
    ?? "MCP connection";
  const tool =
    safeLabel(source?.tool, 200)
    ?? safeLabel(source?.operation, 200)
    ?? safeLabel(trusted?.externalToolName, 200)
    ?? "MCP";
  const execution = record(trusted?.execution);
  return {
    server,
    tool,
    risk: safeLabel(source?.risk, 40) ?? safeLabel(trusted?.effectiveRisk, 40),
    provider: safeLabel(source?.providerKey, 80) ?? safeLabel(trusted?.providerKey, 80),
    connectionId: safeLabel(source?.connectionId, 160) ?? safeLabel(trusted?.connectionId, 160),
    approvalMode: safeLabel(trusted?.approvalMode, 40),
    durationMs: typeof execution?.durationMs === "number" && Number.isFinite(execution.durationMs)
      ? Math.max(0, Math.round(execution.durationMs))
      : null,
    executionState: safeLabel(execution?.state, 40),
  };
}

function mcpInputSummary(input: unknown): string | null {
  const value = record(input);
  if (!value) return input == null ? null : "One scalar parameter";
  const keys = Object.keys(value)
    .filter((key) => !/(?:secret|token|key|password|authorization|cookie|mnemonic|seed|signature)/i.test(key))
    .map((key) => safeLabel(key, 48))
    .filter((key): key is string => Boolean(key))
    .slice(0, 6);
  if (keys.length === 0) return `${Object.keys(value).length} protected parameter(s)`;
  return `${Object.keys(value).length} parameter(s): ${keys.join(", ")}${Object.keys(value).length > keys.length ? ", …" : ""}`;
}

const MCP_SENSITIVE_PARAMETER = /(?:authorization|api.?key|access.?token|refresh.?token|auth.?token|bearer.?token|identity.?token|client.?secret|password|passwd|private.?key|secret|seed(?:.?phrase)?|mnemonic|signature|signed.?payload|wallet.?export|cookie|cvv|cvc|card.?number)/i;
const MCP_AUTH_VALUE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const MCP_KEY_VALUE = /\b(?:sk-[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g;

function sanitizeMcpDisplayValue(
  value: unknown,
  depth = 0,
  budget = { remaining: 500 },
): unknown {
  if (budget.remaining <= 0) return "[additional parameters omitted]";
  budget.remaining -= 1;
  if (depth > 8) return "[nested parameters omitted]";
  if (typeof value === "string") {
    return value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(MCP_AUTH_VALUE, (match) => `${match.split(/\s/, 1)[0]} [REDACTED]`)
      .replace(MCP_KEY_VALUE, "[REDACTED]");
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeMcpDisplayValue(entry, depth + 1, budget));
  }
  const objectValue = record(value);
  if (!objectValue) return String(value);
  return Object.fromEntries(
    Object.entries(objectValue).slice(0, 100).map(([key, nested]) => [
      key,
      MCP_SENSITIVE_PARAMETER.test(key)
        ? "[REDACTED]"
        : sanitizeMcpDisplayValue(nested, depth + 1, budget),
    ]),
  );
}

const MCP_REVIEW_FIELD: Record<string, string> = {
  chain: "chain",
  chainid: "chain",
  network: "chain",
  fromchain: "chain",
  destinationchain: "destination chain",
  tochain: "destination chain",
  tochainid: "destination chain",
  venue: "venue",
  exchange: "venue",
  protocol: "venue",
  dex: "venue",
  recipient: "recipient",
  to: "recipient",
  destinationaddress: "recipient",
  toaddress: "recipient",
  asset: "asset",
  token: "asset",
  symbol: "asset",
  mint: "asset",
  amount: "amount",
  amountin: "amount",
  fromamount: "amount",
  minimumoutput: "minimum output",
  minamountout: "minimum output",
  toamountmin: "minimum output",
  slippage: "slippage",
  slippagebps: "slippage",
  slippagetolerance: "slippage",
  fee: "estimated fee/cost",
  fees: "estimated fee/cost",
  gas: "estimated fee/cost",
  gasprice: "estimated fee/cost",
  deadline: "deadline",
  expiry: "deadline",
  expiresat: "deadline",
};

function collectMcpReviewFields(
  value: unknown,
  result: Map<string, string | number | boolean>,
  depth = 0,
  budget = { remaining: 128 },
): void {
  if (depth > 4 || budget.remaining <= 0) return;
  const valueRecord = record(value);
  if (!valueRecord) return;
  for (const [key, nested] of Object.entries(valueRecord)) {
    budget.remaining -= 1;
    if (budget.remaining < 0) return;
    if (MCP_SENSITIVE_PARAMETER.test(key)) continue;
    const label = MCP_REVIEW_FIELD[key.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (
      label
      && !result.has(label)
      && (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean")
    ) {
      result.set(label, nested);
      continue;
    }
    if (nested && typeof nested === "object") {
      collectMcpReviewFields(nested, result, depth + 1, budget);
    }
  }
}

function mcpTargetSummary(input: unknown): string | null {
  const fields = new Map<string, string | number | boolean>();
  collectMcpReviewFields(input, fields);
  const parts = [...fields.entries()].slice(0, 10).flatMap(([label, candidate]) => {
    const rendered = typeof candidate === "number"
      ? String(candidate)
      : typeof candidate === "boolean"
        ? String(candidate)
        : safeLabel(candidate, 80);
    if (!rendered) return [];
    const shortened = rendered.length > 24
      ? `${rendered.slice(0, 12)}…${rendered.slice(-8)}`
      : rendered;
    return [`${label}: ${shortened}`];
  });
  return parts.length ? parts.join(" · ") : null;
}

function mcpWalletBoundary(risk: string | null): string | null {
  if (["SIGN", "BROADCAST", "PAYMENT", "CUSTODY"].includes(risk ?? "")) {
    return "This capability is blocked by platform policy.";
  }
  if (["TRANSACTION_PREPARE", "TRADE"].includes(risk ?? "")) {
    return "This MCP step cannot sign or broadcast. Any native wallet step requires simulation and a fresh approval bound to the exact decoded intent.";
  }
  return null;
}

function mcpEffect(risk: string | null): string {
  switch (risk) {
    case "READ_ONLY": return "Reads external provider data.";
    case "ANALYTICS_QUERY": return "Runs an external analytics query.";
    case "TRANSACTION_PREPARE": return "May prepare an unsigned transaction; it cannot sign or broadcast it.";
    case "WRITE_OFFCHAIN": return "May create or change provider-side state.";
    case "TRADE": return "Requests a financial trade operation.";
    case "PAYMENT": return "Requests a payment operation.";
    default: return "Calls an external MCP provider under the connection policy.";
  }
}

function nativeTransactionStatus(output: unknown): "review" | "blocked" | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const status = (output as { status?: unknown }).status;
  if (status === "unsigned_transaction_requires_native_review") return "review";
  if (status === "unsigned_transaction_blocked") return "blocked";
  return null;
}
function formatDetail(
  value: unknown,
): { text: string; truncated: boolean } | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return value.length <= MAX_DETAIL_CHARS
      ? { text: value, truncated: false }
      : { text: value.slice(0, MAX_DETAIL_CHARS), truncated: true };
  }
  return boundedJsonPreview(value, {
    maxChars: MAX_DETAIL_CHARS,
    maxEntriesPerContainer: 80,
    maxNodes: 1_000,
    maxStringChars: 4_000,
  });
}
function formatSendSummary(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const amount =
    typeof record.amountSol === "number" ? record.amountSol : null;
  const recipient =
    typeof record.recipient === "string" ? record.recipient : null;
  if (amount == null || !recipient) return null;
  const short =
    recipient.length > 12
      ? `${recipient.slice(0, 4)}…${recipient.slice(-4)}`
      : recipient;
  return `Send ${amount} SOL → ${short}`;
}

function formatAgentCardRequestSummary(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const amount =
    typeof record.amount_dollars === "number" ? record.amount_dollars : null;
  if (amount == null) return null;
  return `Issue single-use AgentCard for $${amount}`;
}

function formatAgentCardCancelSummary(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const id = (input as Record<string, unknown>).id;
  if (typeof id !== "string" || !id) return null;
  const short = id.length > 16 ? `${id.slice(0, 8)}…` : id;
  return `Cancel AgentCard ${short}`;
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  const detail = useMemo(() => formatDetail(value), [value]);
  if (!detail) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#212121] bg-[#0f0f0f] p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
        {detail.text}
        {detail.truncated ? "\n\n… output truncated for display" : ""}
      </pre>
    </div>
  );
}
function AgentChatToolCardComponent({ part, onApprovalResponse, onMcpContinuation, continuationDisabled = false }: Props) {
  const runtimeToolName = getToolName(part);
  const mcpProvenance = getMcpProvenance(part.output, part.toolMetadata);
  const provenanceToolName = mcpProvenance?.tool && !mcpProvenance.tool.includes("/")
    ? mcpProvenance.tool
    : null;
  const toolName = humanizeToolName(provenanceToolName ?? runtimeToolName);
  const respondedApproval =
    part.state === "approval-responded" && typeof part.approval?.approved === "boolean"
      ? part.approval.approved
      : null;
  const meta = respondedApproval === false
    ? stateMeta["output-denied"]
    : stateMeta[part.state] ?? {
    label: "Working",
    icon: Wrench,
    className: "text-muted-foreground",
  };
  const StatusIcon = meta.icon;
  const isActive =
    part.state === "input-streaming" || part.state === "input-available";
  const needsApproval =
    part.state === "approval-requested" && Boolean(part.approval?.id);
  const mcpInputRequired = isMcpInputRequiredOutput(part.output)
    ? part.output
    : null;
  const nativeTransactionHandoff = nativeTransactionStatus(part.output);
  const hasDetails =
    part.input != null ||
    part.output != null ||
    Boolean(part.errorText) ||
    needsApproval;
  const forceOpen = part.state === "output-error" || needsApproval || Boolean(mcpInputRequired);
  const [userOpen, setUserOpen] = useState(forceOpen);
  const open = forceOpen || userOpen;
  const [responding, setResponding] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const sendSummary = formatSendSummary(part.input);
  const agentCardSummary =
    formatAgentCardRequestSummary(part.input) ??
    formatAgentCardCancelSummary(part.input);
  const actionSummary = sendSummary ?? agentCardSummary;
  const inputSummary = mcpProvenance ? mcpInputSummary(part.input) : null;
  const targetSummary = mcpProvenance ? mcpTargetSummary(part.input) : null;
  const displayInput = mcpProvenance
    ? sanitizeMcpDisplayValue(part.input)
    : part.input;
  const handleApproval = async (approved: boolean) => {
    if (!part.approval?.id || !onApprovalResponse || responding) return;
    setResponding(true);
    setApprovalError(null);
    try {
      await onApprovalResponse({
        id: part.approval.id,
        approved,
        reason: approved ? undefined : "Denied by user",
      });
    } catch {
      setResponding(false);
      setApprovalError(
        "Could not submit this approval. Your choice was not applied; try again.",
      );
    }
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setUserOpen}
      className="ui-chat-tool-card group/tool not-prose w-full overflow-hidden rounded-lg border border-[#212121] bg-[#181818]"
    >
      <CollapsibleTrigger
        disabled={!hasDetails}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500 disabled:cursor-default"
        aria-label={`${toolName}: ${meta.label}${hasDetails ? ". Toggle details" : ""}`}
      >
        <Wrench aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={`${toolName}${mcpProvenance ? ` · ${mcpProvenance.server}` : ""}`}
        >
          {toolName}
          {mcpProvenance ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {mcpProvenance.server}
            </span>
          ) : null}
        </span>
        <Badge
          variant="secondary"
          className="gap-1 border border-[#212121] bg-[#0f0f0f] px-1.5 py-0 text-[10px] text-neutral-300"
        >
          <StatusIcon
            aria-hidden
            className={cn(
              "size-3",
              meta.className,
              isActive && "animate-pulse motion-reduce:animate-none",
            )}
          />
          {meta.label}
        </Badge>
        {mcpProvenance?.risk ? (
          <Badge variant="outline" className="hidden px-1.5 py-0 text-[10px] sm:inline-flex">
            {mcpProvenance.risk.toLowerCase().replaceAll("_", " ")}
          </Badge>
        ) : null}
        {nativeTransactionHandoff ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {nativeTransactionHandoff === "review" ? "Native review" : "Transaction blocked"}
          </Badge>
        ) : null}
        {hasDetails && (
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none group-data-[state=open]/tool:rotate-180"
          />
        )}
      </CollapsibleTrigger>
      {hasDetails && (
        <CollapsibleContent className="space-y-3 border-t border-[#212121] px-3 py-3">
          {needsApproval ? (
            <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm font-medium text-foreground">
                Confirm this action
              </p>
              {actionSummary ? (
                <p className="font-mono text-xs text-foreground/90">
                  {actionSummary}
                </p>
              ) : null}
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                {mcpProvenance
                  ? `${mcpEffect(mcpProvenance.risk)} The reviewed connection and current tool policy will be rechecked immediately before execution.`
                  : agentCardSummary
                  ? "Places a hold on the operator AgentCard payment method. Card credentials remain outside chat and can be revealed only in the authenticated AgentCard panel."
                  : "Confirm this action before the agent continues."}
              </p>
              {mcpProvenance && mcpWalletBoundary(mcpProvenance.risk) ? (
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {mcpWalletBoundary(mcpProvenance.risk)}
                </p>
              ) : null}
              {approvalError ? (
                <p className="text-xs text-destructive" role="alert">
                  {approvalError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={responding}
                  onClick={() => void handleApproval(true)}
                  className="bg-neutral-100 text-neutral-950 hover:bg-white"
                >
                  {responding ? "Submitting…" : sendSummary ? "Approve send" : "Approve"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={responding}
                  onClick={() => void handleApproval(false)}
                  className="border-[#212121] bg-[#181818] text-neutral-200 hover:bg-[#212121]"
                >
                  Deny
                </Button>
              </div>
            </div>
          ) : null}
          {mcpProvenance ? (
            <div className="grid gap-2 rounded-md border border-[#212121] bg-[#0f0f0f] p-3 text-[11px] sm:grid-cols-2">
              <div>
                <div className="text-muted-foreground">Provider / connection</div>
                <div>{mcpProvenance.provider ?? "custom"} · {mcpProvenance.server}</div>
                {mcpProvenance.connectionId ? <code className="text-[10px] text-muted-foreground">{mcpProvenance.connectionId}</code> : null}
              </div>
              <div>
                <div className="text-muted-foreground">Operation / risk</div>
                <code>{mcpProvenance.tool}</code>
                <div>{mcpProvenance.risk?.toLowerCase().replaceAll("_", " ") ?? "locally unclassified"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Sanitized input summary</div>
                <div>{inputSummary ?? "No parameters"}</div>
                {targetSummary ? <div className="mt-0.5">Target · {targetSummary}</div> : null}
              </div>
              <div>
                <div className="text-muted-foreground">Effect / approval / status</div>
                <div>{mcpEffect(mcpProvenance.risk)}</div>
                <div>
                  {respondedApproval === false
                    ? "User denied"
                    : needsApproval
                      ? "Awaiting explicit approval"
                      : respondedApproval === true
                        ? "User approved"
                        : mcpProvenance.approvalMode === "AUTO_READ_ONLY"
                          ? "Read-only policy allowed"
                          : meta.label}
                  {mcpProvenance.durationMs == null ? "" : ` · ${mcpProvenance.durationMs} ms`}
                  {mcpProvenance.executionState ? ` · ${mcpProvenance.executionState}` : ""}
                </div>
              </div>
            </div>
          ) : null}
          {mcpInputRequired ? (
            <McpElicitationCard
              key={mcpInputRequired.continuationId}
              output={mcpInputRequired}
              disabled={continuationDisabled}
              onSubmit={onMcpContinuation}
            />
          ) : null}
          <DetailBlock label={mcpProvenance ? "Sanitized parameters" : "Parameters"} value={displayInput} />
          {part.errorText ? (
            <div
              className="rounded-md bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
              role="alert"
            >
              {part.errorText}
            </div>
          ) : null}
          {mcpInputRequired ? null : <DetailBlock label="Result" value={part.output} />}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
export const AgentChatToolCard = memo(AgentChatToolCardComponent);
