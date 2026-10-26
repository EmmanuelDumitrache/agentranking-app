import { NoSuchToolError, type JSONSchema7, type ToolCallRepairFunction, type ToolSet } from "ai";
/* ------------------------------------------------------------------ */
/*  Exact SDK repair-call type                                        */
/* ------------------------------------------------------------------ */
type RepairableToolCall = Parameters<
  ToolCallRepairFunction<ToolSet>
>[0]["toolCall"];
/* ------------------------------------------------------------------ */
/*  Telemetry                                                          */
/* ------------------------------------------------------------------ */
type RepairTelemetry = {
  toolName: string;
  toolCallId: string;
  repairStage: "deterministic" | "model" | "none";
  errorClass: string;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  changedFieldNames: string[];
  semanticFieldChanged: false;
};
/* ------------------------------------------------------------------ */
/*  Repair state                                                       */
/* ------------------------------------------------------------------ */
type RepairState = {
  repairAttempts: Map<string, number>;
  invalidToolCallCount: number;
  repairCount: number;
};
/* ------------------------------------------------------------------ */
/*  Repair result                                                      */
/* ------------------------------------------------------------------ */
type RepairResult = {
  stage: "deterministic" | "model" | "none";
  repaired: RepairableToolCall | null;
  changedFields: string[];
};
/* ------------------------------------------------------------------ */
/*  Schema helpers                                                     */
/* ------------------------------------------------------------------ */
function resolveRef(ref: string, root: JSONSchema7): JSONSchema7 | null {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current as JSONSchema7 | null;
}
function collectProperties(
  schema: JSONSchema7,
  root: JSONSchema7,
): Array<{ name: string; schema: JSONSchema7 }> {
  if (schema.properties !== undefined) {
    return Object.entries(schema.properties).map(([name, prop]) => ({
      name,
      schema: typeof prop === "boolean" ? {} : (prop as JSONSchema7),
    }));
  }
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved !== null) {
      return collectProperties(resolved, root);
    }
  }
  return [];
}
function isNumericSchema(prop: JSONSchema7): boolean {
  const t = prop.type;
  if (t === "number" || t === "integer") return true;
  if (Array.isArray(t) && t.includes("number")) return true;
  if (Array.isArray(t) && t.includes("integer")) return true;
  return false;
}
function getStringEnumValues(prop: JSONSchema7): string[] | null {
  const t = prop.type;
  const isStringType =
    t === "string" || (Array.isArray(t) && t.includes("string"));
  if (!isStringType) return null;
  if (
    Array.isArray(prop.enum) &&
    prop.enum.every((v: unknown): v is string => typeof v === "string")
  ) {
    return prop.enum;
  }
  return null;
}
/* ------------------------------------------------------------------ */
/*  Repair helpers                                                     */
/* ------------------------------------------------------------------ */
function tryCoerceNumber(value: unknown, schema: JSONSchema7): number | null {
  if (typeof value !== "string") return null;
  if (!isNumericSchema(schema)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}
function tryEnumNormalize(value: string, enumValues: string[]): string | null {
  const lower = value.toLowerCase();
  for (const ev of enumValues) {
    if (ev.toLowerCase() === lower) return ev;
  }
  return null;
}
function attemptMechanicalRepair(
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  inputSchema: JSONSchema7,
): { repaired: Record<string, unknown> | null; changedFields: string[] } {
  const props = collectProperties(inputSchema, inputSchema);
  if (props.length === 0) {
    return { repaired: null, changedFields: [] };
  }
  const input = { ...toolCall.input };
  const changedFields: string[] = [];
  // 1. Whitespace trimming
  for (const { name } of props) {
    const val = input[name];
    if (typeof val === "string" && val !== val.trim()) {
      input[name] = val.trim();
      changedFields.push(name);
    }
  }
  if (changedFields.length > 0) {
    return { repaired: input, changedFields };
  }
  // 2. Primitive type coercion (string → number)
  for (const { name, schema } of props) {
    const coerced = tryCoerceNumber(input[name], schema);
    if (coerced !== null) {
      input[name] = coerced;
      changedFields.push(name);
      return { repaired: input, changedFields };
    }
  }
  // 3. Enum case normalization
  for (const { name, schema } of props) {
    const val = input[name];
    if (typeof val !== "string") continue;
    const enumValues = getStringEnumValues(schema);
    if (enumValues === null) continue;
    if (enumValues.includes(val)) continue;
    const normalized = tryEnumNormalize(val, enumValues);
    if (normalized !== null) {
      input[name] = normalized;
      changedFields.push(name);
      return { repaired: input, changedFields };
    }
  }
  // 4. Schema alias resolution (unambiguous 1-to-1 only)
  const schemaNames = new Set(props.map((p) => p.name));
  const inputKeys = Object.keys(input);
  const missingFromInput = props
    .filter((p) => !(p.name in input) || input[p.name] === undefined)
    .map((p) => p.name);
  const extraInInput = inputKeys.filter((k) => !schemaNames.has(k));
  if (missingFromInput.length === 1 && extraInInput.length === 1) {
    const targetField = missingFromInput[0]!;
    const sourceField = extraInInput[0]!;
    input[targetField] = input[sourceField];
    delete input[sourceField];
    changedFields.push(sourceField, targetField);
    return { repaired: input, changedFields };
  }
  return { repaired: null, changedFields: [] };
}
/* ------------------------------------------------------------------ */
/*  Stage B: Model-assisted repair (stub)                              */
/* ------------------------------------------------------------------ */
function attemptModelRepair(
  _toolCall: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  _inputSchema: JSONSchema7,
): { repaired: Record<string, unknown> | null; changedFields: string[] } {
  return { repaired: null, changedFields: [] };
}
/* ------------------------------------------------------------------ */
/*  Main repair orchestrator                                           */
/* ------------------------------------------------------------------ */
function attemptRepair(
  toolCall: RepairableToolCall,
  parsedInput: Record<string, unknown>,
  inputSchema: JSONSchema7,
): RepairResult {
  const repairInput = {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: parsedInput,
  };
  const mechResult = attemptMechanicalRepair(repairInput, inputSchema);
  if (mechResult.repaired !== null) {
    return {
      stage: "deterministic",
      repaired: {
        ...toolCall,
        input: JSON.stringify(mechResult.repaired),
      },
      changedFields: mechResult.changedFields,
    };
  }
  const modelResult = attemptModelRepair(repairInput, inputSchema);
  if (modelResult.repaired !== null) {
    return {
      stage: "model",
      repaired: {
        ...toolCall,
        input: JSON.stringify(modelResult.repaired),
      },
      changedFields: modelResult.changedFields,
    };
  }
  return { stage: "none", repaired: null, changedFields: [] };
}
/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */
export function createRepairToolCall(params: {
  tools: ToolSet;
  state: RepairState;
  maxAttempts?: number;
  onTelemetry?: (event: RepairTelemetry) => void;
}): ToolCallRepairFunction<ToolSet> {
  const fn: ToolCallRepairFunction<ToolSet> = async (args) => {
    const tc = args.toolCall;
    const toolCallId = tc.toolCallId;
    const existingAttempts = params.state.repairAttempts.get(toolCallId) ?? 0;
    const maxAttempts = Number.isFinite(params.maxAttempts)
      ? Math.max(0, Math.trunc(params.maxAttempts ?? 0))
      : 1;

    params.state.invalidToolCallCount += 1;
    if (existingAttempts >= maxAttempts) return null;

    // Consume the per-call repair budget before any early return.
    params.state.repairAttempts.set(toolCallId, existingAttempts + 1);

    if (NoSuchToolError.isInstance(args.error)) {
      params.onTelemetry?.({
        toolName: tc.toolName,
        toolCallId,
        repairStage: "none",
        errorClass: "NoSuchToolError",
        repairAttempted: false,
        repairSucceeded: false,
        changedFieldNames: [],
        semanticFieldChanged: false,
      });
      return null;
    }

    const schema = await args.inputSchema({ toolName: tc.toolName });

    const parsedInput = parseRepairInput(tc.input);
    if (!parsedInput) return null;

    const result = attemptRepair(tc, parsedInput, schema);
    params.state.repairCount += 1;
    params.onTelemetry?.({
      toolName: tc.toolName,
      toolCallId,
      repairStage: result.stage,
      errorClass: "InvalidToolInputError",
      repairAttempted: true,
      repairSucceeded: result.repaired !== null,
      changedFieldNames: result.changedFields,
      semanticFieldChanged: false,
    });
    return result.repaired;
  };
  return fn;
}

function parseRepairInput(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
