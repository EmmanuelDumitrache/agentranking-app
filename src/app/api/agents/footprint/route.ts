import { NextRequest, NextResponse } from "next/server";
import { prismaApiErrorLogFields, prismaApiRouteErrorResponse } from "@/lib/api-prisma-route-error";
import { fetchFullAgentFootprint } from "@/services/agentIndexer";
import { normalizeEvmAddress } from "@/types/agent";
export const maxDuration = 60;
function parseChainIds(raw: string | null): number[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}
/**
 * GET /api/agents/footprint?wallet=0x…&chains=8453,56&hydrateValidation=1
 * Unified ERC-8004 footprint (identity + reputation + validation) per wallet.
 */
export async function GET(request: NextRequest) {
  const walletRaw = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  const wallet = normalizeEvmAddress(walletRaw);
  if (!wallet) {
    return NextResponse.json({ error: "Invalid or missing wallet (EVM address required)" }, { status: 400 });
  }
  const chains = parseChainIds(request.nextUrl.searchParams.get("chains"));
  const hydrateValidation = request.nextUrl.searchParams.get("hydrateValidation") !== "0";
  const preferDb = request.nextUrl.searchParams.get("preferDb") !== "0";
  try {
    const footprint = await fetchFullAgentFootprint(wallet, {
      chains,
      preferDb,
      hydrateValidation,
    });
    return NextResponse.json(footprint, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET /api/agents/footprint error:", {
      error: msg,
      stack: Error.isError(err) ? err.stack : undefined,
      ...prismaApiErrorLogFields(msg),
    });
    const { body, status, headers } = prismaApiRouteErrorResponse(msg);
    return NextResponse.json(body, { status, headers });
  }
}
