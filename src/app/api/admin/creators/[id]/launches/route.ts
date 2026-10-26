import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { adminCreateCreatorLaunch } from "@/lib/admin-creator-mutations";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/creators/[id]/launches
 * Link or create a token launch by mint address for this creator.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: {
    mint?: string;
    agentDbId?: number | null;
    tokenName?: string;
    tokenSymbol?: string;
    tokenImageUrl?: string;
    launchStatus?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const agentDbId =
    body.agentDbId === null || body.agentDbId === undefined
      ? null
      : Number(body.agentDbId);
  const result = await adminCreateCreatorLaunch(id, {
    mint: body.mint ?? "",
    agentDbId: Number.isFinite(agentDbId) ? agentDbId : null,
    tokenName: body.tokenName,
    tokenSymbol: body.tokenSymbol,
    tokenImageUrl: body.tokenImageUrl,
    launchStatus: body.launchStatus,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ creator: result.creator });
}