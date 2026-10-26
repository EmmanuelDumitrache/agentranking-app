import { NextResponse } from "next/server";
import { decodeNewAgentScannerCursor } from "@/lib/new-agent-scanner/cursor";
import { getNewAgentScannerPage } from "@/lib/new-agent-scanner/data";
import { PUBLIC_API_CORS_HEADERS } from "@/lib/public-api-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
}

function intParam(value: string | null, fallback: number): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = intParam(searchParams.get("page"), 1);
  const perPage = intParam(searchParams.get("perPage"), 20);
  const cursor = searchParams.get("cursor");
  if (cursor && !decodeNewAgentScannerCursor(cursor)) {
    return NextResponse.json(
      { error: "Invalid cursor" },
      { status: 400, headers: { ...PUBLIC_API_CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  }
  const data = await getNewAgentScannerPage(page, perPage, cursor);
  return NextResponse.json(data, {
    headers: {
      ...PUBLIC_API_CORS_HEADERS,
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
    },
  });
}
