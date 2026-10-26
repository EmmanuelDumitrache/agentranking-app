import { NextRequest, NextResponse } from "next/server";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminUserAgentsByEmail } from "@/lib/admin/identity/users.server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> },
) {
  const { email } = await params;
  if (!email.trim()) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  try {
    const result = await readAdminUserAgentsByEmail(email);
    if (!result) {
      return NextResponse.json({ error: "User profile not found for email" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/by-email/[email]/agents] GET error:", error);
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }
}
