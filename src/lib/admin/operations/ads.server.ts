import "server-only";

import { agentPublicPath } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

export type AdminAdListItemDto = {
  source: "direct" | "package";
  id: number;
  bannerUrl: string;
  linkUrl: string;
  adText: string;
  days: number;
  status: string;
  expiresAt: string;
  wallet: string;
  orderNumber: string | null;
  createdAt: string;
  tier: string | null;
  agentName: string | null;
  agentChainId: number | null;
  agentOnChainId: number | null;
  agentProfilePath: string | null;
  stripAdvertiserName: string;
  adIconKey: string;
  adAccentColor: string;
  vipAd: boolean;
  packageOrigin: "checkout" | "manual" | null;
};

export type ReadAdminAdsInput = {
  readonly status?: "pending" | "active" | "removed";
  readonly activeOnly?: boolean;
};

export async function readAdminAds(input: ReadAdminAdsInput = {}) {
  await requireAdminOperationsSession();

  const activeOnly = input.activeOnly ?? true;
  const expiresFilter = activeOnly ? { gt: new Date() } : undefined;
  const directWhere: { status?: string; expiresAt?: { gt: Date } } = {};
  if (input.status) directWhere.status = input.status;
  if (expiresFilter) directWhere.expiresAt = expiresFilter;

  const packageWhere: {
    status?: string;
    expiresAt?: { gt: Date };
    order: { status: string };
  } = { order: { status: "paid" } };
  if (input.status) packageWhere.status = input.status;
  if (expiresFilter) packageWhere.expiresAt = expiresFilter;

  const [directAds, packages] = await Promise.all([
    prisma.adOrder.findMany({
      where: directWhere,
      orderBy: { createdAt: "desc" },
    }),
    prisma.adPackage.findMany({
      where: packageWhere,
      select: {
        id: true,
        tier: true,
        bannerUrl: true,
        linkUrl: true,
        adText: true,
        stripAdvertiserName: true,
        adIconKey: true,
        adAccentColor: true,
        durationDays: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        vipAd: true,
        order: {
          select: {
            orderNumber: true,
            wallet: true,
            status: true,
            agent: { select: { name: true, agentId: true, chainId: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const directItems: AdminAdListItemDto[] = directAds.map((ad) => ({
    source: "direct",
    id: ad.id,
    bannerUrl: ad.bannerUrl,
    linkUrl: ad.linkUrl,
    adText: "",
    days: ad.days,
    status: ad.status,
    expiresAt: ad.expiresAt.toISOString(),
    wallet: ad.wallet,
    orderNumber: ad.orderNumber,
    createdAt: ad.createdAt.toISOString(),
    tier: null,
    agentName: null,
    agentChainId: null,
    agentOnChainId: null,
    agentProfilePath: null,
    stripAdvertiserName: "",
    adIconKey: "shield",
    adAccentColor: "#22c55e",
    vipAd: false,
    packageOrigin: null,
  }));

  const packageItems: AdminAdListItemDto[] = packages.map((item) => {
    const agent = item.order.agent;
    const name = agent?.name?.trim();
    const wallet = item.order.wallet ?? "";
    return {
      source: "package",
      id: item.id,
      bannerUrl: item.bannerUrl,
      linkUrl: item.linkUrl,
      adText: item.adText,
      days: item.durationDays,
      status: item.status,
      expiresAt: item.expiresAt.toISOString(),
      wallet,
      orderNumber: item.order.orderNumber,
      createdAt: item.createdAt.toISOString(),
      tier: item.tier,
      agentName: name && name.length > 0 ? name : null,
      agentChainId: agent?.chainId ?? null,
      agentOnChainId: agent?.agentId ?? null,
      agentProfilePath: agent && name ? agentPublicPath({ ...agent, name }) : null,
      stripAdvertiserName: item.stripAdvertiserName ?? "",
      adIconKey: item.adIconKey ?? "shield",
      adAccentColor: item.adAccentColor ?? "#22c55e",
      vipAd: item.vipAd ?? false,
      packageOrigin: wallet === "admin-manual" ? "manual" : "checkout",
    };
  });

  return {
    ads: [...directItems, ...packageItems].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    ),
  };
}
