import type { Prisma } from "@/generated/prisma/client";
import { XPAY_SERVICE_TYPE } from "@/lib/xpay/display";
/** Published paid-service types treated as Xona xPay listings. */
export const XPAY_LISTING_SERVICE_TYPES = [
  XPAY_SERVICE_TYPE,
  "xona-xpay",
  "x402-xpay",
] as const;
export function agentHasPublishedXPayWhere(): Prisma.AgentWhereInput {
  return {
    paidServices: {
      some: {
        isPublished: true,
        serviceType: { in: [...XPAY_LISTING_SERVICE_TYPES] },
      },
    },
  };
}