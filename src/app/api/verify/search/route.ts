import { NextRequest, NextResponse } from "next/server";
import { searchVerifyAgents } from "@/lib/dashboard/verify-lookup-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const wallet = request.nextUrl.searchParams.get("wallet");
  try {
    const result = await searchVerifyAgents(q, wallet);
    return NextResponse.json(result);
  } catch (err) {
    const msg = Error.isError(err) ? err.message : "Search failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
