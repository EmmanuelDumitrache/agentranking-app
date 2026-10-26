import { asSchema, type ModelMessage, type ToolSet } from "ai";
import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import {
  modelInputLimitForOutput,
  type AgentChatModelDefinition,
} from "../../shared/model-registry-types";

const CHARS_PER_TOKEN = 4;
const DEFAULT_JSON_CHAR_LIMIT = 2_000_000;
const DEFAULT_SAFETY_TOKENS = 4_096;
const MODEL_MESSAGE_ENVELOPE_TOKENS = 8;
const IMAGE_INPUT_ESTIMATE_TOKENS = 4_096;
const FILE_INPUT_ESTIMATE_TOKENS = 8_192;
/** Provider request/tool-array framing not represented by any one JSON schema. */
export const TOOL_REQUEST_ENVELOPE_TOKENS = 256;
/** Small per-schema framing/name overhead outside the normalized schema object. */
const TOOL_SCHEMA_ENVELOPE_TOKENS = 24;
/** Coarse pre-runtime allowance used only for initial model-fit routing. */
const PRE_RUN_DEFERRED_SCHEMA_TOKENS = 1_536;

export function estimatePreRunToolReserveTokens(requiresTools: boolean): number {
  return TOOL_REQUEST_ENVELOPE_TOKENS
    + (requiresTools ? PRE_RUN_DEFERRED_SCHEMA_TOKENS : 0);
}

export function estimateCharacterCountTokens(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.max(1, Math.ceil(Math.trunc(charCount) / CHARS_PER_TOKEN));
}

export function estimateTextTokens(text: string): number {
  return estimateCharacterCountTokens(text.length);
}

export function estimateJsonTokens(value: unknown, limit = DEFAULT_JSON_CHAR_LIMIT): number {
  const maxChars = Number.isFinite(limit)
    ? Math.max(CHARS_PER_TOKEN, Math.trunc(limit))
    : DEFAULT_JSON_CHAR_LIMIT;
  const preview = boundedJsonPreview(value, {
    maxChars,
    maxDepth: 12,
    maxEntriesPerContainer: 500,
    maxNodes: 50_000,
    maxStringChars: Math.min(maxChars, 256_000),
    indent: 0,
  });
  return Math.max(1, Math.ceil((preview.truncated ? maxChars : preview.text.length) / CHARS_PER_TOKEN));
}

function mediaContentPartTokens(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return estimateJsonTokens(value, 64_000);
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
  if (type === "text" && typeof record.text === "string") {
    return estimateTextTokens(record.text) + 4;
  }
  const isImage =
    type === "image-data"
    || type === "image-url"
    || type === "image-file-id"
    || mediaType.startsWith("image/");
  if (isImage) {
    return IMAGE_INPUT_ESTIMATE_TOKENS + estimateJsonTokens({
      type,
      mediaType,
      filename: typeof record.filename === "string" ? record.filename : undefined,
    }, 4_096);
  }
  if (type.startsWith("file-")) {
    return FILE_INPUT_ESTIMATE_TOKENS + estimateJsonTokens({
      type,
      mediaType,
      filename: typeof record.filename === "string" ? record.filename : undefined,
    }, 4_096);
  }
  return estimateJsonTokens(value, 128_000);
}

/**
 * Estimate provider-facing tool output without charging encoded image/file
 * bytes as ordinary prompt text. AI SDK multimodal tool outputs use a content
 * envelope whose binary/URL parts become provider media inputs.
 */
