import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
const MAX_URL_LEN = 500;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
/**
 * PATCH /api/admin/ads/[id] — direct AdOrder
 * Body: status?, linkUrl?, bannerUrl?, expiresAt? (ISO), days?
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
    const adId = parseInt(id, 10);
    if (Number.isNaN(adId)) {
      return NextResponse.json({ error: "Invalid ad id" }, { status: 400 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const status = body.status as string | undefined;
    const linkUrlRaw = body.linkUrl;
    const bannerUrlRaw = body.bannerUrl;
    const expiresAtRaw = body.expiresAt;
    const daysRaw = body.days;
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
      bannerUrl?: string;
      expiresAt?: Date;
      days?: number;
    } = {};
    if (status !== undefined) data.status = status;
    if (linkUrlRaw !== undefined) {
      data.linkUrl = String(linkUrlRaw ?? "").trim().slice(0, MAX_URL_LEN);
    }
    if (bannerUrlRaw !== undefined) {
      data.bannerUrl = String(bannerUrlRaw ?? "").trim().slice(0, MAX_URL_LEN);
    }
    if (expiresAtRaw !== undefined) {
      const d = new Date(String(expiresAtRaw));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid expiresAt (use ISO date string)" }, { status: 400 });
      }
      data.expiresAt = d;
    }
    if (daysRaw !== undefined) {
      const days = Number(daysRaw);
      if (!Number.isFinite(days) || days < MIN_DAYS || days > MAX_DAYS) {
        return NextResponse.json(
          { error: `days must be between ${MIN_DAYS} and ${MAX_DAYS}` },
          { status: 400 }
        );
      }
      data.days = Math.floor(days);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one field to update" },
        { status: 400 }
      );
    }
    const updated = await prisma.adOrder.update({
      where: { id: adId },
      data,
    });
    const slotPatch: {
      linkUrl?: string;
      bannerUrl?: string;
      expiresAt?: Date;
      days?: number;
      status?: string;
    } = {};
    if (linkUrlRaw !== undefined) slotPatch.linkUrl = updated.linkUrl;
    if (bannerUrlRaw !== undefined) slotPatch.bannerUrl = updated.bannerUrl;
    if (expiresAtRaw !== undefined) slotPatch.expiresAt = updated.expiresAt;
    if (daysRaw !== undefined) slotPatch.days = updated.days;
    if (status !== undefined) slotPatch.status = updated.status;
    if (Object.keys(slotPatch).length > 0) {
      const tx = updated.txHash;
      await prisma.adOrderStrip.updateMany({
        where: { txHash: tx },
        data: slotPatch,
      });
      await prisma.adOrderSquare.updateMany({
        where: { txHash: tx },
        data: slotPatch,
      });
    }
    return NextResponse.json({
      ad: {
        id: updated.id,
        bannerUrl: updated.bannerUrl,
        linkUrl: updated.linkUrl,
        days: updated.days,
        status: updated.status,
        expiresAt: updated.expiresAt,
        orderNumber: updated.orderNumber,
      },
    });
  } catch (err) {
    console.error("PATCH /api/admin/ads/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update ad" },
      { status: 500 }
    );
  }
}
