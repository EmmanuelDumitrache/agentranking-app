import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveFollowerForRequest } from "@/lib/profile-follow-auth";
import { isAddress } from "viem";
function normalizeFollowing(raw: string): string {
  return raw.trim().toLowerCase();
}
async function mutateFollow(
  follower: string,
  following: string,
  action: "follow" | "unfollow",
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const address of [...new Set([follower, following])].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`profile-follow:${address}`}, 0))`;
    }
    if (action === "follow") {
      await tx.profileFollow.upsert({
        where: {
          followerAddress_followingAddress: { followerAddress: follower, followingAddress: following },
        },
        create: { followerAddress: follower, followingAddress: following },
        update: {},
      });
    } else {
      await tx.profileFollow.deleteMany({
        where: { followerAddress: follower, followingAddress: following },
      });
    }
    await tx.$executeRaw`
      UPDATE "UserProfile" SET "followersCount" = (
        SELECT COUNT(*)::int FROM "ProfileFollow" WHERE "followingAddress" = LOWER(${following})
      ) WHERE LOWER("walletAddress") = LOWER(${following})
    `;
    await tx.$executeRaw`
      UPDATE "UserProfile" SET "followingCount" = (
        SELECT COUNT(*)::int FROM "ProfileFollow" WHERE "followerAddress" = LOWER(${follower})
      ) WHERE LOWER("walletAddress") = LOWER(${follower})
    `;
  });
}
export async function POST(request: NextRequest) {
  try {
    let body: {
      followerAddress?: string;
      followingAddress?: string;
      action?: string;
    };
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      body = parsed as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { followingAddress, action, followerAddress: bodyFollower } = body;
    if (!followingAddress || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (action !== "follow" && action !== "unfollow") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const session = await getServerSession(authOptions);
    const auth = await resolveFollowerForRequest(session, request, bodyFollower);
    if (!auth.ok) {
      if (auth.code === "mismatch") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json(
        {
          error:
            auth.code === "session_required"
              ? "Verify the connected wallet before following builders."
              : "Connect a wallet to follow builders.",
          code: auth.code === "session_required" ? "WALLET_SESSION_REQUIRED" : "NO_WALLET",
        },
        { status: auth.code === "session_required" ? 401 : 400 },
      );
    }
    const follower = auth.followerAddress;
    const following = normalizeFollowing(followingAddress);
    if (follower === following) {
      return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
    }
    await mutateFollow(follower, following, action);
    return NextResponse.json({ followed: action === "follow" });
  } catch (err) {
    console.error("[profiles/follow] Error:", err);
    return NextResponse.json({ error: "Failed to process follow" }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const following = request.nextUrl.searchParams.get("following");
  const followerParam = request.nextUrl.searchParams.get("follower");
  if (!following) {
    return NextResponse.json({ error: "Missing following param" }, { status: 400 });
  }
  const follower = followerParam?.trim().toLowerCase() ?? "";
  if (!isAddress(follower)) {
    return NextResponse.json({ isFollowing: false });
  }
  const record = await prisma.profileFollow.findUnique({
    where: {
      followerAddress_followingAddress: {
        followerAddress: follower,
        followingAddress: normalizeFollowing(following),
      },
    },
  });
  return NextResponse.json({ isFollowing: !!record });
}
