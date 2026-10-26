import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { handleChatStream } from "@/features/agent-chat/server/run/stream-run";
import { checkChatRateLimit } from "@/features/agent-chat/server/rate-limit";
import {
  validateInboundAgentChatUserMessage,
} from "@/features/agent-chat/server/inbound-user-message";
import {
  parseJsonBody,
  routeError,
  HttpError,
} from "@/features/agent-chat/server/http";
import {
  agentChatStreamRequestSchema,
  agentDbIdSchema,
} from "@/features/agent-chat/shared/schemas";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  let requestId: string | undefined;
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const parsedBody = await parseJsonBody(request, agentChatStreamRequestSchema);
    requestId = parsedBody.requestId;
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
    );
    const rateLimit = await checkChatRateLimit(access.appAccountId);
    if (rateLimit && !rateLimit.allowed) {
      throw new HttpError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again shortly.",
        true,
      );
    }
    const body =
      parsedBody.kind === "tool-approval" || parsedBody.kind === "mcp-continuation"
        ? parsedBody
        : {
            ...parsedBody,
            message: await validateInboundAgentChatUserMessage(parsedBody.message),
          };
    return await handleChatStream(body, access, request.signal);
  } catch (error) {
    const response = routeError(error, requestId);
    if (response.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}