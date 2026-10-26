import { NextRequest, NextResponse } from "next/server";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import { searchX402MarketListings } from "@/lib/x402-market/listings.server";
export const dynamic = "force-dynamic";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length > 200) return NextResponse.json({ error: "q must be at most 200 characters" }, { status: 400, headers: CORS_HEADERS });
  const rawPage = searchParams.get("page") ?? "1";
  if (!/^\d+$/.test(rawPage)) return NextResponse.json({ error: "page must be a positive integer" }, { status: 400, headers: CORS_HEADERS });
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) {
    return NextResponse.json({ error: "page must be between 1 and 100" }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    return NextResponse.json(await searchX402MarketListings({ q, page }), { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[x402-market/search]", error);
    return NextResponse.json({ error: "Failed to load x402 market listings." }, { status: 500, headers: CORS_HEADERS });
  }
}
