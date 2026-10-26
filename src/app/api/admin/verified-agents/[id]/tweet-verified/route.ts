import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { buildVerifiedAnnouncementText } from "@/lib/agent-twitter-handle";
import { renderVerifiedCardPng } from "@/lib/verified-agent-card-image";
import {
  assertOAuth1CredentialsForMedia,
  assertPostingCredentialsConfigured,
  postVerifiedTweetWithCard,
} from "@/lib/x/twitter-post";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/**
 * POST /api/admin/verified-agents/[id]/tweet-verified
 * Admin-only: post verified announcement + gold card to X (@agentranking).
 *
 * Env: OAuth 1.0a quartet required for media upload;
 * tweet text via OAuth1 or X_OAUTH2_USER_ACCESS_TOKEN.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    assertOAuth1CredentialsForMedia();
    assertPostingCredentialsConfigured();
  } catch (err) {
    console.error("[tweet-verified] X credentials:", err);
    return NextResponse.json(
      { error: "X API is not configured on this server. Set OAuth 1.0a keys for media and posting." },
      { status: 503 }
    );
  }
  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        agentId: true,
        chainId: true,
        isVerified: true,
        isPremiumVerified: true,
        metadata: { select: { key: true, value: true }, take: 50 },
        services: { select: { name: true, endpoint: true }, take: 30 },
      },
    });
    if (!agent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!agent.isVerified && !agent.isPremiumVerified) {
      return NextResponse.json(
        { error: "Agent is not verified or premium verified; nothing to announce." },
        { status: 400 }
      );
    }
    const text = buildVerifiedAnnouncementText(agent);
    if (text.length > 280) {
      return NextResponse.json(
        { error: "Generated tweet text exceeds 280 characters; shorten agent metadata or name." },
        { status: 400 }
      );
    }
    const png = await renderVerifiedCardPng(agent.name);
    const { tweetId, url } = await postVerifiedTweetWithCard(text, png);
    return NextResponse.json({ ok: true, tweetId, url });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Unknown error";
    console.error("[tweet-verified] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
