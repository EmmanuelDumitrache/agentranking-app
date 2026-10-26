import { hash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isAgentBlocked } from "@/lib/agent-blocklist";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { slidingWindowLimit } from "@/lib/valkey";
export const dynamic = "force-dynamic";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 8;
async function rateLimitOk(key: string): Promise<boolean> {
  const result = await slidingWindowLimit({
    key: `ratelimit:agent-report:${key}`,
    limit: MAX_REPORTS_PER_WINDOW,
    windowMs: WINDOW_MS,
  });
  return result.success;
}
function clientIp(request: NextRequest): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
function hashReporterIp(ip: string): string {
  const salt = process.env.REPORT_IP_SALT ?? process.env.ADMIN_SESSION_SECRET ?? "report-ip-salt";
  return hash("sha256", `${salt}:${ip}`, "hex");
}
const BodySchema = z.object({
  category: z.enum(["spam", "impersonation", "malware", "other"]),
  details: z.string().min(20).max(2000),
  pageUrl: z.string().max(2000).optional().default(""),
});
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> }
) {
  const { chainId: cStr, agentId: aStr } = await params;
  const chainId = parsePublicChainId(cStr);
  const agentId = parsePublicAgentId(aStr);
  if (chainId == null || agentId == null) {
    return NextResponse.json({ error: "Invalid chain or agent id" }, { status: 400 });
  }
  const ip = clientIp(request);
  if (!(await rateLimitOk(ip))) {
    return NextResponse.json({ error: "Too many reports from this network. Try again later." }, { status: 429 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: {
      id: true,
      name: true,
      agentURI: true,
      owner: true,
      chainId: true,
      agentId: true,
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (
    await isAgentBlocked({
      name: agent.name,
      agentURI: agent.agentURI ?? "",
      owner: agent.owner ?? "",
      chainId: agent.chainId,
      agentId: agent.agentId,
    })
  ) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  const { category, details, pageUrl } = parsed.data;
  const reporterIpHash = hashReporterIp(ip);
  await prisma.agentReport.create({
    data: {
      agentDbId: agent.id,
      chainId: agent.chainId,
      onChainAgentId: agent.agentId,
      pageUrl: pageUrl.slice(0, 2000),
      category,
      details,
      reporterIpHash,
      status: "open",
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
