import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { fetchProfileDetailApi, normalizePublicProfileAddress } from "@/lib/profile-detail";
import { resolveFollowerForRequest } from "@/lib/profile-follow-auth";
export const maxDuration = 30;
type Params = { params: Promise<{ address: string }> };
export async function GET(_req: NextRequest, { params }: Params) {
  const { address } = await params;
  const normalized = normalizePublicProfileAddress(address);
  try {
    const payload = await fetchProfileDetailApi(normalized);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[profiles/:address] GET error:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  const { address } = await params;
  const normalized = normalizePublicProfileAddress(address);
  const body = await req.json();
  const { callerAddress, username, displayName, bio, avatarUrl, twitterUrl, githubUrl, websiteUrl } = body;
  const session = await getServerSession(authOptions);
  const auth = await resolveFollowerForRequest(session, req, callerAddress);
  if (!auth.ok || auth.followerAddress !== normalized.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          auth.ok || auth.code === "mismatch"
            ? "Forbidden"
            : "Verify the connected wallet before editing this profile.",
        code: auth.ok || auth.code === "mismatch" ? "FORBIDDEN" : "WALLET_SESSION_REQUIRED",
      },
      { status: auth.ok || auth.code === "mismatch" ? 403 : 401 },
    );
  }
  if (username !== undefined && username !== null) {
    if (typeof username !== "string" || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Username must be 1-32 chars, alphanumeric, underscores, hyphens, or dots only" },
        { status: 400 },
      );
    }
    const existing = await prisma.userProfile.findUnique({ where: { username } });
    if (existing && existing.walletAddress?.toLowerCase() !== normalized.toLowerCase()) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
  }
  const profile = await prisma.userProfile.upsert({
    where: { walletAddress: normalized },
    update: {
      ...(username !== undefined && { username: username || null }),
      ...(displayName !== undefined && { displayName: displayName || null }),
      ...(bio !== undefined && { bio: String(bio).slice(0, 300) }),
      ...(avatarUrl !== undefined && { avatarUrl: String(avatarUrl).slice(0, 500) }),
      ...(twitterUrl !== undefined && { twitterUrl: String(twitterUrl).slice(0, 200) }),
      ...(githubUrl !== undefined && { githubUrl: String(githubUrl).slice(0, 200) }),
      ...(websiteUrl !== undefined && { websiteUrl: String(websiteUrl).slice(0, 200) }),
      updatedAt: new Date(),
    },
    create: {
      walletAddress: normalized,
      username: username || null,
      displayName: displayName || null,
      bio: bio ? String(bio).slice(0, 300) : "",
      avatarUrl: avatarUrl ? String(avatarUrl).slice(0, 500) : "",
      twitterUrl: twitterUrl ? String(twitterUrl).slice(0, 200) : "",
      githubUrl: githubUrl ? String(githubUrl).slice(0, 200) : "",
      websiteUrl: websiteUrl ? String(websiteUrl).slice(0, 200) : "",
    },
  });
  return NextResponse.json({ profile });
}
