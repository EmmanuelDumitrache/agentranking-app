import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminJobsStatus } from "@/lib/admin/operations/jobs.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readAdminJobsStatus());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
