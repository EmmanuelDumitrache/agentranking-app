import { NextRequest, NextResponse } from "next/server";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  assertPublicMetaplexLaunchEnabled,
  getPublicMetaplexFundingStatus,
  requirePublicMetaplexSolanaSession,
} from "@/lib/public-launch/metaplex-quick-launch.server";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
type RouteContext = { params: Promise<{ attemptId: string }> };
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
export async function GET(request: NextRequest, context: RouteContext) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  const enabled = assertPublicMetaplexLaunchEnabled();
  if (!enabled.ok) return jsonNoStore({ error: enabled.error }, { status: enabled.status });
  const session = await requirePublicMetaplexSolanaSession();
  if (!session.ok) return jsonNoStore({ error: session.error }, { status: session.status });
  const { attemptId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(attemptId)) return jsonNoStore({ error: "Invalid attempt id" }, { status: 400 });
  try {
    const result = await getPublicMetaplexFundingStatus({ attemptId, creatorWallet: session.creatorWallet });
    return jsonNoStore({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Funding status failed";
    const status = message.includes("authorized") ? 403 : message.includes("not found") ? 404 : 400;
    return jsonNoStore({ error: message }, { status });
  }
}
