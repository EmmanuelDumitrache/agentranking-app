export type AgentChatErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "AGENT_NOT_FOUND"
  | "CHAT_DISABLED"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_LIMIT"
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_ACTIVE"
  | "RUN_NOT_CANCELLABLE"
  | "INVALID_MESSAGE"
  | "INVALID_MODEL"
  | "MODEL_UNAVAILABLE"
  | "MODEL_CAPABILITY_MISMATCH"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_QUOTA_EXHAUSTED"
  | "PROVIDER_BILLING_FAILED"
  | "PROVIDER_PERMISSION_DENIED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_MODEL_NOT_FOUND"
  | "PROVIDER_REQUEST_INVALID"
  | "PROVIDER_UNAVAILABLE"
  | "CONTEXT_TOO_LARGE"
  | "TOOL_FAILED"
  | "REQUEST_CANCELLED"
  | "DEPOSIT_NOT_FOUND"
  | "DEPOSIT_EXPIRED"
  | "DEPOSIT_VALIDATION_FAILED"
  | "INTERNAL";
export type AgentChatErrorAction =
  | "SIGN_IN"
  | "OPEN_TOP_UP"
  | "OPEN_SETTINGS"
  | "SELECT_MODEL"
  | "RETRY"
  | "REFRESH";
export type AgentChatPublicError = {
  code: AgentChatErrorCode;
  message: string;
  retryable: boolean;
  action?: AgentChatErrorAction;
};
export type AgentChatErrorResponse = {
  error: AgentChatPublicError;
  requestId: string;
};
export class AgentChatApiError extends Error {
  constructor(
    readonly code: AgentChatErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly action?: AgentChatErrorAction,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AgentChatApiError";
  }
}
export function toPublicError(
  status: number,
  code: AgentChatErrorCode,
  message: string,
  retryable: boolean,
  action?: AgentChatErrorAction,
): AgentChatPublicError {
  return { code, message, retryable, action };
}
export function publicErrorFromStoredFailure(
  code: string | null | undefined,
  message: string | null | undefined,
): AgentChatPublicError | undefined {
  if (!code || !message) return undefined;
  const known = code as AgentChatErrorCode;
  switch (known) {
    case "PROVIDER_QUOTA_EXHAUSTED":
      return toPublicError(429, known, message, false, "SELECT_MODEL");
    case "PROVIDER_BILLING_FAILED":
      return toPublicError(402, known, message, false, "OPEN_SETTINGS");
    case "PROVIDER_PERMISSION_DENIED":
      return toPublicError(403, known, message, false, "SELECT_MODEL");
    case "PROVIDER_MODEL_NOT_FOUND":
    case "PROVIDER_REQUEST_INVALID":
    case "INVALID_MODEL":
    case "MODEL_UNAVAILABLE":
    case "MODEL_CAPABILITY_MISMATCH":
      return toPublicError(400, known, message, false, "SELECT_MODEL");
    case "CONTEXT_TOO_LARGE":
      return toPublicError(413, known, message, false, "SELECT_MODEL");
    case "PROVIDER_AUTH_FAILED":
    case "CHAT_DISABLED":
      return toPublicError(403, known, message, false, "OPEN_SETTINGS");
    case "INSUFFICIENT_CREDITS":
      return toPublicError(402, known, message, false, "OPEN_TOP_UP");
    case "PROVIDER_RATE_LIMITED":
    case "RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
      return toPublicError(503, known, message, true, "RETRY");
    case "RUN_ALREADY_ACTIVE":
      return toPublicError(409, known, message, true, "REFRESH");
    case "REQUEST_CANCELLED":
      return toPublicError(499, known, message, false);
    default:
      if (([
        "UNAUTHORIZED", "FORBIDDEN", "AGENT_NOT_FOUND", "CONVERSATION_NOT_FOUND",
        "CONVERSATION_LIMIT", "RUN_NOT_FOUND", "RUN_NOT_CANCELLABLE", "INVALID_MESSAGE",
        "TOOL_FAILED", "DEPOSIT_NOT_FOUND", "DEPOSIT_EXPIRED",
        "DEPOSIT_VALIDATION_FAILED", "INTERNAL",
      ] as string[]).includes(known)) {
        return toPublicError(500, known, message, false);
      }
      return undefined;
  }
}

export function parseAgentChatPublicError(error: unknown): AgentChatPublicError | undefined {
  if (error instanceof AgentChatApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.action ? { action: error.action } : {}),
    };
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message.trim().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(message) as { error?: unknown };
    if (!parsed.error || typeof parsed.error !== "object" || Array.isArray(parsed.error)) return undefined;
    const value = parsed.error as Record<string, unknown>;
    if (typeof value.code !== "string" || typeof value.message !== "string" || typeof value.retryable !== "boolean") {
      return undefined;
    }
    const action = typeof value.action === "string" ? value.action as AgentChatErrorAction : undefined;
    return {
      code: value.code as AgentChatErrorCode,
      message: value.message,
      retryable: value.retryable,
      ...(action ? { action } : {}),
    };
  } catch {
    return undefined;
  }
}
