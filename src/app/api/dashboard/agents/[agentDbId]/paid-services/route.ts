import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { loadDashboardPaidServices } from "@/lib/dashboard/x402-monetization-workspace.server";
export const dynamic = "force-dynamic";
type PaidServiceBody = {
  title?: string;
  description?: string;
  serviceType?: string;
  endpointUrl?: string;
  priceUsd?: number | null;
  priceLabel?: string;
  paymentWallet?: string;
  sampleResponse?: string;
  isPublished?: boolean;
};
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  return NextResponse.json({ paidServices: await loadDashboardPaidServices(agentDbId) });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as PaidServiceBody;
  if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  const paidService = await prisma.agentPaidService.create({
    data: {
      agentId: agentDbId,
      title: body.title.trim(),
      description: body.description?.trim() ?? "",
      serviceType: body.serviceType?.trim() || "x402",
      endpointUrl: body.endpointUrl?.trim() ?? "",
      priceUsd: body.priceUsd ?? null,
      priceLabel: body.priceLabel?.trim() ?? "",
      paymentWallet: body.paymentWallet?.trim() ?? "",
      sampleResponse: body.sampleResponse?.trim() ?? "",
      isPublished: Boolean(body.isPublished),
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ paidService });
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = (await request.json()) as PaidServiceBody & { id?: number };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.agentPaidService.findFirst({
    where: { id: body.id, agentId: agentDbId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const paidService = await prisma.agentPaidService.update({
    where: { id: body.id },
    data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      ...(body.serviceType !== undefined ? { serviceType: body.serviceType.trim() || "x402" } : {}),
      ...(body.endpointUrl !== undefined ? { endpointUrl: body.endpointUrl.trim() } : {}),
      ...(body.priceUsd !== undefined ? { priceUsd: body.priceUsd } : {}),
      ...(body.priceLabel !== undefined ? { priceLabel: body.priceLabel.trim() } : {}),
      ...(body.paymentWallet !== undefined ? { paymentWallet: body.paymentWallet.trim() } : {}),
      ...(body.sampleResponse !== undefined ? { sampleResponse: body.sampleResponse.trim() } : {}),
      ...(body.isPublished !== undefined ? { isPublished: body.isPublished } : {}),
    },
  });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ paidService });
}
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const id = Number.parseInt(request.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.agentPaidService.findFirst({
    where: { id, agentId: agentDbId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.agentPaidService.delete({ where: { id } });
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ ok: true });
}
