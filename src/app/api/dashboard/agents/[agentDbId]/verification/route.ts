import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

/** Legacy SOL premium verification — replaced by account-level KYC. */
export async function GET(_request: Request, _context: RouteContext) {
  return NextResponse.json(
    {
      error: "Agent-level verification is deprecated. Use GET /api/verification/account.",
      redirect: "/dashboard/verify",
    },
    { status: 410 },
  );
}
