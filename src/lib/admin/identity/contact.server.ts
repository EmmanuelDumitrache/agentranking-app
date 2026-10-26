import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminIdentity } from "./auth.server";
import type { AdminContactQuery } from "./query";
import type { AdminContactResponse } from "./types";

export async function readAdminContactInquiries(query: AdminContactQuery): Promise<AdminContactResponse> {
  await requireAdminIdentity();
  const where: Prisma.ContactInquiryWhereInput = {};
  if (query.status === "open" || query.status === "resolved") where.status = query.status;
  if (query.dashboardOnly) where.userId = { not: null };
  const [inquiries, total] = await Promise.all([
    prisma.contactInquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        status: true,
        userId: true,
        createdAt: true,
        replies: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            authorRole: true,
            readByAdmin: true,
            readByUser: true,
          },
        },
      },
    }),
    prisma.contactInquiry.count({ where }),
  ]);
  return {
    inquiries: inquiries.map((inquiry) => ({
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      subject: inquiry.subject,
      message: inquiry.message,
      status: inquiry.status,
      userId: inquiry.userId,
      createdAt: inquiry.createdAt.toISOString(),
      replies: inquiry.replies.map((reply) => ({
        ...reply,
        createdAt: reply.createdAt.toISOString(),
      })),
    })),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}
