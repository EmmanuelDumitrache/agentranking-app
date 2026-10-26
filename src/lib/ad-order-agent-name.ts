import "server-only";
import { prisma } from "@/lib/db";
import { resolveAgentDbIdFromLinkUrl } from "@/lib/resolve-agent-from-link-url";
export type AdAdvertiserMeta = {
  name: string | null;
  image: string | null;
  isVerified: boolean;
  isPremiumVerified: boolean;
  /** Admin “VIP” ad: gold styling on strip/square/popup. */
  isVipAd: boolean;
};
async function agentImageMetadataFallback(agentDbId: number): Promise<string | null> {
  const rows = await prisma.agentMetadata.findMany({
    where: {
      agentId: agentDbId,
      key: { in: ["telegramAvatarUrl", "image"] },
    },
    select: { key: true, value: true },
  });
  for (const key of ["image", "telegramAvatarUrl"] as const) {
    const v = rows.find((r) => r.key === key)?.value?.trim();
    if (v && v.length > 0) return v;
  }
  return null;
}
function firstNonEmptyTrimmed(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && t.length > 0) return t;
  }
  return null;
}
async function getAdStripAdvertiserMetaForAdPackage(packageId: number): Promise<AdAdvertiserMeta> {
  const orderAgentSelectWide = {
    select: {
      linkUrl: true,
      imageUrl: true,
      bannerUrl: true,
      agentId: true,
      agent: { select: { id: true, name: true, image: true, isVerified: true, isPremiumVerified: true } },
    },
  } as const;
  const pkg: {
    linkUrl: string;
    stripAdvertiserName: string;
    vipAd: boolean;
    bannerUrl: string;
    order: {
      linkUrl: string;
      imageUrl: string;
      bannerUrl: string;
      agentId: number | null;
      agent: {
        id: number;
        name: string;
        image: string;
        isVerified: boolean;
        isPremiumVerified: boolean;
      } | null;
    } | null;
  } | null = await prisma.adPackage.findUnique({
    where: { id: packageId },
    select: {
      linkUrl: true,
      bannerUrl: true,
      stripAdvertiserName: true,
      vipAd: true,
      order: orderAgentSelectWide,
    },
  });
  const order = pkg?.order ?? null;
  let agent = order?.agent ?? null;
  const linkForResolve = firstNonEmptyTrimmed(order?.linkUrl, pkg?.linkUrl);
  if (!agent && linkForResolve) {
    const dbId = await resolveAgentDbIdFromLinkUrl(linkForResolve);
    if (dbId != null) {
      agent = await prisma.agent.findUnique({
        where: { id: dbId },
        select: { id: true, name: true, image: true, isVerified: true, isPremiumVerified: true },
      });
    }
  }
  const override = pkg?.stripAdvertiserName?.trim();
  const nameFromAgent = agent?.name?.trim();
  let name: string | null = null;
  if (override && override.length > 0) name = override;
  else if (nameFromAgent && nameFromAgent.length > 0) name = nameFromAgent;
  let image = firstNonEmptyTrimmed(agent?.image, order?.imageUrl, order?.bannerUrl, pkg?.bannerUrl);
  if (!image && agent?.id != null) {
    image = await agentImageMetadataFallback(agent.id);
  }
  return {
    name,
    image,
    isVerified: agent?.isVerified ?? false,
    isPremiumVerified: agent?.isPremiumVerified ?? false,
    isVipAd: pkg?.vipAd === true,
  };
}
/**
 * Name + profile image + verification flags for strip/popup:
 * AdPackage orders or direct strip rows via linkUrl.
 */
export async function getAdStripAdvertiserMeta(
  txHash: string | null | undefined,
  linkUrl: string
): Promise<AdAdvertiserMeta> {
  if (txHash?.startsWith("adpkg-")) {
    const m = /^adpkg-(\d+)-(strip|square)$/.exec(txHash);
    if (!m) {
      return {
        name: null,
        image: null,
        isVerified: false,
        isPremiumVerified: false,
        isVipAd: false,
      };
    }
    const packageId = Number.parseInt(m[1], 10);
    if (Number.isNaN(packageId)) {
      return {
        name: null,
        image: null,
        isVerified: false,
        isPremiumVerified: false,
        isVipAd: false,
      };
    }
    return getAdStripAdvertiserMetaForAdPackage(packageId);
  }
  const linkTrim = linkUrl.trim();
  if (!linkTrim) {
    return { name: null, image: null, isVerified: false, isPremiumVerified: false, isVipAd: false };
  }
  const dbId = await resolveAgentDbIdFromLinkUrl(linkTrim);
  if (dbId == null) {
    return { name: null, image: null, isVerified: false, isPremiumVerified: false, isVipAd: false };
  }
  const agent = await prisma.agent.findUnique({
    where: { id: dbId },
    select: { id: true, name: true, image: true, isVerified: true, isPremiumVerified: true },
  });
  if (!agent) {
    return { name: null, image: null, isVerified: false, isPremiumVerified: false, isVipAd: false };
  }
  const name = agent.name?.trim();
  let image = firstNonEmptyTrimmed(agent.image);
  if (!image) {
    image = await agentImageMetadataFallback(agent.id);
  }
  return {
    name: name && name.length > 0 ? name : null,
    image,
    isVerified: agent.isVerified ?? false,
    isPremiumVerified: agent.isPremiumVerified ?? false,
    isVipAd: false,
  };
}
