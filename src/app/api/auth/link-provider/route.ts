import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/**
 * Cross-linking Google ↔ X is disabled so each sign-in method keeps its own
 * AppAccount, agents, and custodial wallets.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Account linking is disabled. Sign in with Google or X as separate accounts.",
      disabled: true,
    },
    { status: 403 },
  );
}