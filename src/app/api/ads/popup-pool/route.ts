import { NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { getAdStripAdvertiserMeta } from "@/lib/ad-order-agent-name";
export const dynamic = "force-dynamic";
type PopupPoolRow = {
  id: number;
  adText: string;
  bannerUrl: string;
  linkUrl: string;
  txHash: string;
  adIconKey: string;
  adAccentColor: string;
};
/**
 * GET /api/ads/popup-pool — active ads with banner + link for bottom promo rotation.
 *
 * Includes adOrderSquare (sidebar slot) and adOrderStrip rows that carry banners.
 * Each row is keyed by table + id (and txHash when present) so multiple orders with the
 * same linkUrl still rotate as separate promos.
 */
export async function GET() {
  try {
    const [squareRows, stripRows] = await Promise.all([
      prisma.adOrderSquare.findMany({
        where: { status: "active", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          bannerUrl: true,
          linkUrl: true,
          txHash: true,
          adIconKey: true,
          adAccentColor: true,
        },
      }),
      prisma.adOrderStrip.findMany({
        where: { status: "active", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          adText: true,
          bannerUrl: true,
          linkUrl: true,
          txHash: true,
          adIconKey: true,
          adAccentColor: true,
        },
      }),
    ]);
    const byKey = new Map<string, PopupPoolRow>();
    const pushSquare = (r: (typeof squareRows)[number]) => {
      const banner = r.bannerUrl.trim();
      const link = r.linkUrl.trim();
      if (!banner || !link) return;
      const key =
        r.txHash.trim().length > 0 ? `sq:${r.txHash}` : `sq:id:${r.id}`;
      byKey.set(key, {
        id: r.id,
        adText: "",
        bannerUrl: banner,
        linkUrl: link,
        txHash: r.txHash,
        adIconKey: r.adIconKey,
        adAccentColor: r.adAccentColor,
      });
    };
    const pushStrip = (r: (typeof stripRows)[number]) => {
      const banner = r.bannerUrl.trim();
      const link = r.linkUrl.trim();
      if (!banner || !link) return;
      const key =
        r.txHash.trim().length > 0 ? `st:${r.txHash}` : `st:id:${r.id}`;
      if (byKey.has(key)) return;
      byKey.set(key, {
        id: r.id,
        adText: (r.adText ?? "").trim(),
        bannerUrl: banner,
        linkUrl: link,
        txHash: r.txHash,
        adIconKey: r.adIconKey,
        adAccentColor: r.adAccentColor,
      });
    };
    for (const r of squareRows) pushSquare(r);
    for (const r of stripRows) pushStrip(r);
    const merged = [...byKey.values()];
    const ads = await mapWithConcurrency(
      merged,
      8,
      async (row) => {
        const meta = await getAdStripAdvertiserMeta(row.txHash, row.linkUrl);
        return {
          id: row.id,
          adText: row.adText,
          bannerUrl: row.bannerUrl,
          linkUrl: row.linkUrl,
          txHash: row.txHash,
          agentName: meta.name,
          agentImage: meta.image,
          isVerified: meta.isVerified,
          isPremiumVerified: meta.isPremiumVerified,
          isVipAd: meta.isVipAd,
          adIconKey: row.adIconKey,
          adAccentColor: row.adAccentColor,
        };
      },
    );
    return NextResponse.json({ ads });
  } catch (err) {
    return NextResponse.json({ ads: [], error: String(err) });
  }
}
