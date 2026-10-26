import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { scanX402Endpoint, x402SignalsFromScan } from "@/lib/dashboard/x402-scanner";
import { upsertAgentSignals } from "@/lib/signals/store";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { HttpBodyTooLargeError, parseBoundedJsonBody } from "@/lib/bounded-http-body";
export const dynamic = "force-dynamic";

const X402ScanBodySchema = z.strictObject({
  endpoint: z.string().trim().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  let body: z.infer<typeof X402ScanBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, X402ScanBodySchema, 16 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof HttpBodyTooLargeError ? 413 : 400 },
    );
  }
  const endpoint = body.endpoint;
  const scan = await scanX402Endpoint(endpoint, request.signal);
  const signals = x402SignalsFromScan(scan);
  await upsertAgentSignals(agentDbId, signals);
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ scan, signals });
}