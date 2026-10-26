import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

/** Legacy SOL premium verification — replaced by account-level KYC. */
export async function POST(_request: Request, _context: RouteContext) {
  return NextResponse.json(
    {
      error: "Agent-level SOL verification is deprecated. Verify your account at /dashboard/verify.",
      redirect: "/dashboard/verify",
    },
    { status: 410 },
  );
}
