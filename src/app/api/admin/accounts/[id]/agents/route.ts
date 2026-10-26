import { NextRequest, NextResponse } from "next/server";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminAccountAgents } from "@/lib/admin/identity/accounts.server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const accountId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const result = await readAdminAccountAgents(accountId);
    if (!result) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/accounts/[id]/agents] GET error:", error);
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }
}
