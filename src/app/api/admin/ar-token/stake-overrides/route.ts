import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminStakeOverrides } from "@/lib/admin/operations/ar-token.server";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
export const dynamic = "force-dynamic";
function trim(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
/** GET /api/admin/ar-token/stake-overrides?wallet= */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      await readAdminStakeOverrides(req.nextUrl.searchParams.get("wallet")),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ar-token/stake-overrides error:", error);
    return NextResponse.json({ error: "Failed to load stake overrides" }, { status: 500 });
  }
}
/** POST /api/admin/ar-token/stake-overrides — upsert (wallet + perkSlug is unique) */
export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const wallet = normalizeStakeWallet(trim(body.wallet, 200));
  const perkSlug = trim(body.perkSlug, 100);
  if (!wallet || !perkSlug) {
    return NextResponse.json({ error: "wallet and perkSlug are required" }, { status: 400 });
  }
  const overrideType = trim(body.overrideType, 20);
  if (overrideType !== "force_unlock" && overrideType !== "force_lock") {
    return NextResponse.json({ error: "overrideType must be force_unlock or force_lock" }, { status: 400 });
  }
  const data = {
    wallet,
    perkSlug,
    overrideType,
    adminNote: trim(body.adminNote, 500),
    expiresAt: parseDate(body.expiresAt),
  };
  const override = await prisma.arStakePerkOverride.upsert({
    where: { wallet_perkSlug: { wallet, perkSlug } },
    create: data,
    update: { overrideType: data.overrideType, adminNote: data.adminNote, expiresAt: data.expiresAt },
  });
  return NextResponse.json({ override });
}
/** DELETE /api/admin/ar-token/stake-overrides — delete by id */
export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = trim(body.id, 40);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.arStakePerkOverride.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
