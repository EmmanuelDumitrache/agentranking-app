import "server-only";

import { agentPublicPath } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

export function normalizeAdminOrdersInput(input: {
  readonly status?: string | null;
  readonly page?: number;
  readonly perPage?: number;
}) {
  const status = input.status?.trim() || "all";
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page!)) : 1;
  const perPage = Number.isFinite(input.perPage)
    ? Math.min(100, Math.max(1, Math.trunc(input.perPage!)))
    : 50;
  return { status, page, perPage };
}

export async function readAdminOrders(input: {
  readonly status?: string | null;
  readonly page?: number;
  readonly perPage?: number;
}) {
  await requireAdminOperationsSession();
  const normalized = normalizeAdminOrdersInput(input);
  const where = normalized.status === "all" ? {} : { status: normalized.status };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        productType: true,
        tier: true,
        usdPrice: true,
        paymentAsset: true,
        chainId: true,
        cryptoAmount: true,
        wallet: true,
        email: true,
        txHash: true,
        status: true,
        agentId: true,
        imageUrl: true,
        bannerUrl: true,
        linkUrl: true,
        adText: true,
        stripAdvertiserName: true,
        adIconKey: true,
        adAccentColor: true,
        tokenAddress: true,
        kyaDescription: true,
        kyaMetadata: true,
        kyaServices: true,
        referralCode: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        agent: { select: { id: true, name: true, agentId: true, chainId: true } },
        agentBoost: { select: { id: true } },
        adPackage: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (normalized.page - 1) * normalized.perPage,
      take: normalized.perPage,
    }),
  ]);

  return {
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      productType: order.productType,
      tier: order.tier,
      usdPrice: order.usdPrice,
      paymentAsset: order.paymentAsset,
      chainId: order.chainId,
      cryptoAmount: order.cryptoAmount,
      wallet: order.wallet,
      email: order.email,
      txHash: order.txHash,
      status: order.status,
      agentId: order.agentId,
      imageUrl: order.imageUrl,
      bannerUrl: order.bannerUrl,
      linkUrl: order.linkUrl,
      adText: order.adText,
      stripAdvertiserName: order.stripAdvertiserName,
      adIconKey: order.adIconKey,
      adAccentColor: order.adAccentColor,
      tokenAddress: order.tokenAddress,
      kyaDescription: order.kyaDescription,
      kyaMetadata: order.kyaMetadata,
      kyaServices: order.kyaServices,
      referralCode: order.referralCode,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      expiresAt: order.expiresAt.toISOString(),
      agent: order.agent
        ? { ...order.agent, profilePath: agentPublicPath(order.agent) }
        : null,
      agentBoost: order.agentBoost,
      adPackage: order.adPackage,
    })),
    total,
    page: normalized.page,
    perPage: normalized.perPage,
  };
}
