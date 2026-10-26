import type {
  AgentChatErrorAction,
  AgentChatErrorCode,
} from "../shared/errors";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: AgentChatErrorCode,
    message: string,
    readonly retryable = false,
    readonly action?: AgentChatErrorAction,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
