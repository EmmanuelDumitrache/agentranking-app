import "server-only";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/async-pool";
/** Synthetic txHash keys for package-driven strip/square rows (must stay unique). */
export function adPackageStripTxHash(adPackageId: number): string {
  return `adpkg-${adPackageId}-strip`;
}
export function adPackageSquareTxHash(adPackageId: number): string {
  return `adpkg-${adPackageId}-square`;
}
/**
 * When an AdPackage is approved (active), publish to site strip/square.
 * When pending/removed, pull those slots down.
 * Multiple active packages may be live at once; the UI rotates strip/square across them.
 */
export async function syncAdPackageToPublicSlots(adPackageId: number): Promise<void> {
  const pkg = await prisma.adPackage.findUnique({
    where: { id: adPackageId },
    select: {
      id: true,
      orderId: true,
      tier: true,
      bannerUrl: true,
      linkUrl: true,
      adText: true,
      stripAdvertiserName: true,
      adIconKey: true,
      adAccentColor: true,
      tweetCount: true,
      durationDays: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      vipAd: true,
      order: true,
    },
  });
  if (!pkg) return;
  const stripTx = adPackageStripTxHash(adPackageId);
  const squareTx = adPackageSquareTxHash(adPackageId);
  /** Globally unique on AdOrderStrip / AdOrderSquare; must not reuse checkout Order.orderNumber (collides with direct ad-order rows). */
  const stripSlotOrderRef = `adpkg-${adPackageId}-strip`;
  const squareSlotOrderRef = `adpkg-${adPackageId}-square`;
  if (pkg.status !== "active") {
    await prisma.adOrderStrip.updateMany({
      where: { txHash: stripTx },
      data: { status: "removed" },
    });
    await prisma.adOrderSquare.updateMany({
      where: { txHash: squareTx },
      data: { status: "removed" },
    });
    return;
  }
  const adTextTrim = pkg.adText.trim();
  const bannerTrim = pkg.bannerUrl.trim();
  const nameTrim = pkg.stripAdvertiserName.trim();
  /** Top strip API skips empty adText; derive a line from name/link when only a banner is set. */
  const stripAdText = (() => {
    if (adTextTrim.length > 0) return adTextTrim.slice(0, 80);
    if (nameTrim.length > 0) return `${nameTrim} · featured`.slice(0, 80);
    if (bannerTrim.length > 0) {
      try {
        const host = new URL(pkg.linkUrl.trim()).hostname.replace(/^www\./, "");
        if (host) return `Promoted · ${host}`.slice(0, 80);
      } catch {
        /* ignore */
      }
      return "Promoted on AgentRanking";
    }
    return "";
  })();
  const hasStripContent = stripAdText.length > 0;
  const hasSquareBanner = bannerTrim.length > 0;
  /** Strip slot is text-only on-site; banner image lives on square + popup pool. */
  const stripBannerUrl = "";
  if (hasStripContent) {
    const stripData = {
      adText: stripAdText,
      bannerUrl: stripBannerUrl,
      linkUrl: pkg.linkUrl.trim(),
      adIconKey: pkg.adIconKey ?? "shield",
      adAccentColor: pkg.adAccentColor ?? "#22c55e",
      days: pkg.durationDays,
      orderNumber: stripSlotOrderRef,
      status: "active",
      expiresAt: pkg.expiresAt,
      wallet: pkg.order.wallet,
    };
    const stripUpdated = await prisma.adOrderStrip.updateMany({
      where: { txHash: stripTx },
      data: stripData,
    });
    if (stripUpdated.count === 0) {
      await prisma.adOrderStrip.create({
        data: {
          ...stripData,
          txHash: stripTx,
          paidAmount: "0",
          currency: "USDC",
          paymentToken: "USDC",
        },
      });
    }
  } else {
    await prisma.adOrderStrip.updateMany({
      where: { txHash: stripTx },
      data: { status: "removed" },
    });
  }
  if (hasSquareBanner) {
    const squareData = {
      bannerUrl: pkg.bannerUrl.trim(),
      linkUrl: pkg.linkUrl.trim(),
      adIconKey: pkg.adIconKey ?? "shield",
      adAccentColor: pkg.adAccentColor ?? "#22c55e",
      days: pkg.durationDays,
      orderNumber: squareSlotOrderRef,
      status: "active",
      expiresAt: pkg.expiresAt,
      wallet: pkg.order.wallet,
    };
    const squareUpdated = await prisma.adOrderSquare.updateMany({
      where: { txHash: squareTx },
      data: squareData,
    });
    if (squareUpdated.count === 0) {
      await prisma.adOrderSquare.create({
        data: {
          ...squareData,
          txHash: squareTx,
          paidAmount: "0",
          currency: "USDC",
          paymentToken: "USDC",
        },
      });
    }
  } else {
    await prisma.adOrderSquare.updateMany({
      where: { txHash: squareTx },
      data: { status: "removed" },
    });
  }
}
/**
 * Re-publish strip/square for every active paid checkout package.
 * Use after deployment or whenever active package-derived slots need reconciliation.
 */
export async function reconcileActiveCheckoutAdPackagesToPublicSlots(): Promise<number> {
  const pageSize = 100;
  let lastId = 0;
  let reconciled = 0;
  while (true) {
    const packages = await prisma.adPackage.findMany({
      where: { id: { gt: lastId }, status: "active", order: { status: "paid" } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    await mapWithConcurrency(packages, 4, (pkg) => syncAdPackageToPublicSlots(pkg.id));
    reconciled += packages.length;
    if (packages.length < pageSize) break;
    lastId = packages.at(-1)!.id;
  }
  return reconciled;
}
