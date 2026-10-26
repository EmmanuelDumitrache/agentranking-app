import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AgentChatAccessError } from "./access-error";
import type {
  AgentChatErrorAction,
  AgentChatErrorCode,
  AgentChatErrorResponse,
} from "../shared/errors";
import { HttpError } from "./http-error";
export { HttpError } from "./http-error";
import { Prisma } from "@/generated/prisma/client";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
export const CHAT_MAX_REQUEST_BYTES = 2_100_000;
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = CHAT_MAX_REQUEST_BYTES,
): Promise<T> {
  try {
    return schema.parse(await readBoundedJsonBody(request, maxBytes));
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      throw new HttpError(413, "INVALID_MESSAGE", "Request is too large");
    }
    if (
      error instanceof InvalidJsonBodyError ||
      error instanceof InvalidHttpBodyEncodingError
    ) {
      throw new HttpError(400, "INVALID_MESSAGE", "Invalid JSON body");
    }
    throw error;
  }
}
export function routeError(
  error: unknown,
  requestId = crypto.randomUUID(),
): NextResponse {
  let status = 500;
  let code: AgentChatErrorCode = "INTERNAL";
  let message = "The chat service could not complete the request.";
  let retryable = true;
  let action: AgentChatErrorAction | undefined;
  if (error instanceof HttpError) {
    ({ status, code, message, retryable, action } = error);
  } else if (error instanceof AgentChatAccessError) {
    status = error.status;
    code = error.code as AgentChatErrorCode;
    message = error.message;
    retryable = error.retryable;
    action = error.action;
  } else if (error instanceof ZodError) {
    status = 400;
    code = "INVALID_MESSAGE";
    message = error.issues[0]?.message ?? "Invalid request";
    retryable = false;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      status = 404;
      code = "CONVERSATION_NOT_FOUND";
      message = "The requested chat resource was not found.";
      retryable = false;
    } else if (error.code === "P2002") {
      status = 409;
      code = "INVALID_MESSAGE";
      message = "The request conflicts with an existing chat resource.";
      retryable = false;
    } else {
      console.error("[agent-chat] database failure", {
        requestId,
        prismaCode: error.code,
      });
    }
  } else {
    console.error("[agent-chat] route failure", { requestId, error: safeErrorDetails(error) });
  }
  const body: AgentChatErrorResponse = {
    error: { code, message, retryable, action },
    requestId,
  };
  return NextResponse.json(body, { status });
}
