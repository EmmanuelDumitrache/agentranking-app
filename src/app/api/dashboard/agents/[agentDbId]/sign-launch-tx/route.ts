import { NextResponse } from "next/server";
import bs58 from "bs58";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { signAndSendAgentCustodialTransaction } from "@/lib/custodial-wallet/sign-launch";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json()) as {
    transactionBase64?: string;
    mintSecretKeyBase58?: string;
    expectedSigner?: string;
  };
  const transactionBase64 = body.transactionBase64?.trim();
  if (!transactionBase64) {
    return NextResponse.json({ error: "transactionBase64 is required" }, { status: 400 });
  }
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      owner: true,
      listingRegistrySource: true,
      chainId: true,
      metadata: { where: { key: "agentWallet" }, select: { value: true }, take: 1 },
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  const wallet = await resolveAgentWallet(id, {
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource,
    chainId: agent.chainId,
    metadataWallet: agent.metadata[0]?.value ?? null,
  });
  if (!wallet?.isCustodial) {
    return NextResponse.json({ error: "Agent wallet signing is not available" }, { status: 400 });
  }
  let mintSecretKey: Uint8Array | undefined;
  if (body.mintSecretKeyBase58?.trim()) {
    try {
      mintSecretKey = bs58.decode(body.mintSecretKeyBase58.trim());
    } catch {
      return NextResponse.json({ error: "Invalid mint secret key" }, { status: 400 });
    }
  }
  try {
    const signature = await signAndSendAgentCustodialTransaction({
      agentDbId: id,
      transactionBase64,
      mintSecretKey,
      expectedSignerPublicKey: body.expectedSigner?.trim() || wallet.publicKey,
    });
    return NextResponse.json({ signature });
  } catch (error) {
    console.error("[agent/sign-launch-tx]", error);
    const message = Error.isError(error) ? error.message : "Signing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
