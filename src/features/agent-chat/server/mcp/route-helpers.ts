import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  mcpErrorCode,
  mcpErrorHttpStatus,
  McpRuntimeError,
  safeMcpErrorDetails,
} from "./errors";

export function parsePositiveAgentId(raw: string): number {
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "Invalid agent ID");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "Invalid agent ID");
  }
  return value;
}

export function mcpApiError(error: unknown, fallback = "MCP request failed"): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: {
        code: "MCP_CONFIGURATION_INVALID",
        message: "Invalid MCP request",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    }, { status: 400 });
  }
  const code = mcpErrorCode(error);
  const message = error instanceof McpRuntimeError
    ? safeMcpErrorDetails(error).message
    : fallback;
  return NextResponse.json({
    error: { code, message },
  }, { status: mcpErrorHttpStatus(error) });
}
