"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { McpContinuationResponse } from "../shared/contracts";

type JsonObject = Record<string, unknown>;

type FormRequest = {
  requestKey: string;
  type: "elicitation";
  mode: "form";
  message: string;
  requestedSchema: JsonObject;
};

type UrlRequest = {
  requestKey: string;
  type: "elicitation";
  mode: "url";
  message: string;
  url: string;
};

type ElicitationRequest = FormRequest | UrlRequest;

export type McpInputRequiredOutput = {
  ok: false;
  status: "input_required";
  continuationId: string;
  source?: {
    kind?: string;
    serverName?: string;
    operation?: string;
  };
  requests: ElicitationRequest[];
};

interface Props {
  output: McpInputRequiredOutput;
  disabled?: boolean;
  onSubmit?: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => void | Promise<void>;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function isMcpInputRequiredOutput(
  value: unknown,
): value is McpInputRequiredOutput {
  if (!isRecord(value)) return false;
  return (
    value.status === "input_required" &&
    typeof value.continuationId === "string" &&
    Array.isArray(value.requests)
  );
}

type FieldDefinition = {
  key: string;
  title: string;
  description?: string;
  required: boolean;
  schema: JsonObject;
};

function fieldsFor(request: FormRequest): FieldDefinition[] {
  const properties = isRecord(request.requestedSchema.properties)
    ? request.requestedSchema.properties
    : {};
  const required = new Set(
    Array.isArray(request.requestedSchema.required)
      ? request.requestedSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return Object.entries(properties).flatMap(([key, value]) => {
    if (!isRecord(value)) return [];
    return [
      {
        key,
        title:
          typeof value.title === "string" && value.title.trim()
            ? value.title
            : key,
        ...(typeof value.description === "string"
          ? { description: value.description }
          : {}),
        required: required.has(key),
        schema: value,
      },
    ];
  });
}

function fieldType(schema: JsonObject): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.enum)) return "string";
  return "unsupported";
}

function arrayItemType(schema: JsonObject): string {
  const items = isRecord(schema.items) ? schema.items : null;
  return items && typeof items.type === "string" ? items.type : "unsupported";
}

