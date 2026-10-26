import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAuthorizedFollower } from "@/lib/profile-follow-auth";
import {
  fetchSocialHubStats,
  fetchSocialProfilesPage,
  type SocialProfileFilter,
} from "@/lib/social-profiles-query";
import type { SocialProfilesResponse, SocialViewerSnapshot } from "@/components/social/social-types";
export type SocialPageSnapshot = {
  initialPage: SocialProfilesResponse;
  featured: SocialProfilesResponse;
  viewer: SocialViewerSnapshot;
};
async function readViewerSnapshot(wallets: readonly string[]): Promise<SocialViewerSnapshot> {
  const session = await getServerSession(authOptions);
  const auth = await resolveAuthorizedFollower(session);
  if (!auth.ok) return { followerAddress: null, followingByWallet: {} };
  const normalizedTargets = [...new Set(wallets.map((wallet) => wallet.trim().toLowerCase()).filter(Boolean))];
  const rows = normalizedTargets.length > 0
    ? await prisma.profileFollow.findMany({
        where: {
          followerAddress: auth.followerAddress,
          followingAddress: { in: normalizedTargets },
        },
        select: { followingAddress: true },
      })
    : [];
  const followed = new Set(rows.map((row) => row.followingAddress.toLowerCase()));
  return {
    followerAddress: auth.followerAddress,
    followingByWallet: Object.fromEntries(normalizedTargets.map((wallet) => [wallet, followed.has(wallet)])),
  };
}
export async function readSocialPageSnapshot(input: {
  page: number;
  perPage: number;
  filter: SocialProfileFilter;
  q: string;
}): Promise<SocialPageSnapshot> {
  const [pageResult, featuredResult, stats] = await Promise.all([
    fetchSocialProfilesPage({ ...input, featured: false }),
    fetchSocialProfilesPage({ page: 1, perPage: 12, filter: input.filter, q: "", featured: true }),
    fetchSocialHubStats(),
  ]);
  const initialPage: SocialProfilesResponse = {
    ...pageResult,
    page: input.page,
    perPage: input.perPage,
    filter: input.filter,
    stats,
  };
  const featured: SocialProfilesResponse = {
    ...featuredResult,
    page: 1,
    perPage: 12,
    filter: input.filter,
    stats: null,
  };
  const viewer = await readViewerSnapshot([
    ...initialPage.profiles.map((profile) => profile.walletAddress),
    ...featured.profiles.map((profile) => profile.walletAddress),
  ]);
  return { initialPage, featured, viewer };
}
