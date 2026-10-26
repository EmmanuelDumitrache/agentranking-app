import { toPublicError, type AgentChatErrorCode } from "../shared/errors";

export class AgentChatAccessError extends Error {
  public readonly status: number;
  public readonly code: AgentChatErrorCode;
  public readonly retryable: boolean;
  public readonly action?:
    | "SIGN_IN"
    | "OPEN_TOP_UP"
    | "SELECT_MODEL"
    | "RETRY"
    | "REFRESH";

  constructor(
    status: number,
    code: AgentChatErrorCode,
    message: string,
    retryable = false,
    action?: AgentChatAccessError["action"],
  ) {
    super(message);
    this.name = "AgentChatAccessError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.action = action;
  }

  toPublic() {
    return toPublicError(
      this.status,
      this.code,
      this.message,
      this.retryable,
      this.action,
    );
  }
}
