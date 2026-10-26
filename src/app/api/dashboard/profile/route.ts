import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { subscriptionPatchFromDonor } from "@/lib/merge-dashboard-wallet";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
function bodyToScalarPatch(body: {
  displayName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  websiteUrl?: string;
}): Prisma.UserProfileUpdateInput {
  const data: Prisma.UserProfileUpdateInput = {};
  if (body.displayName !== undefined) data.displayName = String(body.displayName).trim().slice(0, 100) || null;
  if (body.username !== undefined) {
    data.username = String(body.username).trim().slice(0, 50).toLowerCase().replace(/[^a-z0-9_-]/g, "") || null;
  }
  if (body.bio !== undefined) data.bio = String(body.bio).trim().slice(0, 500);
  if (body.avatarUrl !== undefined) data.avatarUrl = String(body.avatarUrl).trim().slice(0, 500);
  if (body.twitterUrl !== undefined) data.twitterUrl = String(body.twitterUrl).trim().slice(0, 200);
  if (body.githubUrl !== undefined) data.githubUrl = String(body.githubUrl).trim().slice(0, 200);
  if (body.websiteUrl !== undefined) data.websiteUrl = String(body.websiteUrl).trim().slice(0, 200);
  return data;
}
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json(
      {
        profile: null,
        needsOnboarding: true,
        message:
          "No Agent Dashboard profile could be linked to this session. Verify an agent or sign in with a wallet that is already on your profile.",
      },
      { status: 200 }
    );
  }
  const full = await prisma.userProfile.findUnique({
    where: { id: profile.id },
    select: {
      id: true,
      email: true,
      walletAddress: true,
      displayName: true,
      username: true,
      avatarUrl: true,
      bio: true,
      twitterUrl: true,
      githubUrl: true,
      websiteUrl: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      subscriptionExpiresAt: true,
      subscriptionStartedAt: true,
      isClaimed: true,
    },
  });
  return NextResponse.json({ profile: full });
}
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      displayName?: string;
      username?: string;
      bio?: string;
      avatarUrl?: string;
      twitterUrl?: string;
      githubUrl?: string;
      websiteUrl?: string;
      walletAddress?: string;
    };
    const primary = await ensureMinimalUserProfile(session);
    if (!primary) {
      return NextResponse.json(
        {
          error:
            "No Agent Dashboard profile could be created for this session. Try verifying an agent first, or contact support.",
          code: "NO_PROFILE",
        },
        { status: 400 }
      );
    }
    const primaryRow = await prisma.userProfile.findUnique({
      where: { id: primary.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        walletAddress: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        subscriptionExpiresAt: true,
        subscriptionStartedAt: true,
        helioSubscriptionId: true,
      },
    });
    if (!primaryRow) {
      return NextResponse.json(
        { error: "Profile record is temporarily unavailable. Try again in a moment.", code: "PROFILE_GONE" },
        { status: 503 }
      );
    }
    const scalarPatch = bodyToScalarPatch(body);
    if (body.walletAddress !== undefined && body.walletAddress) {
      const walletNorm = String(body.walletAddress).trim().toLowerCase();
      const donor = await prisma.userProfile.findFirst({
        where: {
          walletAddress: { equals: walletNorm, mode: "insensitive" },
          NOT: { id: primaryRow.id },
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          walletAddress: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          subscriptionExpiresAt: true,
          subscriptionStartedAt: true,
          helioSubscriptionId: true,
        },
      });
      if (donor) {
        const donorEmail = donor.email?.trim().toLowerCase() ?? null;
        const primaryEmail = primaryRow.email?.trim().toLowerCase() ?? null;
        if (donorEmail && primaryEmail && donorEmail !== primaryEmail) {
          return NextResponse.json(
            {
              error:
                "This wallet is already linked to a different email account. Contact support if you need accounts merged.",
            },
            { status: 409 }
          );
        }
        const subPatch = subscriptionPatchFromDonor(primaryRow, donor);
        const displayFill: Prisma.UserProfileUpdateInput =
          !primaryRow.displayName?.trim() && donor.displayName?.trim()
            ? { displayName: donor.displayName }
            : {};
        await prisma.$transaction([
          prisma.userProfile.update({
            where: { id: donor.id },
            data: { walletAddress: null },
          }),
          prisma.userProfile.update({
            where: { id: primaryRow.id },
            data: {
              ...scalarPatch,
              ...displayFill,
              walletAddress: walletNorm,
              ...subPatch,
            },
          }),
        ]);
      } else {
        await prisma.userProfile.update({
          where: { id: primaryRow.id },
          data: {
            ...scalarPatch,
            walletAddress: walletNorm,
          },
        });
      }
    } else {
      await prisma.userProfile.update({
        where: { id: primaryRow.id },
        data: scalarPatch,
      });
    }
    const updated = await prisma.userProfile.findUnique({
      where: { id: primaryRow.id },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        displayName: true,
        username: true,
        bio: true,
        avatarUrl: true,
        subscriptionStatus: true,
      },
    });
    return NextResponse.json({ profile: updated });
  } catch (err) {
    console.error("[api/dashboard/profile] PUT error:", err);
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }
}
