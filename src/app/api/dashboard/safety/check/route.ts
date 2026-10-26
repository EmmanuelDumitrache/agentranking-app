import { NextRequest, NextResponse } from "next/server";
import { runSafetyPreflight } from "@/lib/safety-preflight";
export const dynamic = "force-dynamic";
/**
 * POST /api/dashboard/safety/check
 * Heuristic preflight for agent / wallet tooling — not a substitute for simulation or audits.
 */
export async function POST(request: NextRequest) {
  let body: {
    chainId?: unknown;
    to?: unknown;
    from?: unknown;
    value?: unknown;
    data?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const chainId = Number(body.chainId);
  if (!Number.isFinite(chainId)) {
    return NextResponse.json({ error: "chainId must be a number" }, { status: 400 });
  }
  const to = String(body.to ?? "").trim();
  if (!to) {
    return NextResponse.json({ error: "to is required" }, { status: 400 });
  }
  const result = runSafetyPreflight({
    chainId,
    to,
    from: body.from !== undefined ? String(body.from) : undefined,
    value: body.value !== undefined ? String(body.value) : undefined,
    data: body.data !== undefined ? String(body.data) : undefined,
  });
  return NextResponse.json(result);
}