export function estimateToolOutputTokens(output: unknown): number {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return typeof output === "string"
      ? estimateTextTokens(output)
      : estimateJsonTokens(output, 512_000);
  }
  const record = output as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
  if (
    record.ok === true
    && record.readTool === "read_conversation_attachment"
    && mediaType.length > 0
    && typeof record.url === "string"
  ) {
    const mediaTokens = mediaType.startsWith("image/")
      ? IMAGE_INPUT_ESTIMATE_TOKENS
      : FILE_INPUT_ESTIMATE_TOKENS;
    return mediaTokens + estimateJsonTokens({
      mediaType,
      filename: typeof record.filename === "string" ? record.filename : undefined,
      messageId: typeof record.messageId === "string" ? record.messageId : undefined,
      partIndex: typeof record.partIndex === "number" ? record.partIndex : undefined,
    }, 4_096);
  }
  if (
    (type === "json" || type === "error-json")
    && "value" in record
  ) {
    return estimateJsonTokens(record.value, 8_000_000) + 8;
  }
  if (
    (type === "text" || type === "error-text")
    && "value" in record
  ) {
    return typeof record.value === "string"
      ? estimateTextTokens(record.value) + 8
      : estimateJsonTokens(record.value, 512_000) + 8;
  }
  if (type === "content" && Array.isArray(record.value)) {
    return 12 + record.value.reduce(
      (sum, part) => sum + mediaContentPartTokens(part),
      0,
    );
  }
  return estimateJsonTokens(output, 8_000_000);
}

function estimateModelPartTokens(part: unknown): number {
  if (typeof part === "string") return estimateTextTokens(part);
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    return estimateJsonTokens(part, 64_000);
  }
  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if ((type === "text" || type === "reasoning") && typeof record.text === "string") {
    return estimateTextTokens(record.text) + 4;
  }
  if (type === "tool-result" && "output" in record) {
    return estimateToolOutputTokens(record.output) + 8;
  }
  const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
  if (type === "image" || type === "file" || mediaType.startsWith("image/")) {
    // Data URLs and binary payloads are not provider text tokens. Reserve a
    // conservative provider-media allowance and charge only small textual
    // metadata; otherwise a valid image/PDF can look like a 500k-token string.
    const metadata = {
      type,
      mediaType,
      filename: typeof record.filename === "string" ? record.filename : undefined,
    };
    const mediaTokens = type === "image" || mediaType.startsWith("image/")
      ? IMAGE_INPUT_ESTIMATE_TOKENS
      : FILE_INPUT_ESTIMATE_TOKENS;
    return mediaTokens + estimateJsonTokens(metadata, 4_096);
  }
  return estimateJsonTokens(part, 512_000);
}

function estimateModelMessageTokens(message: ModelMessage): number {
  const content = (message as unknown as { content?: unknown }).content;
  const contentTokens = Array.isArray(content)
    ? content.reduce((sum, part) => sum + estimateModelPartTokens(part), 0)
    : estimateModelPartTokens(content);
  const providerOptions = (message as unknown as { providerOptions?: unknown }).providerOptions;
  return MODEL_MESSAGE_ENVELOPE_TOKENS
    + contentTokens
    + (providerOptions == null ? 0 : estimateJsonTokens(providerOptions, 8_192));
}

export function estimateModelMessagesTokens(
  messages: readonly ModelMessage[],
): number {
  if (messages.length === 0) return 0;
  return messages.reduce((sum, message) => sum + estimateModelMessageTokens(message), 0);
}

async function resolvedJsonSchema(value: unknown): Promise<unknown> {
  if (value == null) return undefined;
  try {
    return await Promise.resolve(asSchema(value as never).jsonSchema);
  } catch {
    // Provider-defined/custom tools may not expose a FlexibleSchema. Preserve
    // a bounded raw representation rather than failing context preparation.
    return value;
  }
}

async function toolSchemaProjection(
  name: string,
  value: ToolSet[string],
): Promise<Record<string, unknown>> {
  const record = value as unknown as Record<string, unknown>;
  if (record.type === "provider-defined") {
    return {
      name,
      type: record.type,
      id: record.id,
      args: record.args,
    };
  }
  return {
    name,
    description: record.description,
    inputSchema: await resolvedJsonSchema(record.inputSchema),
    strict: record.strict,
    type: record.type,
  };
}

/**
 * Per-tool provider-facing schema costs used by deferred materialization. A
 * FlexibleSchema/Zod wrapper can be far larger or smaller than the JSON Schema
 * actually sent to the provider, so resolve it through the AI SDK's public
 * asSchema() conversion before estimating.
 */
