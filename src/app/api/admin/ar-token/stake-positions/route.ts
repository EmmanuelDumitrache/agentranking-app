import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import {
  isAdminOperationsUnauthorized,
} from "@/lib/admin/operations/auth.server";
import { readAdminStakePositions } from "@/lib/admin/operations/ar-token.server";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
export const dynamic = "force-dynamic";
function trim(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function parseIntSafe(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
function parseRaw(v: unknown): string {
  const s = trim(v, 80).replace(/,/g, "");
  return /^\d+$/.test(s) ? s : "0";
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
/** GET /api/admin/ar-token/stake-positions?wallet=&page=&pageSize= */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    return NextResponse.json(
      await readAdminStakePositions({
        wallet: searchParams.get("wallet"),
        page: Number.parseInt(searchParams.get("page") ?? "0", 10),
        pageSize: Number.parseInt(searchParams.get("pageSize") ?? "50", 10),
        includePerkSummary: searchParams.get("includePerkSummary") === "1",
      }),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ar-token/stake-positions error:", error);
    return NextResponse.json({ error: "Failed to load stake positions" }, { status: 500 });
  }
}
/** POST /api/admin/ar-token/stake-positions — create or upsert a position */
export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const wallet = normalizeStakeWallet(trim(body.wallet, 200));
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  const nonce = parseIntSafe(body.nonce, 0);
  const poolAddress = trim(body.poolAddress, 200);
  const durationSec = parseIntSafe(body.durationSec, 0);
  const lockStartAt = parseDate(body.lockStartAt);
  const lockEndAt = parseDate(body.lockEndAt);
  const now = new Date();
  const data = {
    wallet,
    poolAddress,
    mintAddress: trim(body.mintAddress, 200),
    amountRaw: parseRaw(body.amountRaw),
    amountUi: trim(body.amountUi, 80),
    nonce,
    durationSec,
    lockStartAt: lockStartAt ?? now,
    lockEndAt: lockEndAt ?? (durationSec > 0 ? new Date(now.getTime() + durationSec * 1000) : null),
    txSignature: trim(body.txSignature, 200),
    status: ["active", "unstaked", "expired"].includes(trim(body.status, 20)) ? trim(body.status, 20) : "active",
    source: trim(body.source, 40) || "manual",
    adminNote: trim(body.adminNote, 500),
    lastSyncedAt: now,
  };
  const position = await prisma.arStakePosition.upsert({
    where: { wallet_nonce_poolAddress: { wallet, nonce, poolAddress } },
    create: data,
    update: data,
  });
  return NextResponse.json({ position });
}
/** PATCH /api/admin/ar-token/stake-positions — update status or adminNote by id */
export async function PATCH(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = trim(body.id, 40);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const update: Record<string, unknown> = {};
  const status = trim(body.status, 20);
  if (status) update.status = status;
  const note = body.adminNote;
  if (typeof note === "string") update.adminNote = note.trim().slice(0, 500);
  const position = await prisma.arStakePosition.update({ where: { id }, data: update });
  return NextResponse.json({ position });
}
/** DELETE /api/admin/ar-token/stake-positions — delete by id */
export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = trim(body.id, 40);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.arStakePosition.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
