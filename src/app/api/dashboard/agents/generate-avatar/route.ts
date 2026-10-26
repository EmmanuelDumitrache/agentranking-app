import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateAndStoreAgentAvatar } from "@/lib/dashboard/agent-avatar-generate";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getClientIp } from "@/lib/public-api-rate-limit";
import { slidingWindowLimitMany } from "@/lib/valkey";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_NAME = 80;
const MAX_PERSONA = 280;

async function rateLimitGenerateAvatar(
  request: NextRequest,
  profileId: number,
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const rules = [
    {
      key: `ratelimit:agent-avatar-gen:profile:${profileId}`,
      limit: 8,
      windowMs: 15 * 60_000,
    },
    ...(ip !== "unknown"
      ? [{
          key: `ratelimit:agent-avatar-gen:ip:${ip}`,
          limit: 20,
          windowMs: 15 * 60_000,
        }]
      : []),
  ];
  const result = await slidingWindowLimitMany(rules);
  if (result.success) return null;
  const reset = Math.max(...result.results.map((entry) => entry.reset));
  const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many avatar generations. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Profile required" }, { status: 403 });
  }
  const limited = await rateLimitGenerateAvatar(request, profile.id);
  if (limited) return limited;

  let body: { agentName?: unknown; persona?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const agentName =
    typeof body.agentName === "string" ? body.agentName.trim().slice(0, MAX_NAME) : "";
  const persona =
    typeof body.persona === "string" ? body.persona.trim().slice(0, MAX_PERSONA) : "";
  try {
    const result = await generateAndStoreAgentAvatar({ agentName, persona });
    return NextResponse.json({
      url: result.url,
      publicUrl: result.publicUrl,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    console.error("[generate-avatar]", error);
    return NextResponse.json(
      { error: "Could not generate an avatar. Try again or upload your own." },
      { status: 502 },
    );
  }
}
