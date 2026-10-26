import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { HttpBodyTooLargeError, parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { sendAgentTalkMessage } from "@/lib/public-site/agent-talk.server";
import { agentTalkUnavailableMessage } from "@/lib/public-site/agent-talk-target";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";

export const maxDuration = 15;

const TalkBodySchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const limited = await rateLimitPublicApi(request, "probe");
  if (limited) return limited;

  const { chainId, agentId: rawAgentId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  const agentIdNum = parsePublicAgentId(rawAgentId);
  if (chainIdNum == null || agentIdNum == null) {
    return NextResponse.json({ ok: false, message: "Invalid agent reference." }, { status: 400 });
  }

  let body: z.infer<typeof TalkBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, TalkBodySchema, 8 * 1024);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: agentTalkUnavailableMessage("invalid_message"),
      },
      { status: error instanceof HttpBodyTooLargeError ? 413 : 400 },
    );
  }

  const result = await sendAgentTalkMessage(chainIdNum, agentIdNum, body.message);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: result.reason === "invalid_message" ? 400 : 503 },
    );
  }

  return NextResponse.json({ ok: true, reply: result.reply });
}