export async function estimateToolSchemaTokenCosts(
  tools: ToolSet,
): Promise<ReadonlyMap<string, number>> {
  const entries = await Promise.all(
    Object.entries(tools).map(async ([name, value]) => [
      name,
      estimateJsonTokens(await toolSchemaProjection(name, value), 512_000)
        + TOOL_SCHEMA_ENVELOPE_TOKENS,
    ] as const),
  );
  return new Map(entries);
}

export function sumToolSchemaTokenCosts(
  names: readonly string[],
  costs: ReadonlyMap<string, number>,
): number {
  return names.reduce((sum, name) => sum + Math.max(0, costs.get(name) ?? 0), 0);
}

export async function estimateToolSchemaTokens(tools: ToolSet): Promise<number> {
  const costs = await estimateToolSchemaTokenCosts(tools);
  return sumToolSchemaTokenCosts([...costs.keys()], costs);
}

export function computeModelInputLimit(args: {
  model: AgentChatModelDefinition;
  outputTokens: number;
  reservedToolTokens: number;
  safetyTokens?: number;
}): number {
  const providerInputLimit = modelInputLimitForOutput(args.model, args.outputTokens);
  return Math.max(
    1,
    providerInputLimit
      - Math.max(0, Math.trunc(args.reservedToolTokens))
      - Math.max(0, Math.trunc(args.safetyTokens ?? DEFAULT_SAFETY_TOKENS)),
  );
}

type MessageGroup = {
  messages: ModelMessage[];
  tokens: number;
  hasUser: boolean;
};

function roleOf(message: ModelMessage): string {
  return String((message as unknown as { role?: unknown }).role ?? "");
}

function buildAtomicGroups(messages: readonly ModelMessage[]): {
  system: ModelMessage[];
  groups: MessageGroup[];
} {
  const system: ModelMessage[] = [];
  const groups: MessageGroup[] = [];
  let current: ModelMessage[] = [];

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      messages: current,
      tokens: estimateModelMessagesTokens(current),
      hasUser: current.some((message) => roleOf(message) === "user"),
    });
    current = [];
  };

  for (const message of messages) {
    const role = roleOf(message);
    if (role === "system") {
      system.push(message);
      continue;
    }
    if (role === "user" && current.length > 0) flush();
    current.push(message);
  }
  flush();
  return { system, groups };
}

export function projectMessagesToBudget(args: {
  messages: readonly ModelMessage[];
  maxInputTokens: number;
}): ModelMessage[] {
  if (args.messages.length === 0) return [];
  const maxInputTokens = Math.max(1, Math.trunc(args.maxInputTokens));
  if (estimateModelMessagesTokens(args.messages) <= maxInputTokens) {
    return [...args.messages];
  }

  const { system, groups } = buildAtomicGroups(args.messages);
  const systemTokens = estimateModelMessagesTokens(system);
  const available = Math.max(1, maxInputTokens - systemTokens);
  const newestUserIndex = (() => {
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      if (groups[index]!.hasUser) return index;
    }
    return Math.max(0, groups.length - 1);
  })();

  // Keep a contiguous suffix of complete conversation turns. This removes
  // history oldest-first and never drops a newer turn merely because an older,
  // smaller turn happens to fit the remaining estimate. Each group keeps the
  // initiating user message and all assistant/tool execution messages that
  // follow it until the next user turn, so tool-call/result relationships stay
  // atomic.
  let firstSelectedIndex = newestUserIndex;
  let used = groups[newestUserIndex]?.tokens ?? 0;
  for (let index = newestUserIndex - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    if (used + group.tokens > available) break;
    firstSelectedIndex = index;
    used += group.tokens;
  }

  const projected = [
    ...system,
    ...groups
      .slice(firstSelectedIndex, newestUserIndex + 1)
      .flatMap((group) => group.messages),
  ];
  if (projected.length === 0) return [args.messages[args.messages.length - 1]!];
  return projected;
}
