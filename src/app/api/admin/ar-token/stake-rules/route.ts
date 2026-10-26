import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { readAdminStakeRules } from "@/lib/admin/operations/ar-token.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
export const dynamic = "force-dynamic";
function trim(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function parseIntSafe(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
function parseBool(v: unknown, fallback = true): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return fallback;
}
function parseRaw(v: unknown): string {
  const s = trim(v, 80).replace(/,/g, "");
  return /^\d+$/.test(s) ? s : "0";
}
async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
/** GET /api/admin/ar-token/stake-rules — list all rules */
export async function GET() {
  try {
    return NextResponse.json(await readAdminStakeRules());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ar-token/stake-rules error:", error);
    return NextResponse.json({ error: "Could not load stake rules" }, { status: 500 });
  }
}
/** POST /api/admin/ar-token/stake-rules — create or update a rule */
export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = trim(body.id, 40);
  const data = {
    name: trim(body.name, 200),
    description: trim(body.description, 1000),
    perkSlug: trim(body.perkSlug, 100),
    minStakeRaw: parseRaw(body.minStakeRaw),
    minLockDays: parseIntSafe(body.minLockDays, 0),
    priority: parseIntSafe(body.priority, 0),
    isActive: parseBool(body.isActive, true),
  };
  if (!data.name || !data.perkSlug) {
    return NextResponse.json({ error: "name and perkSlug are required" }, { status: 400 });
  }
  const rule = id
    ? await prisma.arStakePerkRule.update({ where: { id }, data })
    : await prisma.arStakePerkRule.create({ data });
  return NextResponse.json({ rule });
}
/** DELETE /api/admin/ar-token/stake-rules — delete by id in body */
export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = trim(body.id, 40);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.arStakePerkRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
