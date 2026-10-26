import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminUsers } from "@/lib/admin/identity/users.server";
import { normalizeAdminUsersQuery } from "@/lib/admin/identity/query";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const query = normalizeAdminUsersQuery({
      page: request.nextUrl.searchParams.get("page"),
      perPage: request.nextUrl.searchParams.get("perPage"),
      search: request.nextUrl.searchParams.get("search"),
    });
    return NextResponse.json(await readAdminUsers(query));
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users] GET error:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  if (!walletAddress) {
    return NextResponse.json({ error: "wallet param required" }, { status: 400 });
  }
  await prisma.userProfile.update({
    where: { walletAddress: walletAddress.toLowerCase() },
    data: { username: null, displayName: null, bio: "" },
  });
  return NextResponse.json({ success: true });
}