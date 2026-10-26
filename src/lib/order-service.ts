import { revalidateTag } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { agentPublicAgentCacheTag } from "@/lib/agent-public-cache-tag";
import {
  invalidateAllPublicStatistics,
  invalidatePublicReputationStatistics,
} from "@/lib/invalidate-public-statistics";
import { prisma } from "@/lib/db";
import { getPowerBoostTier, getAdTier, getVerifiedRevenueTier } from "@/lib/product-config";
import { sanitizeForPostgres } from "@/lib/utils";
import { recomputeBoostsAndListingPowerForAgent } from "@/lib/recompute-single-agent-power-score";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
async function upsertAgentWalletMetadata(
  tx: Prisma.TransactionClient,
  agentId: number,
  wallet: string,
): Promise<void> {
  const payerWallet = wallet.trim();
  if (!payerWallet) return;
  const existing = await tx.agentMetadata.findFirst({
    where: {
      agentId,
      key: "agentWallet",
      value: { equals: payerWallet, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return;
  await tx.agentMetadata.create({
    data: {
      agentId,
      key: "agentWallet",
      value: payerWallet.toLowerCase(),
    },
  });
}
async function queueOrderPostActivationInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const receipt = await tx.orderPostActivation.upsert({
    where: { orderId },
    create: { orderId, status: "pending" },
    update: {},
  });
  if (receipt.status === "completed") return;
  await enqueueApplicationJobInTx(tx, JOB_QUEUES.ORDER_POST_ACTIVATION, { v: 1, id: orderId }, {
    singletonKey: orderId,
  });
}
/**
 * Activate an order after payment is confirmed.
 * Idempotent — safe to call multiple times.
 */
export async function activateOrder(orderId: string): Promise<void> {
  let order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { agentBoost: true, adPackage: true },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);
  await getJobProducer();
  if (order.status === "paid") {
    await prisma.$transaction((tx) => queueOrderPostActivationInTx(tx, orderId));
    return;
  }
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const lockedOrder = await tx.order.findUnique({
      where: { id: orderId },
      include: { agentBoost: true, adPackage: true },
    });
    if (!lockedOrder) throw new Error(`Order ${orderId} disappeared during activation`);
    order = lockedOrder;
    if (order.status === "paid") {
      await queueOrderPostActivationInTx(tx, orderId);
      return;
    }
    if (order.status !== "pending") {
      throw new Error(`Order ${orderId} cannot be activated from status ${order.status}`);
    }
    if (order.productType === "power_boost") {
      const tier = getPowerBoostTier(order.tier);
      if (!tier) throw new Error(`Unknown power boost tier: ${order.tier}`);
      if (!order.agentId) throw new Error("power_boost order missing agentId");
      const expiresAt = new Date(
        Date.now() + tier.durationHours * 60 * 60 * 1000
      );
      if (!order.agentBoost) {
        const boost = await tx.agentBoost.create({
          data: {
            agentId: order.agentId,
            boostUnits: tier.units,
            paidUsd: order.usdPrice,
            txHash: order.txHash ?? `manual-${orderId}`,
            wallet: order.wallet,
            orderNumber: order.orderNumber,
            expiresAt,
            orderId: order.id,
          },
        });
        console.log(`[order-service] Power boost ${boost.id} created for agent ${order.agentId}`);
      }
      // Same formula as the global rank projection — listing power is boost units +
      // AR holder power perks + admin adjust only (never trust/`score`, which caused ~100 defaults).
      await recomputeBoostsAndListingPowerForAgent(tx, order.agentId);
      await tx.order.update({
        where: { id: orderId },
        data: { status: "paid", paidAt: new Date() },
      });
    } else if (order.productType === "ad") {
      const tier = getAdTier(order.tier);
      if (!tier) throw new Error(`Unknown ad tier: ${order.tier}`);
      const expiresAt = new Date(
        Date.now() + tier.durationDays * 24 * 60 * 60 * 1000
      );
      if (!order.adPackage) {
        await tx.adPackage.create({
          data: {
            orderId: order.id,
            tier: order.tier,
            durationDays: tier.durationDays,
            tweetCount: tier.tweetCount,
            bannerUrl: order.bannerUrl ?? "",
            linkUrl: order.linkUrl ?? "",
            adText: order.adText ?? "",
            stripAdvertiserName: order.stripAdvertiserName ?? "",
            adIconKey: order.adIconKey ?? "shield",
            adAccentColor: order.adAccentColor ?? "#22c55e",
            status: "pending", // admin reviews before activating
            expiresAt,
          },
        });
        console.log(`[order-service] AdPackage created for order ${orderId}`);
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "paid", paidAt: new Date() },
      });
    } else if (order.productType === "kya_verify" || order.productType === "verification_bundle") {
      if (!order.agentId) throw new Error("kya_verify / verification_bundle order missing agentId");
      const agentUpdate: {
        isPremiumVerified: boolean;
        isVerified?: boolean;
        isVerifiedRevenue?: boolean;
        verifiedRevenueAt?: Date;
        verifiedRevenueExpiresAt?: Date | null;
        hasDuplicateName?: boolean;
        image?: string;
      } = {
        isPremiumVerified: true,
        hasDuplicateName: false,
      };
      if (order.productType === "verification_bundle") {
        agentUpdate.isVerified = true;
        agentUpdate.isVerifiedRevenue = true;
        agentUpdate.verifiedRevenueAt = new Date();
        agentUpdate.verifiedRevenueExpiresAt = null;
      }
      if (order.imageUrl?.trim()) agentUpdate.image = order.imageUrl.trim().slice(0, 500);
      await tx.agent.update({
        where: { id: order.agentId },
        data: agentUpdate,
      });
      await upsertAgentWalletMetadata(tx, order.agentId, order.wallet);
      if (order.bannerUrl?.trim()) {
        const bannerUrl = order.bannerUrl.trim().slice(0, 500);
        const existing = await tx.agentMetadata.findFirst({ where: { agentId: order.agentId, key: "banner" } });
        if (existing) {
          await tx.agentMetadata.update({ where: { id: existing.id }, data: { value: bannerUrl } });
        } else {
          await tx.agentMetadata.create({ data: { agentId: order.agentId, key: "banner", value: bannerUrl } });
        }
      }
      const tokenVal = order.tokenAddress.trim();
      if (tokenVal) {
        const tokenAddr = tokenVal.startsWith("0x") ? tokenVal.toLowerCase().slice(0, 42) : tokenVal.slice(0, 44);
        await tx.$executeRaw`UPDATE "Agent" SET "tokenAddress" = ${tokenAddr} WHERE id = ${order.agentId}`;
      }
      if (order.kyaDescription.trim()) {
        await tx.agent.update({
          where: { id: order.agentId! },
          data: { description: sanitizeForPostgres(order.kyaDescription.trim().slice(0, 2000)) },
        });
      }
      const kyaMeta = ((): Record<string, string> => {
        try {
          const s = order.kyaMetadata.trim();
          if (!s || s === "{}") return {};
          const parsed = JSON.parse(s) as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 500);
          }
          return out;
        } catch {
          return {};
        }
      })();
      for (const [key, value] of Object.entries(kyaMeta)) {
        const existing = await tx.agentMetadata.findFirst({
          where: { agentId: order.agentId!, key },
        });
        const val = sanitizeForPostgres(value);
        if (existing) {
          await tx.agentMetadata.update({ where: { id: existing.id }, data: { value: val } });
        } else {
          await tx.agentMetadata.create({
            data: { agentId: order.agentId!, key: sanitizeForPostgres(key), value: val },
          });
        }
      }
      const kyaSvcs = ((): Array<{ name: string; endpoint: string }> => {
        try {
          const s = order.kyaServices.trim();
          if (!s || s === "[]") return [];
          const parsed = JSON.parse(s) as Array<{ name?: string; endpoint?: string }>;
          return (parsed || [])
            .filter((x) => x?.name?.trim())
            .map((x) => ({
              name: String(x.name).trim().slice(0, 20),
              endpoint: String(x.endpoint || "").trim().slice(0, 500),
            }));
        } catch {
          return [];
        }
      })();
      for (const svc of kyaSvcs) {
        const serviceName = sanitizeForPostgres(svc.name.toUpperCase());
        const serviceEndpoint = sanitizeForPostgres(svc.endpoint);
        const existingService = await tx.agentService.findFirst({
          where: {
            agentId: order.agentId!,
            name: serviceName,
            endpoint: serviceEndpoint,
          },
          select: { id: true },
        });
        if (!existingService) {
          await tx.agentService.create({
            data: {
              agentId: order.agentId!,
              name: serviceName,
              endpoint: serviceEndpoint,
              version: "1.0",
            },
          });
        }
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "paid", paidAt: new Date() },
      });
      if (order.productType === "verification_bundle") {
        await tx.promotion.upsert({
          where: { orderNumber: order.orderNumber },
          create: {
            agentId: order.agentId,
            slotType: "verification_bundle",
            durationDays: 0,
            txHash: order.txHash ?? `manual-${orderId}`,
            paidAmount: order.cryptoAmount,
            currency: order.paymentAsset?.includes("ETH") ? "ETH" : "USDC",
            paymentToken: order.paymentAsset?.includes("ETH") ? "ETH" : "USDC",
            wallet: order.wallet,
            orderNumber: order.orderNumber,
            expiresAt: new Date("2099-12-31"),
          },
          update: {},
        });
        console.log(`[order-service] Full Verification (bundle) set for agent ${order.agentId}`);
      } else {
        console.log(`[order-service] KYA verification set for agent ${order.agentId}`);
      }
    } else if (order.productType === "verified_revenue") {
      if (!order.agentId) throw new Error("verified_revenue order missing agentId");
      const vrTier = getVerifiedRevenueTier(order.tier);
      if (!vrTier) throw new Error(`Unknown verified_revenue tier: ${order.tier}`);
      const vrExpiresAt = new Date(Date.now() + vrTier.durationDays * 24 * 60 * 60 * 1000);
      await tx.agent.update({
        where: { id: order.agentId },
        data: {
          isVerifiedRevenue: true,
          verifiedRevenueAt: new Date(),
          verifiedRevenueExpiresAt: vrExpiresAt,
        },
      });
      await tx.promotion.upsert({
        where: { orderNumber: order.orderNumber },
        create: {
          agentId: order.agentId,
          slotType: "verified_revenue",
          durationDays: vrTier.durationDays,
          txHash: order.txHash ?? `manual-${orderId}`,
          paidAmount: order.cryptoAmount,
          currency: order.paymentAsset?.includes("ETH") ? "ETH" : "USDC",
          paymentToken: order.paymentAsset?.includes("ETH") ? "ETH" : "USDC",
          wallet: order.wallet,
          orderNumber: order.orderNumber,
          expiresAt: vrExpiresAt,
        },
        update: {},
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "paid", paidAt: new Date() },
      });
      console.log(`[order-service] Verified Revenue set for agent ${order.agentId} until ${vrExpiresAt.toISOString()}`);
    } else {
      throw new Error(`Unknown productType: ${order.productType}`);
    }
    await queueOrderPostActivationInTx(tx, orderId);
  },
  {
    maxWait: 15_000,
    timeout: 30_000,
  }
  );
  // Durable post-activation side effects are transactionally enqueued above.
  try {
    if (
      (order.productType === "power_boost" ||
        order.productType === "kya_verify" ||
        order.productType === "verification_bundle") &&
      order.agentId
    ) {
      const agentForTag = await prisma.agent.findUnique({
        where: { id: order.agentId },
        select: { chainId: true, agentId: true },
      });
      if (agentForTag) {
        revalidateTag(agentPublicAgentCacheTag(agentForTag.chainId, agentForTag.agentId), "max");
      }
      if (order.productType === "power_boost") {
        await invalidatePublicReputationStatistics();
      } else if (
        order.productType === "kya_verify" ||
        order.productType === "verification_bundle"
      ) {
        await invalidateAllPublicStatistics();
      }
    }
  } catch (err) {
    console.warn("[order-service] Post-activation cache revalidation failed:", err);
  }
}