function enumOptionKey(value: string | number | boolean): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function finiteSchemaNumber(schema: JsonObject, key: string): number | undefined {
  const value = schema[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function schemaInteger(schema: JsonObject, key: string): number | undefined {
  const value = finiteSchemaNumber(schema, key);
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function validSchemaPattern(schema: JsonObject): string | undefined {
  if (schema.pattern === undefined) return undefined;
  if (typeof schema.pattern !== "string") return undefined;
  try {
    new RegExp(schema.pattern);
    return schema.pattern;
  } catch {
    return undefined;
  }
}

function isSupportedField(schema: JsonObject): boolean {
  const type = fieldType(schema);
  if (
    schema.pattern !== undefined &&
    (typeof schema.pattern !== "string" || validSchemaPattern(schema) === undefined)
  ) {
    return false;
  }
  if (Array.isArray(schema.enum)) {
    return (
      schema.enum.length > 0 &&
      schema.enum.every(
        (value) =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      )
    );
  }
  if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
    return true;
  }
  if (type === "array") {
    return ["string", "number", "integer", "boolean"].includes(
      arrayItemType(schema),
    );
  }
  return false;
}

function isSupportedFormSchema(request: FormRequest): boolean {
  const schema = request.requestedSchema;
  if (
    (schema.type !== undefined && schema.type !== "object") ||
    "$ref" in schema ||
    "oneOf" in schema ||
    "anyOf" in schema ||
    "allOf" in schema ||
    "if" in schema ||
    "then" in schema ||
    "else" in schema
  ) {
    return false;
  }
  if (!isRecord(schema.properties)) return false;
  const propertyKeys = new Set(Object.keys(schema.properties));
  if (
    Array.isArray(schema.required) &&
    schema.required.some(
      (key) => typeof key !== "string" || !propertyKeys.has(key),
    )
  ) {
    return false;
  }
  return Object.values(schema.properties).every(
    (field) => isRecord(field) && isSupportedField(field),
  );
}

function parseArray(raw: string, itemType: string): string[] | number[] | boolean[] {
  const items = raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (itemType === "number" || itemType === "integer") {
    return items.map((value) => Number(value));
  }
  if (itemType === "boolean") {
    return items.map((value) => value.toLowerCase() === "true");
  }
  return items;
}

function initialFieldValue(schema: JsonObject): string | boolean | undefined {
  const value = schema.default;
  if (Array.isArray(schema.enum)) {
    const match = schema.enum.find(
      (entry) =>
        (typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean") &&
        entry === value,
    );
    return match === undefined ? undefined : enumOptionKey(match);
  }
  const type = fieldType(schema);
  if (type === "boolean" && typeof value === "boolean") return value;
  if (
    (type === "number" || type === "integer") &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return String(value);
  }
  if (type === "string" && typeof value === "string") return value;
  if (type === "array" && Array.isArray(value)) {
    const itemType = arrayItemType(schema);
    if (
      value.every((entry) =>
        itemType === "string"
          ? typeof entry === "string"
          : itemType === "boolean"
            ? typeof entry === "boolean"
            : typeof entry === "number" && Number.isFinite(entry),
      )
    ) {
      return value.map(String).join(", ");
    }
  }
  return undefined;
}

function initialFormValues(
  forms: readonly FormRequest[],
): Record<string, Record<string, string | boolean>> {
  const values: Record<string, Record<string, string | boolean>> = {};
  for (const request of forms) {
    const requestValues: Record<string, string | boolean> = {};
    for (const field of fieldsFor(request)) {
      const initial = initialFieldValue(field.schema);
      if (initial !== undefined) requestValues[field.key] = initial;
    }
    if (Object.keys(requestValues).length > 0) {
      values[request.requestKey] = requestValues;
    }
  }
  return values;
}

function coerceFieldValue(
  schema: JsonObject,
  raw: string | boolean,
): string | number | boolean | string[] | number[] | boolean[] {
  if (Array.isArray(schema.enum) && typeof raw === "string") {
    const match = schema.enum.find(
      (value) =>
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean") &&
        enumOptionKey(value) === raw,
    );
    if (
      typeof match === "string" ||
      typeof match === "number" ||
      typeof match === "boolean"
    ) {
      return match;
    }
  }
  const type = fieldType(schema);
  if (type === "boolean") return raw === true;
  if (type === "number" || type === "integer") return Number(raw);
  if (type === "array") return parseArray(String(raw), arrayItemType(schema));
  return String(raw);
}

function fieldValueIsValid(
  schema: JsonObject,
  raw: string | boolean,
): boolean {
  if (Array.isArray(schema.enum)) {
    if (typeof raw !== "string") return false;
    const match = schema.enum.find(
      (value) =>
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean") &&
        enumOptionKey(value) === raw,
    );
    if (match === undefined) return false;
    const schemaWithoutEnum = { ...schema };
    delete schemaWithoutEnum.enum;
    if (schema.type === undefined) return true;
    return fieldValueIsValid(
      schemaWithoutEnum,
      typeof match === "boolean" ? match : String(match),
    );
  }
  const type = fieldType(schema);
  if (type === "boolean") return typeof raw === "boolean";
  if (type === "number" || type === "integer") {
    if (typeof raw !== "string" || !raw.trim()) return false;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || (type === "integer" && !Number.isInteger(numeric))) {
      return false;
    }
    const minimum = finiteSchemaNumber(schema, "minimum");
    const maximum = finiteSchemaNumber(schema, "maximum");
    const exclusiveMinimum = finiteSchemaNumber(schema, "exclusiveMinimum");
    const exclusiveMaximum = finiteSchemaNumber(schema, "exclusiveMaximum");
    const multipleOf = finiteSchemaNumber(schema, "multipleOf");
    if (minimum !== undefined && numeric < minimum) return false;
    if (maximum !== undefined && numeric > maximum) return false;
    if (exclusiveMinimum !== undefined && numeric <= exclusiveMinimum) return false;
    if (exclusiveMaximum !== undefined && numeric >= exclusiveMaximum) return false;
    if (multipleOf !== undefined && multipleOf > 0) {
      const quotient = numeric / multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return false;
    }
    return true;
  }
  if (type === "array") {
    if (typeof raw !== "string") return false;
    const itemType = arrayItemType(schema);
    const items = raw
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const minItems = schemaInteger(schema, "minItems");
    const maxItems = schemaInteger(schema, "maxItems");
    if (minItems !== undefined && items.length < minItems) return false;
    if (maxItems !== undefined && items.length > maxItems) return false;
    if (schema.uniqueItems === true && new Set(items).size !== items.length) {
      return false;
    }
    if (itemType === "number" || itemType === "integer") {
      return items.every((value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric)
          && (itemType !== "integer" || Number.isInteger(numeric));
      });
    }
    if (itemType === "boolean") {
      return items.every((value) => {
        const normalized = value.toLowerCase();
        return normalized === "true" || normalized === "false";
      });
    }
    return itemType === "string";
  }
  if (type === "string" && typeof raw === "string") {
    const minLength = schemaInteger(schema, "minLength");
    const maxLength = schemaInteger(schema, "maxLength");
    if (minLength !== undefined && raw.length < minLength) return false;
    if (maxLength !== undefined && raw.length > maxLength) return false;
    const pattern = validSchemaPattern(schema);
    if (pattern !== undefined && !new RegExp(pattern).test(raw)) return false;
    return true;
  }
  return false;
}

function FormField({
  field,
  value,
  disabled,
  invalid,
  onChange,
}: {
  field: FieldDefinition;
  value: string | boolean | undefined;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const type = fieldType(field.schema);
  const enumValues = Array.isArray(field.schema.enum)
    ? field.schema.enum.filter(
        (entry): entry is string | number | boolean =>
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean",
      )
    : null;
  const minLength = schemaInteger(field.schema, "minLength");
  const maxLength = schemaInteger(field.schema, "maxLength");
  const minimum = finiteSchemaNumber(field.schema, "minimum");
  const maximum = finiteSchemaNumber(field.schema, "maximum");
  const multipleOf = finiteSchemaNumber(field.schema, "multipleOf");
  const pattern = validSchemaPattern(field.schema);
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">
        {field.title}
        {field.required ? <span className="text-amber-400"> *</span> : null}
      </span>
      {field.description ? (
        <span className="block text-[11px] leading-relaxed text-muted-foreground">
          {field.description}
        </span>
      ) : null}
      {enumValues ? (
        <select
          value={typeof value === "string" ? value : String(value ?? "")}
          disabled={disabled}
          required={field.required}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-[#2b2b2b] bg-[#111] px-2.5 text-xs text-foreground outline-none focus-visible:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-500/40 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/30"
        >
          <option value="">Select…</option>
          {enumValues.map((entry) => {
            const optionKey = enumOptionKey(entry);
            return (
              <option key={optionKey} value={optionKey}>
                {String(entry)}
              </option>
            );
          })}
        </select>
      ) : type === "boolean" ? (
        <span className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 rounded border-[#3a3a3a] bg-[#111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111]"
          />
          Enabled
        </span>
      ) : type === "array" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          required={field.required}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Comma-separated values"
          rows={2}
          className="w-full rounded-md border border-[#2b2b2b] bg-[#111] px-2.5 py-2 font-mono text-xs text-foreground outline-none focus-visible:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-500/40 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/30"
        />
      ) : (
        <input
          type={type === "number" || type === "integer" ? "number" : "text"}
          step={
            type === "number" || type === "integer"
              ? multipleOf && multipleOf > 0
                ? multipleOf
                : type === "integer"
                  ? 1
                  : "any"
              : undefined
          }
          min={type === "number" || type === "integer" ? minimum : undefined}
          max={type === "number" || type === "integer" ? maximum : undefined}
          minLength={type === "string" ? minLength : undefined}
          maxLength={type === "string" ? maxLength : undefined}
          pattern={type === "string" ? pattern : undefined}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          required={field.required}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-[#2b2b2b] bg-[#111] px-2.5 text-xs text-foreground outline-none focus-visible:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-500/40 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/30"
        />
      )}
      {invalid ? (
        <span className="block text-[11px] leading-relaxed text-destructive" role="alert">
          This value does not match the field constraints.
        </span>
      ) : null}
    </label>
  );
}

export function McpElicitationCard({ output, disabled = false, onSubmit }: Props) {
  const forms = useMemo(
    () => output.requests.filter((request): request is FormRequest => request.mode === "form"),
    [output.requests],
  );
  const urls = useMemo(
    () => output.requests.filter((request): request is UrlRequest => request.mode === "url"),
    [output.requests],
  );
  const fields = useMemo(
    () =>
      forms.map((request) => ({
        request,
        fields: fieldsFor(request),
      })),
    [forms],
  );
  const [values, setValues] = useState<Record<string, Record<string, string | boolean>>>(() =>
    initialFormValues(forms),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const unsupported = forms.some((request) => !isSupportedFormSchema(request));

  const submit = async (action: "accept" | "decline" | "cancel") => {
    if (!onSubmit || disabled || submitting) return;
    const responses: McpContinuationResponse[] = output.requests.map((request) => {
      if (action !== "accept" || request.mode !== "form") {
        return { requestKey: request.requestKey, action };
      }
      const content: NonNullable<McpContinuationResponse["content"]> = {};
      for (const field of fieldsFor(request)) {
        const raw = values[request.requestKey]?.[field.key];
        if (raw === undefined || raw === "") {
          if (field.required) {
            const type = fieldType(field.schema);
            if (type === "boolean") content[field.key] = false;
            else if (type === "string" && !Array.isArray(field.schema.enum)) {
              content[field.key] = "";
            } else if (type === "array") {
              const itemType = arrayItemType(field.schema);
              content[field.key] = itemType === "number" || itemType === "integer"
                ? [] as number[]
                : itemType === "boolean"
                  ? [] as boolean[]
                  : [] as string[];
            }
          }
          continue;
        }
        content[field.key] = coerceFieldValue(field.schema, raw);
      }
      return { requestKey: request.requestKey, action, content };
    });
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit({ continuationId: output.continuationId, responses });
    } catch {
      setSubmitError(
        "Could not submit this MCP response. Your input is still here; try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const missingRequired = fields.some(({ request, fields: requestFields }) =>
    requestFields.some((field) => {
      if (!field.required) return false;
      const value = values[request.requestKey]?.[field.key];
      const type = fieldType(field.schema);
      if (type === "boolean") return false;
      if (value === undefined || typeof value !== "string") return true;
      if (type === "array") {
        return parseArray(value, arrayItemType(field.schema)).length === 0;
      }
      return value.trim().length === 0;
    }),
  );
  const invalidValues = fields.some(({ request, fields: requestFields }) =>
    requestFields.some((field) => {
      const value = values[request.requestKey]?.[field.key];
      if (value === undefined || value === "") return false;
      return !fieldValueIsValid(field.schema, value);
    }),
  );

  return (
    <div className="space-y-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">MCP input required</p>
        {output.source?.serverName ? (
          <p className="text-[11px] text-muted-foreground">
            {output.source.serverName} is waiting for your response.
          </p>
        ) : null}
      </div>

      {fields.map(({ request, fields: requestFields }) => (
        <div key={request.requestKey} className="space-y-3">
          <p className="text-xs leading-relaxed text-neutral-200">{request.message}</p>
          {!isSupportedFormSchema(request) ? (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive"
              role="alert"
            >
              This form uses JSON Schema features that cannot be submitted safely by the chat UI. Decline or cancel the request.
            </div>
          ) : requestFields.map((field) =>
            isSupportedField(field.schema) ? (
              <FormField
                key={field.key}
                field={field}
                value={values[request.requestKey]?.[field.key]}
                disabled={disabled || submitting}
                invalid={(() => {
                  const value = values[request.requestKey]?.[field.key];
                  return value !== undefined && value !== ""
                    ? !fieldValueIsValid(field.schema, value)
                    : false;
                })()}
                onChange={(value) => {
                  setSubmitError(null);
                  setValues((current) => ({
                    ...current,
                    [request.requestKey]: {
                      ...current[request.requestKey],
                      [field.key]: value,
                    },
                  }));
                }}
              />
            ) : (
              <div
                key={field.key}
                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive"
                role="alert"
              >
                {field.title}: this schema field cannot be submitted by the chat UI.
              </div>
            ),
          )}
        </div>
      ))}

      {urls.map((request) => {
        const safeUrl = safeHttpUrl(request.url);
        return (
          <div key={request.requestKey} className="space-y-2">
            <p className="text-xs leading-relaxed text-neutral-200">
              {request.message}
            </p>
            <p className="break-all rounded-md border border-[#2b2b2b] bg-[#111] p-2 font-mono text-[11px] text-neutral-300">
              {request.url}
            </p>
            {safeUrl ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                asChild
                className="border-[#2b2b2b] bg-[#181818] text-neutral-200 hover:bg-[#212121]"
              >
                <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                  Open <ExternalLink aria-hidden className="ml-1 size-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            ) : (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-relaxed text-destructive"
                role="alert"
              >
                This MCP server supplied a URL with an unsupported scheme. It
                cannot be opened from chat.
              </p>
            )}
          </div>
        );
      })}

      {submitError ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-relaxed text-destructive"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}
      {!unsupported && (missingRequired || invalidValues) ? (
        <p className="text-[11px] leading-relaxed text-amber-300" role="status">
          {missingRequired
            ? "Complete the required fields before submitting."
            : "Correct the invalid field values before submitting."}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || submitting || unsupported || missingRequired || invalidValues || !onSubmit}
          onClick={() => void submit("accept")}
          className="bg-neutral-100 text-neutral-950 hover:bg-white"
        >
          {submitting ? "Submitting…" : urls.length > 0 && forms.length === 0 ? "Continue" : "Submit"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || submitting || !onSubmit}
          onClick={() => void submit("decline")}
          className="border-[#2b2b2b] bg-[#181818] text-neutral-200 hover:bg-[#212121]"
        >
          Decline
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || submitting || !onSubmit}
          onClick={() => void submit("cancel")}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
