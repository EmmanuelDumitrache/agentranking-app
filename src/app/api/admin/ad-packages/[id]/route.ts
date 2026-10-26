import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  reconcileActiveCheckoutAdPackagesToPublicSlots,
  syncAdPackageToPublicSlots,
} from "@/lib/ad-package-public-sync";
import { AD_TEXT_MAX_CHARS, getAdTier } from "@/lib/product-config";
import {
  normalizeAdAccentColor,
  normalizeAdIconKey,
  normalizeAdvertiserDisplayName,
} from "@/lib/ad-theme";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
const MAX_URL_LEN = 2048;
const MAX_ORDER_CREATIVE = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * PATCH /api/admin/ad-packages/[id]
 * Body: status?, linkUrl?, expiresAt? (ISO), adText?, bannerUrl?, stripAdvertiserName?,
 *        tier?, durationDays? (1–365; recomputes expiresAt from now), vipAd?
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const packageId = Number.parseInt(id, 10);
    if (Number.isNaN(packageId)) {
      return NextResponse.json({ error: "Invalid package id" }, { status: 400 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const status = body.status as string | undefined;
    const linkUrlRaw = body.linkUrl;
    const expiresAtRaw = body.expiresAt;
    const adTextRaw = body.adText;
    const bannerUrlRaw = body.bannerUrl;
    const stripAdvertiserNameRaw = body.stripAdvertiserName;
    const adIconKeyRaw = body.adIconKey;
    const adAccentColorRaw = body.adAccentColor;
    const tierRaw = body.tier;
    const durationDaysRaw = body.durationDays;
    const vipAdRaw = body.vipAd;
    const validStatuses = ["pending", "active", "removed"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "status must be pending, active, or removed" },
        { status: 400 }
      );
    }
    const data: {
      status?: string;
      linkUrl?: string;
      expiresAt?: Date;
      adText?: string;
      bannerUrl?: string;
      stripAdvertiserName?: string;
      adIconKey?: string;
      adAccentColor?: string;
      tier?: string;
      tweetCount?: number;
      durationDays?: number;
      vipAd?: boolean;
    } = {};
    if (status !== undefined) data.status = status;
    if (linkUrlRaw !== undefined) {
      data.linkUrl = String(linkUrlRaw ?? "").trim().slice(0, MAX_URL_LEN);
    }
    if (expiresAtRaw !== undefined) {
      const d = new Date(String(expiresAtRaw));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid expiresAt (use ISO date string)" }, { status: 400 });
      }
      data.expiresAt = d;
    }
    if (adTextRaw !== undefined) {
      data.adText = String(adTextRaw ?? "").trim().slice(0, AD_TEXT_MAX_CHARS);
    }
    if (bannerUrlRaw !== undefined) {
      data.bannerUrl = String(bannerUrlRaw ?? "").trim().slice(0, MAX_URL_LEN);
    }
    if (stripAdvertiserNameRaw !== undefined) {
      data.stripAdvertiserName = normalizeAdvertiserDisplayName(stripAdvertiserNameRaw);
    }
    if (adIconKeyRaw !== undefined) {
      data.adIconKey = normalizeAdIconKey(adIconKeyRaw);
    }
    if (adAccentColorRaw !== undefined) {
      data.adAccentColor = normalizeAdAccentColor(adAccentColorRaw);
    }
    if (tierRaw !== undefined) {
      const tierStr = String(tierRaw ?? "").trim();
      const t = getAdTier(tierStr);
      if (!t) {
        return NextResponse.json(
          { error: "tier must be Starter, Growth, or Launch" },
          { status: 400 }
        );
      }
      data.tier = t.label;
      data.tweetCount = t.tweetCount;
    }
    if (durationDaysRaw !== undefined) {
      const d = Number(durationDaysRaw);
      if (!Number.isFinite(d) || d < 1 || d > 365) {
        return NextResponse.json(
          { error: "durationDays must be between 1 and 365" },
          { status: 400 }
        );
      }
      const di = Math.floor(d);
      data.durationDays = di;
      /** Placement end anchored from “now” when duration is edited in admin. */
      data.expiresAt = new Date(Date.now() + di * MS_PER_DAY);
    }
    if (vipAdRaw !== undefined) {
      data.vipAd = Boolean(vipAdRaw);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one field to update" },
        { status: 400 }
      );
    }
    const updated = await prisma.adPackage.update({
      where: { id: packageId },
      data,
    });
    const orderData: {
      linkUrl?: string;
      adText?: string;
      bannerUrl?: string;
      tier?: string;
      stripAdvertiserName?: string;
      adIconKey?: string;
      adAccentColor?: string;
      expiresAt?: Date;
    } = {};
    if (linkUrlRaw !== undefined) orderData.linkUrl = updated.linkUrl;
    if (adTextRaw !== undefined) orderData.adText = updated.adText;
    if (bannerUrlRaw !== undefined) {
      orderData.bannerUrl = updated.bannerUrl.slice(0, MAX_ORDER_CREATIVE);
    }
    if (tierRaw !== undefined) orderData.tier = updated.tier;
    if (stripAdvertiserNameRaw !== undefined) orderData.stripAdvertiserName = updated.stripAdvertiserName;
    if (adIconKeyRaw !== undefined) orderData.adIconKey = updated.adIconKey;
    if (adAccentColorRaw !== undefined) orderData.adAccentColor = updated.adAccentColor;
    if (durationDaysRaw !== undefined || expiresAtRaw !== undefined) {
      orderData.expiresAt = updated.expiresAt;
    }
    if (Object.keys(orderData).length > 0) {
      await prisma.order.update({
        where: { id: updated.orderId },
        data: orderData,
      });
    }
    try {
      await syncAdPackageToPublicSlots(packageId);
      await reconcileActiveCheckoutAdPackagesToPublicSlots();
    } catch (syncErr) {
      console.error("syncAdPackageToPublicSlots after admin PATCH:", syncErr);
      const msg = Error.isError(syncErr) ? syncErr.message : String(syncErr);
      return NextResponse.json(
        {
          error: "Package saved but failed to sync public ad slots",
          details: msg,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      adPackage: {
        id: updated.id,
        bannerUrl: updated.bannerUrl,
        linkUrl: updated.linkUrl,
        adText: updated.adText,
        stripAdvertiserName: updated.stripAdvertiserName,
        tier: updated.tier,
        status: updated.status,
        expiresAt: updated.expiresAt,
        orderId: updated.orderId,
        durationDays: updated.durationDays,
        vipAd: updated.vipAd,
        adIconKey: updated.adIconKey,
        adAccentColor: updated.adAccentColor,
      },
    });
  } catch (err) {
    console.error("PATCH /api/admin/ad-packages/[id] error:", err);
    const details = Error.isError(err) ? err.message : String(err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "Database unique constraint conflict (e.g. duplicate orderNumber on ad slots)",
          details,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update ad package", details },
      { status: 500 }
    );
  }
}
