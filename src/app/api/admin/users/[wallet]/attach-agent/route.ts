import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { resolveOnChainIdsFromProfileUrl } from "@/lib/resolve-agent-from-link-url";
export const dynamic = "force-dynamic";
const MAX_ADMIN_NOTES = 12_000;
function normalizeWalletParam(raw: string): string {
  const w = decodeURIComponent(raw).trim();
  if (!w) return "";
  if (/^0x[a-f0-9]{40}$/i.test(w)) return w.toLowerCase();
  return w;
}
function walletFilter(wallet: string) {
  return { equals: wallet, mode: "insensitive" as const };
}
function isVerifiedAgent(agent: {
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  isCustomListed: boolean;
}): boolean {
  return (
    agent.isVerified ||
    agent.isPremiumVerified ||
    agent.isVerifiedRevenue ||
    agent.isCustomListed
  );
}
/** Paid KYA / premium / bundle / verified-revenue for this wallet+agent even if Agent flags were cleared or lagging. */
async function hasPaidVerificationEntitlement(
  wallet: string,
  agentDbId: number
): Promise<boolean> {
  const wf = walletFilter(wallet);
  const productTypes = ["kya_verify", "verification_bundle", "verified_revenue"] as const;
  const slotTypes = ["premium_verify", "verification_bundle", "verified_revenue"] as const;
  const [orderHit, promoHit] = await Promise.all([
    prisma.order.findFirst({
      where: {
        wallet: wf,
        status: "paid",
        agentId: agentDbId,
        productType: { in: [...productTypes] },
      },
      select: { id: true },
    }),
    prisma.promotion.findFirst({
      where: {
        wallet: wf,
        agentId: agentDbId,
        slotType: { in: [...slotTypes] },
      },
      select: { id: true },
    }),
  ]);
  return !!(orderHit || promoHit);
}
function appendAuditNote(current: string, line: string): string {
  const next = `${current.trim()}\n${line}`.trim();
  if (next.length <= MAX_ADMIN_NOTES) return next;
  return next.slice(next.length - MAX_ADMIN_NOTES);
}
const agentSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  owner: true,
  verifiedWallet: true,
  isVerified: true,
  isPremiumVerified: true,
  isVerifiedRevenue: true,
  isCustomListed: true,
} as const;
/**
 * POST /api/admin/users/[wallet]/attach-agent
 * Body: { agentUrl?, agentDbId?, chainId?, registryAgentId?, force?, reason? }
 *
 * Resolve agent (first match wins): `agentUrl`, then `chainId`+`registryAgentId`, then `agentDbId`.
 * `force`: overwrite another wallet’s owner **and** skip verification (admin override for Agent Dashboard).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { wallet: walletParam } = await params;
  const wallet = normalizeWalletParam(walletParam);
  if (!wallet) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  let body: {
    agentUrl?: unknown;
    agentDbId?: unknown;
    chainId?: unknown;
    registryAgentId?: unknown;
    force?: unknown;
    reason?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const agentUrlRaw = typeof body.agentUrl === "string" ? body.agentUrl.trim() : "";
  const agentDbId = Number(body.agentDbId);
  const chainId = Number(body.chainId);
  const registryAgentId = Number(body.registryAgentId);
  const hasRegistryPair =
    Number.isFinite(chainId) &&
    chainId > 0 &&
    Number.isFinite(registryAgentId) &&
    registryAgentId >= 1;
  const hasDbId = Number.isFinite(agentDbId) && agentDbId >= 1;
  const force = body.force === true;
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const profile = await prisma.userProfile.findFirst({
    where: { walletAddress: walletFilter(wallet) },
    select: { id: true, walletAddress: true, adminNotes: true },
  });
  if (!profile?.walletAddress?.trim()) {
    return NextResponse.json(
      { error: "User profile not found or has no wallet address" },
      { status: 404 }
    );
  }
  const targetWallet = profile.walletAddress.trim().toLowerCase();
  let resolvedChainId: number | null = null;
  let resolvedRegistryAgentId: number | null = null;
  if (agentUrlRaw) {
    const parsed = await resolveOnChainIdsFromProfileUrl(agentUrlRaw);
    if (!parsed) {
      return NextResponse.json(
        {
          error: "Invalid or obsolete agent URL",
          detail:
            "Paste the current complete profile URL: /agents/{chainId}/{agentId}/{current-name-slug}.",
        },
        { status: 400 },
      );
    }
    resolvedChainId = parsed.chainId;
    resolvedRegistryAgentId = parsed.agentId;
  } else if (hasRegistryPair) {
    resolvedChainId = chainId;
    resolvedRegistryAgentId = registryAgentId;
  }
  const hasCompoundLookup =
    resolvedChainId != null &&
    resolvedRegistryAgentId != null &&
    resolvedRegistryAgentId >= 1;
  const lookupChainId = resolvedChainId ?? 0;
  const lookupRegistryId = resolvedRegistryAgentId ?? 0;
  if (!hasCompoundLookup && !hasDbId) {
    return NextResponse.json(
      {
        error: "Invalid agent selector",
        detail:
          "Send agentUrl (profile link), or agentDbId (internal id), or both chainId and registryAgentId.",
      },
      { status: 400 }
    );
  }
  const agent = hasCompoundLookup
    ? await prisma.agent.findUnique({
        where: {
          agentId_chainId: {
            agentId: lookupRegistryId,
            chainId: lookupChainId,
          },
        },
        select: agentSelect,
      })
    : await prisma.agent.findUnique({
        where: { id: agentDbId },
        select: agentSelect,
      });
  if (!agent) {
    return NextResponse.json(
      {
        error: "Agent not found",
        detail: hasCompoundLookup
          ? `No row for chainId=${resolvedChainId} and on-chain agentId=${resolvedRegistryAgentId}.`
          : `No row for internal id=${agentDbId}.`,
      },
      { status: 404 }
    );
  }
  const verifiedByFlags = isVerifiedAgent(agent);
  const paidEntitled = verifiedByFlags
    ? false
    : await hasPaidVerificationEntitlement(targetWallet, agent.id);
  if (!force && !verifiedByFlags && !paidEntitled) {
    return NextResponse.json(
      {
        error: "Agent is not verified",
        detail:
          "Enable “Force attach” to link an unverified agent for Agent Dashboard, or use a verified / entitled agent.",
        agent: {
          dbId: agent.id,
          chainId: agent.chainId,
          registryAgentId: agent.agentId,
          name: agent.name,
        },
        flags: {
          isVerified: agent.isVerified,
          isPremiumVerified: agent.isPremiumVerified,
          isVerifiedRevenue: agent.isVerifiedRevenue,
          isCustomListed: agent.isCustomListed,
        },
      },
      { status: 400 }
    );
  }
  const existingOwner = (agent.owner ?? "").trim();
  if (existingOwner && existingOwner.toLowerCase() !== targetWallet) {
    if (!force) {
      return NextResponse.json(
        {
          error: "Owner conflict",
          code: "OWNER_CONFLICT",
          previousOwner: existingOwner,
          agent: { id: agent.id, name: agent.name, chainId: agent.chainId, agentId: agent.agentId },
        },
        { status: 409 }
      );
    }
  }
  const prev = existingOwner || "(empty)";
  const ts = new Date().toISOString();
  const reasonSuffix = reason ? ` reason=${JSON.stringify(reason)}` : "";
  const forceBits: string[] = [];
  if (force) {
    forceBits.push("force=1");
    if (!verifiedByFlags && !paidEntitled) {
      forceBits.push("admin_override_unverified");
    }
    if (existingOwner && existingOwner.toLowerCase() !== targetWallet) {
      forceBits.push("admin_override_owner");
    }
  }
  const forceSuffix = forceBits.length ? ` ${forceBits.join(" ")}` : "";
  const auditLine = `[${ts}] admin attach agentDbId=${agent.id} chain=${agent.chainId} onChainId=${agent.agentId} owner: "${prev}" -> "${targetWallet}" by ${session.username}${forceSuffix}${reasonSuffix}`;
  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agent.id },
      data: { owner: targetWallet },
    }),
    prisma.userProfile.update({
      where: { id: profile.id },
      data: { adminNotes: appendAuditNote(profile.adminNotes ?? "", auditLine) },
    }),
  ]);
  return NextResponse.json({
    success: true,
    agent: {
      id: agent.id,
      agentId: agent.agentId,
      chainId: agent.chainId,
      name: agent.name,
      owner: targetWallet,
    },
  });
}
