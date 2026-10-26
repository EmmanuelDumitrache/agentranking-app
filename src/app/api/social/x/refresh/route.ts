import { NextRequest, NextResponse } from "next/server";
import { refreshXLatestPosts } from "@/lib/social/x-latest-posts";
import { isInternalBearerSecretConfigured, verifyInternalBearer } from "@/lib/internal-bearer-auth";
export const maxDuration = 60;
function authorize(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === "development") return null;
  const refreshSecret = process.env.X_POSTS_REFRESH_SECRET?.trim() ?? "";
  if (!isInternalBearerSecretConfigured(refreshSecret)) {
    return NextResponse.json({ ok: false, error: "X refresh is not configured" }, { status: 503 });
  }
  if (verifyInternalBearer(request.headers.get("authorization"), refreshSecret)) return null;
  return NextResponse.json(
    {
      ok: false,
      error:
        "Requires Authorization: Bearer X_POSTS_REFRESH_SECRET (not allowed on profile page views).",
    },
    { status: 403 },
  );
}
/**
 * POST /api/social/x/refresh — controlled X posts refresh (writes xLatestPosts metadata).
 * Body: { chainId: number, agentId: number, force?: boolean }
 */
export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: { chainId?: number; agentId?: number; force?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chainId = Number(body.chainId);
  const agentId = Number(body.agentId);
  if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) {
    return NextResponse.json(
      { ok: false, error: "chainId and agentId are required numbers" },
      { status: 400 },
    );
  }
  const result = await refreshXLatestPosts(chainId, agentId, { force: body.force === true });
  return NextResponse.json(result, {
    status: result.ok || result.skipped ? 200 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}
