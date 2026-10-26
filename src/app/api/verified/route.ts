import { NextRequest, NextResponse } from "next/server";
import { readVerifiedDirectoryPage } from "@/lib/agent-directory/verified-directory.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const page = Math.max(
    1,
    Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1,
  );
  const perPage = Math.min(
    50,
    Math.max(
      1,
      Number.parseInt(request.nextUrl.searchParams.get("perPage") ?? "25", 10) || 25,
    ),
  );
  try {
    return NextResponse.json(await readVerifiedDirectoryPage(page, perPage));
  } catch (error) {
    console.error("[verified] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load verified agents" },
      { status: 500 },
    );
  }
}
