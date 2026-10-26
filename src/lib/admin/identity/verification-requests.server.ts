import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { agentPublicPath } from "@/lib/agent-public-url";
import { requireAdminIdentity } from "./auth.server";
import type { AdminVerificationRequestsQuery } from "./query";
import type { AdminVerificationRequestsResponse } from "./types";

export async function readAdminVerificationRequests(
  query: AdminVerificationRequestsQuery,
): Promise<AdminVerificationRequestsResponse> {
  await requireAdminIdentity();
  const statusFilter = query.status === "all"
    ? undefined
    : query.status.split(",").map((status) => status.trim()).filter(Boolean);
  const where: Prisma.AgentVerificationRequestWhereInput = statusFilter?.length
    ? { verificationStatus: { in: statusFilter } }
    : {};
  const [total, rows] = await Promise.all([
    prisma.agentVerificationRequest.count({ where }),
    prisma.agentVerificationRequest.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      select: {
        id: true,
        agentId: true,
        agentName: true,
        xHandle: true,
        walletAddress: true,
        website: true,
        tokenAddress: true,
        proofNotes: true,
        paymentStatus: true,
        verificationStatus: true,
        submittedAt: true,
        reviewedAt: true,
        reviewerNote: true,
        reviewedByAdmin: true,
        agent: {
          select: {
            agentId: true,
            chainId: true,
            name: true,
            isVerified: true,
            isPremiumVerified: true,
            publicVerificationStatus: true,
          },
        },
      },
    }),
  ]);
  return {
    requests: rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      xHandle: row.xHandle,
      walletAddress: row.walletAddress,
      website: row.website,
      tokenAddress: row.tokenAddress,
      proofNotes: row.proofNotes,
      paymentStatus: row.paymentStatus,
      verificationStatus: row.verificationStatus,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewerNote: row.reviewerNote,
      reviewedByAdmin: row.reviewedByAdmin,
      onChainAgentId: row.agent.agentId,
      chainId: row.agent.chainId,
      agentIsVerified: row.agent.isVerified,
      agentIsPremiumVerified: row.agent.isPremiumVerified,
      publicVerificationStatus: row.agent.publicVerificationStatus,
      profilePath: agentPublicPath(row.agent),
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}
