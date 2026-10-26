import { NextRequest, NextResponse } from "next/server";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  assertPublicMetaplexLaunchEnabled,
  loadOpenPublicMetaplexAttempt,
  requirePublicMetaplexSolanaSession,
} from "@/lib/public-launch/metaplex-quick-launch.server";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  const enabled = assertPublicMetaplexLaunchEnabled();
  if (!enabled.ok) return jsonNoStore({ error: enabled.error }, { status: enabled.status });
  const session = await requirePublicMetaplexSolanaSession();
  if (!session.ok) return jsonNoStore({ error: session.error }, { status: session.status });
  try {
    const open = await loadOpenPublicMetaplexAttempt(
      session.creatorWallet,
      request.nextUrl.searchParams.get("attempt"),
    );
    if (!open) return jsonNoStore({ ok: true, attempt: null });
    return jsonNoStore({ ok: true, attempt: open });
  } catch (error) {
    console.error("[public-launch/metaplex/open]", error);
    return jsonNoStore({ error: error instanceof Error ? error.message : "Could not load open launch" }, { status: 400 });
  }
}