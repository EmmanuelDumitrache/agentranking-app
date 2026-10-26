import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { agentPublicPath } from "@/lib/agent-public-url";
import { prisma } from "@/lib/db";
import { requireAdminOperationsSession } from "./auth.server";

export type AdminAgentReportStatus = "all" | "open" | "reviewed" | "dismissed";

export function normalizeAdminAgentReportsInput(input: {
  readonly page?: number;
  readonly perPage?: number;
  readonly status?: string | null;
}) {
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page!)) : 1;
  const perPage = Number.isFinite(input.perPage)
    ? Math.min(50, Math.max(1, Math.trunc(input.perPage!)))
    : 25;
  const status: AdminAgentReportStatus =
    input.status === "open" ||
    input.status === "reviewed" ||
    input.status === "dismissed"
      ? input.status
      : "all";
  return { page, perPage, status };
}

type AdminAgentReportsInput = {
  readonly page?: number;
  readonly perPage?: number;
  readonly status?: string | null;
};

async function queryAdminAgentReports(input: AdminAgentReportsInput) {
  await requireAdminOperationsSession();
  const normalized = normalizeAdminAgentReportsInput(input);
  const where: Prisma.AgentReportWhereInput = {};
  if (normalized.status !== "all") where.status = normalized.status;

  const [reports, total] = await Promise.all([
    prisma.agentReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (normalized.page - 1) * normalized.perPage,
      take: normalized.perPage,
      select: {
        id: true,
        agentDbId: true,
        chainId: true,
        onChainAgentId: true,
        pageUrl: true,
        category: true,
        details: true,
        reporterIpHash: true,
        reporterWallet: true,
        status: true,
        adminNotes: true,
        createdAt: true,
        updatedAt: true,
        agent: {
          select: { id: true, name: true, chainId: true, agentId: true },
        },
      },
    }),
    prisma.agentReport.count({ where }),
  ]);

  return { normalized, reports, total };
}

function mapAdminAgentReportIdentity(
  agent: { id: number; name: string; chainId: number; agentId: number } | null,
) {
  return agent ? { ...agent, profilePath: agentPublicPath(agent) } : null;
}

/** Narrow RSC/page projection. Reporter audit identifiers stay server-side. */
export async function readAdminAgentReports(input: AdminAgentReportsInput) {
  const { normalized, reports, total } = await queryAdminAgentReports(input);
  return {
    reports: reports.map((report) => ({
      id: report.id,
      chainId: report.chainId,
      onChainAgentId: report.onChainAgentId,
      pageUrl: report.pageUrl,
      category: report.category,
      details: report.details,
      status: report.status,
      adminNotes: report.adminNotes,
      createdAt: report.createdAt.toISOString(),
      agent: mapAdminAgentReportIdentity(report.agent),
    })),
    total,
    page: normalized.page,
    perPage: normalized.perPage,
    totalPages: Math.ceil(total / normalized.perPage),
  };
}

/** Existing protected Route Handler contract, including legacy audit fields. */
export async function readAdminAgentReportsApi(input: AdminAgentReportsInput) {
  const { normalized, reports, total } = await queryAdminAgentReports(input);
  return {
    reports: reports.map((report) => ({
      id: report.id,
      agentDbId: report.agentDbId,
      chainId: report.chainId,
      onChainAgentId: report.onChainAgentId,
      pageUrl: report.pageUrl,
      category: report.category,
      details: report.details,
      reporterIpHash: report.reporterIpHash,
      reporterWallet: report.reporterWallet,
      status: report.status,
      adminNotes: report.adminNotes,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      agent: mapAdminAgentReportIdentity(report.agent),
    })),
    total,
    page: normalized.page,
    perPage: normalized.perPage,
    totalPages: Math.ceil(total / normalized.perPage),
  };
}
